/**
 * Uptime heartbeat — probes the API plus its real dependencies (database,
 * Redis, college portal) every 5 minutes and records the results there. When
 * CANARY_ROLL and CANARY_ENABLED are set, it also runs a synthetic answer
 * lookup so a green portal cannot hide a login or parser failure. Powers the
 * /status page (90-day bars like OpenAI's status page) and the admin panel
 * health view. Self-healing: the interval keeps running even when a probe
 * fails, and component status transitions notify the admin.
 */
import axios from "axios";
import { recordHeartbeat, initUptimeTable } from "../db/student_stats.model.js";
import {
  PORT,
  ADMIN_ID,
  ENV,
  CANARY_ROLL,
  CANARY_ENABLED,
} from "../config/environmentals.js";
import { BASE_URL } from "../constants/index.js";
import { logger } from "../config/logger.js";

const INTERVAL_MS = 5 * 60 * 1000;
const RETENTION_DAYS = 95;
// The production VM occasionally pauses for several seconds (host-level CPU
// steal / storage hiccups): observed stalls of 3–8.2s hit ALL components in
// the same second. The timeout sits just above that band, and anything that
// still fails is re-probed once before being recorded or alerted.
const PROBE_TIMEOUT_MS = 10000;
const CONFIRM_DELAY_MS = 45 * 1000;

const API_PROBE_URL = `http://127.0.0.1:${PORT}/health`;

type ComponentStatus = "up" | "down";
type ProbeResult = {
  component: string;
  status: ComponentStatus;
  latencyMs: number | null;
};

let inited = false;
// previous status per component; null until the first probe (no alert on boot)
const previousStatus = new Map<string, ComponentStatus | null>();

const timed = async (
  component: string,
  probe: () => Promise<void>,
): Promise<ProbeResult> => {
  const start = Date.now();
  let status: ComponentStatus = "down";
  let latencyMs: number | null = null;

  try {
    await probe();
    status = "up";
    latencyMs = Date.now() - start;
  } catch {
    status = "down";
  }

  return { component, status, latencyMs };
};

const probeApi = (): Promise<ProbeResult> =>
  timed("api", async () => {
    await axios.get(API_PROBE_URL, { timeout: PROBE_TIMEOUT_MS });
  });

const probeDatabase = (): Promise<ProbeResult> =>
  timed("database", async () => {
    const { turso } = await import("../db/db.js");
    await turso.execute("SELECT 1");
  });

const probeRedis = (): Promise<ProbeResult> =>
  timed("redis", async () => {
    const { getClient } = await import("./redis/getRedisClient.js");
    const redis = await getClient();
    await redis.ping();
  });

// Any HTTP response (even 4xx) means the portal host is reachable.
const probePortal = (): Promise<ProbeResult> =>
  timed("portal", async () => {
    await axios.get(BASE_URL, {
      timeout: PROBE_TIMEOUT_MS,
      validateStatus: () => true,
    });
  });

/**
 * The answer canary runs one real attendance request for a known roll and
 * parses it the same way a student request would. getFreshResponse throws
 * instead of serving the saved section copy, so a login failure, layout
 * change, or parser regression turns this component down while probePortal
 * is still green. It deliberately does not call getAttendanceJSON: that path
 * reads Redis, writes stats/activity, and can return a cached answer.
 */
export const probeLookup = (): Promise<ProbeResult> =>
  timed("lookup", async () => {
    const [
      { Academic },
      { getStudentCached },
      { contextFor, parseAttendanceSection },
    ] = await Promise.all([
      import("./student.utils/Academic.js"),
      import("./redis/utils.js"),
      import("./student.utils/parsers.js"),
    ]);

    const student = await getStudentCached(CANARY_ROLL);
    const academic = new Academic(CANARY_ROLL);
    const response = await academic.getFreshResponse("att");
    const parsed = parseAttendanceSection(response, contextFor(student));
    const mine =
      parsed.get(academic.rollnumber) ??
      parsed.get(student.roll_no.toUpperCase());

    if (
      !mine ||
      (mine.subjects.length === 0 && mine.totalClasses.conducted <= 0)
    ) {
      throw new Error("lookup canary parsed no usable attendance");
    }
  });

/**
 * The canary is opt-in: enabled explicitly, given a real roll, and never run
 * by the test suite (which must not touch the college portal).
 */
export const canaryProbeEnabled = (
  env: string = ENV,
  enabled: boolean = CANARY_ENABLED,
  roll: string = CANARY_ROLL,
): boolean => env !== "test" && enabled && roll.trim().length > 0;

export const buildComponentProbes = (
  includeLookup: boolean,
): Record<string, () => Promise<ProbeResult>> => {
  const probes: Record<string, () => Promise<ProbeResult>> = {
    api: probeApi,
    database: probeDatabase,
    redis: probeRedis,
    portal: probePortal,
  };
  if (includeLookup) probes.lookup = probeLookup;
  return probes;
};

