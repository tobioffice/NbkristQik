/**
 * Uptime heartbeat — probes the API plus its real dependencies (Turso,
 * Redis, college portal) every 5 minutes and records the results to Turso.
 * Powers the /status page (90-day bars like OpenAI's status page) and the
 * admin panel health view. Self-healing: the interval keeps running even
 * when a probe fails, and component status transitions notify the admin.
 */
import axios from "axios";
import { recordHeartbeat, initUptimeTable } from "../db/student_stats.model.js";
import { PORT } from "../config/environmentals.js";
import { ADMIN_ID } from "../config/environmentals.js";
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

const probeTurso = (): Promise<ProbeResult> =>
  timed("turso", async () => {
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

const componentProbes: Record<string, () => Promise<ProbeResult>> = {
  api: probeApi,
  turso: probeTurso,
  redis: probeRedis,
  portal: probePortal,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Record one result and fire any transition alert. */
const notifyAdmin = async (result: ProbeResult): Promise<void> => {
  if (!ADMIN_ID) return;
  const previous = previousStatus.get(result.component);
  const wentDown = previous === "up" && result.status === "down";
  const recovered = previous === "down" && result.status === "up";
  if (!wentDown && !recovered) return;

  const { bot } = await import("../bot/bot.js");
  const icon = wentDown ? "🔴" : "🟢";
  const verb = wentDown ? "DOWN" : "back UP";
  await bot
    .sendMessage(
      ADMIN_ID,
      `${icon} <b>${result.component}</b> is ${verb}\n` +
        `Probe latency: ${result.latencyMs ?? "timeout"}${result.latencyMs ? "ms" : ""}`,
      { parse_mode: "HTML", disable_notification: !wentDown },
    )
    .catch((e) => logger.warn("[uptime] admin alert failed:", e));
};

const recordAndNotify = async (result: ProbeResult): Promise<void> => {
  try {
    await recordHeartbeat(result.component, result.status, result.latencyMs);
  } catch (e) {
    logger.warn(`[uptime] heartbeat write failed for ${result.component}:`, e);
  }
  await notifyAdmin(result);
  previousStatus.set(result.component, result.status);
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
  await recordAndNotify(retry);
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
    await recordAndNotify(result);
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
    "[uptime] monitor started (api/turso/redis/portal, 5min interval, 90d retention)",
  );
};