const componentProbes = buildComponentProbes(canaryProbeEnabled());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Record one result and fire any transition alert. */
/**
 * The college portal is not ours to maintain: its history still feeds the
 * status page, but its outages are not paged.
 */
export const alertsOnComponent = (component: string): boolean =>
  component !== "portal";

const notifyAdmin = async (result: ProbeResult): Promise<boolean> => {
  if (!alertsOnComponent(result.component)) return true;
  if (!ADMIN_ID) return true;
  const previous = previousStatus.get(result.component);
  // First probe of a down component is an alert too: a restart during an
  // outage must not stay silent and then announce a recovery that was never
  // reported as an outage. Only a known-down component is deduplicated.
  const wentDown = result.status === "down" && previous !== "down";
  const recovered = previous === "down" && result.status === "up";
  if (!wentDown && !recovered) return true;

  const { bot } = await import("../bot/bot.js");
  const icon = wentDown ? "🔴" : "🟢";
  const verb = wentDown ? "DOWN" : "back UP";
  try {
    await bot.sendMessage(
      ADMIN_ID,
      `${icon} <b>${result.component}</b> is ${verb}\n` +
        `Probe latency: ${result.latencyMs ?? "timeout"}${result.latencyMs ? "ms" : ""}`,
      { parse_mode: "HTML", disable_notification: !wentDown },
    );
    return true;
  } catch (e) {
    logger.warn("[uptime] admin alert failed:", e);
    return false;
  }
};

export const recordProbeResult = async (result: ProbeResult): Promise<void> => {
  try {
    await recordHeartbeat(result.component, result.status, result.latencyMs);
  } catch (e) {
    logger.warn(`[uptime] heartbeat write failed for ${result.component}:`, e);
  }
  const notified = await notifyAdmin(result);
  // If Telegram rejected the alert, keep the previous state so the next cycle
  // retries it instead of silently marking the outage as announced.
  if (notified) previousStatus.set(result.component, result.status);
  else logger.warn("[uptime] alert not delivered; will retry next cycle");
  logger.debug(
    `[uptime] ${result.component}: ${result.status} (${result.latencyMs ?? "timeout"}ms)`,
  );
};

/**
 * Re-probe a failed component once after a short delay. The production VM
 * pauses for a few seconds several times a day, which fails every component
 * at once; a single retry separates those blips from real outages. If the
 * retry succeeds the component is recorded healthy (the blip is logged, not
 * alarmed); only a second failure is recorded and alerted.
 */
const confirmFailure = async (failed: ProbeResult): Promise<void> => {
  await sleep(CONFIRM_DELAY_MS);
  const retry = await componentProbes[failed.component]();

  if (retry.status === "up") {
    logger.warn(
      `[uptime] ${failed.component} failed once and recovered within ${CONFIRM_DELAY_MS / 1000}s — treating as a transient blip`,
    );
  }
  await recordProbeResult(retry);
};

const probe = async () => {
  const settled = await Promise.allSettled(
    Object.values(componentProbes).map((fn) => fn()),
  );

  const results: ProbeResult[] = [];
  for (const s of settled) {
    if (s.status === "rejected") {
      logger.warn("[uptime] probe crashed:", s.reason);
      continue;
    }
    results.push(s.value);
  }

  // record healthy components immediately; confirm failures in parallel
  for (const result of results.filter((r) => r.status === "up")) {
    await recordProbeResult(result);
  }
  await Promise.all(
    results.filter((r) => r.status === "down").map(confirmFailure),
  );
};

const prune = async () => {
  try {
    const { turso } = await import("../db/db.js");
    // RETENTION_DAYS is a module constant (not user input), so interpolating
    // the integer into the datetime() modifier is safe
    await turso.execute(
      `DELETE FROM uptime_log WHERE created_at < datetime('now', '-${RETENTION_DAYS} days')`,
    );
    // Reuse the existing daily job to keep activity log and expired admin
    // sessions from growing forever on the low-memory server.
    await turso.execute(
      `DELETE FROM activity_log WHERE created_at < datetime('now', '-${RETENTION_DAYS} days')`,
    );
    await turso.execute(
      `DELETE FROM admin_sessions WHERE expires_at < datetime('now')`,
    );
  } catch (e) {
    logger.warn("[uptime] prune failed:", e);
  }
};

export const startUptimeMonitor = async () => {
  if (inited) return;
  inited = true;

  try {
    await initUptimeTable();
  } catch (e) {
    logger.warn("[uptime] table init failed:", e);
  }

  // initial probe after short delay (let API server bind first)
  setTimeout(probe, 15 * 1000);
  setInterval(probe, INTERVAL_MS);
  // prune once a day
  setInterval(prune, 24 * 60 * 60 * 1000);

  logger.info(
    `[uptime] monitor started (${Object.keys(componentProbes).join("/")}, 5min interval, 90d retention)`,
  );
};
