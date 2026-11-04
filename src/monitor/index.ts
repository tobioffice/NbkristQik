/**
 * External uptime monitor.
 *
 * Runs on a host that is not the production box (oracle2 in this deployment)
 * so a dead production VM still produces a down transition, and so a paused
 * or overloaded API server cannot report itself healthy. It probes the public
 * API, the college portal and the private deep-health endpoint, then posts the
 * heartbeats back to the production database.
 *
 * The monitor is deliberately dependency-free: Node 20+ built-ins only, so it
 * can be copied to the second host as a single file and run under systemd with
 * no node_modules.
 */
import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "https://checker.tobioffice.dev";
const DEFAULT_PORTAL_URL = "http://103.203.175.91";
const MIN_SECRET_LENGTH = 32;
const TELEGRAM_TOKEN = /^\d+:[A-Za-z0-9_-]+$/;
const TELEGRAM_CHAT = /^(-?\d+|@[A-Za-z0-9_]{5,})$/;
const COMPONENTS = ["api", "portal", "database", "redis"] as const;

export type Component = (typeof COMPONENTS)[number];
export type ComponentStatus = "up" | "down";
export type ProbeResult = {
  component: Component;
  status: ComponentStatus;
  latencyMs: number | null;
  at: string;
};

export type MonitorConfig = {
  baseUrl: string;
  portalUrl: string;
  secret: string;
  botToken: string;
  adminId: string;
  stateDir: string;
  intervalMs: number;
  timeoutMs: number;
  confirmMs: number;
  spoolLimit: number;
};

const clampInt = (
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

export const readConfig = (): MonitorConfig => {
  const baseUrl = (process.env.MONITOR_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const portalUrl =
    process.env.MONITOR_PORTAL_URL ||
    process.env.PORTAL_BASE_URL ||
    DEFAULT_PORTAL_URL;

  return {
    baseUrl,
    portalUrl,
    secret: process.env.UPTIME_INGEST_SECRET?.trim() || "",
    botToken: (
      process.env.MONITOR_TELEGRAM_BOT_TOKEN ||
      process.env.TELEGRAM_BOT_TOKEN ||
      ""
    ).trim(),
    adminId: process.env.ADMIN_ID?.trim() || "",
    stateDir: path.resolve(
      process.env.MONITOR_STATE_DIR ||
        process.env.STATE_DIRECTORY ||
        ".monitor-state",
    ),
    intervalMs: clampInt(
      process.env.MONITOR_INTERVAL_MS,
      5 * 60 * 1000,
      60 * 1000,
      24 * 60 * 60 * 1000,
    ),
    timeoutMs: clampInt(
      process.env.MONITOR_TIMEOUT_MS,
      10 * 1000,
      1000,
      60 * 1000,
    ),
    confirmMs: clampInt(
      process.env.MONITOR_CONFIRM_MS,
      45 * 1000,
      0,
      5 * 60 * 1000,
    ),
    spoolLimit: clampInt(
      process.env.MONITOR_SPOOL_LIMIT,
      10_000,
      100,
      1_000_000,
    ),
  };
};

let CONFIG: MonitorConfig = readConfig();

/**
 * Test hook: override parts of the monitor config so the state machine can be
 * exercised against a temp directory and injected fetch. Production code
 * never calls this; the entry point keeps using readConfig().
 */
export const setMonitorConfigForTests = (
  overrides: Partial<MonitorConfig>,
): void => {
  CONFIG = { ...CONFIG, ...overrides };
};

const log = (message: string, ...args: unknown[]) => {
  console.log(`${new Date().toISOString()} ${message}`, ...args);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isLoopback = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "::1" ||
  hostname === "[::1]" ||
  /^127\./.test(hostname);

/**
 * Refuse to run with a weak secret, a non-HTTPS production URL, or a URL that
 * carries credentials. The ingest secret is a bearer token: sending it over
 * plain HTTP or logging it in a URL would hand out write access to the uptime
 * history.
 */
export const assertConfig = (config: MonitorConfig): void => {
  if (!config.secret) {
    throw new Error(
      "UPTIME_INGEST_SECRET is required; refusing to start without it",
    );
  }
  if (config.secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `UPTIME_INGEST_SECRET must be at least ${MIN_SECRET_LENGTH} characters`,
    );
  }

  let base: URL;
  try {
    base = new URL(config.baseUrl);
  } catch {
    throw new Error("MONITOR_BASE_URL is not a valid URL");
  }
  if (base.username || base.password) {
    throw new Error("MONITOR_BASE_URL must not embed credentials");
  }
  if (base.protocol !== "https:" && !isLoopback(base.hostname)) {
    throw new Error(
      "MONITOR_BASE_URL must use HTTPS (plain HTTP is allowed only for loopback)",
    );
  }

  try {
    new URL(config.portalUrl);
  } catch {
    throw new Error("MONITOR_PORTAL_URL is not a valid URL");
  }

  if (config.botToken && !TELEGRAM_TOKEN.test(config.botToken)) {
    throw new Error("MONITOR_TELEGRAM_BOT_TOKEN is not a Telegram bot token");
  }
  if (config.adminId && !TELEGRAM_CHAT.test(config.adminId)) {
    throw new Error("ADMIN_ID is not a numeric chat id or @channel name");
  }
};

/** The database stores UTC in SQLite's "YYYY-MM-DD HH:MM:SS" shape. */
export const sqliteTimestamp = (date: Date = new Date()): string =>
  date.toISOString().slice(0, 19).replace("T", " ");

const down = (component: Component): ProbeResult => ({
  component,
  status: "down",
  latencyMs: null,
  at: sqliteTimestamp(),
});

const timed = async (
  component: Component,
  probe: () => Promise<void>,
): Promise<ProbeResult> => {
  const start = Date.now();
  try {
    await probe();
    return {
      component,
      status: "up",
      latencyMs: Date.now() - start,
      at: sqliteTimestamp(),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log(`[probe] ${component} failed: ${message}`);
    return down(component);
  }
};

type FetchInit = Parameters<typeof fetch>[1];
type FetchResponse = Awaited<ReturnType<typeof fetch>>;

const request = (url: string, init: FetchInit = {}): Promise<FetchResponse> =>
  fetch(url, {
    // Never follow a redirect with the ingest secret attached. The portal
    // probe opts back into redirects explicitly because it sends no secret.
    redirect: "error",
    ...init,
    signal: globalThis.AbortSignal.timeout(CONFIG.timeoutMs),
  });

export const probeApi = (): Promise<ProbeResult> =>
  timed("api", async () => {
    const res = await request(`${CONFIG.baseUrl}/health`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`HTTP ${res.status}`);
    }
    const body = (await res.json()) as { status?: unknown };
    if (body.status !== "ok") throw new Error("unexpected health payload");
  });

export const probePortal = (): Promise<ProbeResult> =>
  timed("portal", async () => {
    // Any HTTP response means the portal host is reachable; a 4xx is still a
    // live host and must not be reported as an outage.
    const res = await request(CONFIG.portalUrl, { redirect: "follow" });
    await res.body?.cancel();
  });

type DeepComponent = {
  component?: unknown;
  status?: unknown;
  latencyMs?: unknown;
};

const probeDeep = async (): Promise<{
  database: ProbeResult;
  redis: ProbeResult;
}> => {
  const res = await request(`${CONFIG.baseUrl}/internal/health`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${CONFIG.secret}`,
    },
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status}`);
  }

  const payload = (await res.json()) as { components?: unknown };
  if (!Array.isArray(payload.components)) {
    throw new Error("invalid deep health payload");
  }

  const byName = new Map<string, DeepComponent>();
  for (const item of payload.components) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as DeepComponent).component === "string"
    ) {
      byName.set((item as DeepComponent).component as string, item);
    }
  }

  const read = (component: "database" | "redis"): ProbeResult => {
    const item = byName.get(component);
    if (!item) return down(component);

    const status = item.status;
    if (status !== "up" && status !== "down") return down(component);

    const latencyMs =
      typeof item.latencyMs === "number" && Number.isFinite(item.latencyMs)
        ? Math.round(item.latencyMs)
        : null;

    return { component, status, latencyMs, at: sqliteTimestamp() };
  };

  return { database: read("database"), redis: read("redis") };
};

const reprobe = async (component: Component): Promise<ProbeResult> => {
  if (component === "api") return probeApi();
  if (component === "portal") return probePortal();

  try {
    const deep = await probeDeep();
    return deep[component];
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log(`[probe] deep retry for ${component} failed: ${message}`);
    return down(component);
  }
};

export const spoolPath = (): string =>
  path.join(CONFIG.stateDir, "spool.jsonl");
const SQLITE_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const isRow = (value: unknown): value is ProbeResult => {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  const component = row.component;
  const status = row.status;
  const latencyMs = row.latencyMs;

  return (
    typeof component === "string" &&
    COMPONENTS.includes(component as Component) &&
    (status === "up" || status === "down") &&
    (latencyMs === null ||
      (typeof latencyMs === "number" &&
        Number.isInteger(latencyMs) &&
        latencyMs >= 0 &&
        latencyMs <= 300_000)) &&
    typeof row.at === "string" &&
    SQLITE_TIMESTAMP.test(row.at)
  );
};

export const readSpool = async (): Promise<ProbeResult[]> => {
  try {
    const raw = await readFile(spoolPath(), "utf8");
    const rows: ProbeResult[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (isRow(parsed)) rows.push(parsed);
      } catch {
        // a torn final line after a hard stop is not worth failing over
      }
    }
    return rows;
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return [];
    throw e;
  }
};

export const writeSpool = async (rows: ProbeResult[]): Promise<void> => {
  const target = spoolPath();
  const temp = `${target}.tmp`;
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  await writeFile(temp, body ? `${body}\n` : "", {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temp, target);
};

export const appendSpool = async (rows: ProbeResult[]): Promise<void> => {
  if (rows.length === 0) return;
  await appendFile(
    spoolPath(),
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    { encoding: "utf8", mode: 0o600 },
  );

  const pending = await readSpool();
  if (pending.length > CONFIG.spoolLimit) {
    log(`[spool] ${pending.length} rows queued — dropping the oldest`);
    await writeSpool(pending.slice(-CONFIG.spoolLimit));
  }
};

const postRows = async (rows: ProbeResult[]): Promise<void> => {
  const res = await request(`${CONFIG.baseUrl}/internal/uptime`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${CONFIG.secret}`,
    },
    body: JSON.stringify({ rows }),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  await res.body?.cancel();
};

const INGEST_CHUNK = 100;

/** Sends the oldest queued rows first; a failure leaves the rest on disk. */
export const flushSpool = async (): Promise<boolean> => {
  const pending = await readSpool();
  if (pending.length === 0) return true;

  for (let i = 0; i < pending.length; i += INGEST_CHUNK) {
    const chunk = pending.slice(i, i + INGEST_CHUNK);
    try {
      await postRows(chunk);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log(`[spool] replay failed after ${i} rows: ${message}`);
      await writeSpool(pending.slice(i));
      return false;
    }
  }

  await writeSpool([]);
  log(`[spool] replayed ${pending.length} queued rows`);
  return true;
};

export const submit = async (
  rows: ProbeResult[],
  apiUp: boolean,
): Promise<void> => {
  if (!apiUp) {
    await appendSpool(rows);
    return;
  }

  const flushed = await flushSpool();
  if (!flushed) {
    await appendSpool(rows);
    return;
  }

  try {
    await postRows(rows);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log(`[ingest] write failed: ${message} — spooling for retry`);
    await appendSpool(rows);
  }
};

const statePath = (): string => path.join(CONFIG.stateDir, "state.json");

type MonitorState = Record<string, ComponentStatus | undefined>;

const readState = async (): Promise<MonitorState> => {
  try {
    const raw = await readFile(statePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }

    const state: MonitorState = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === "up" || value === "down") state[key] = value;
    }
    return state;
  } catch {
    return {};
  }
};

const writeState = async (state: MonitorState): Promise<void> => {
  const target = statePath();
  const temp = `${target}.tmp`;
  await writeFile(temp, `${JSON.stringify(state)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temp, target);
};

export const isTransition = (
  previous: ComponentStatus | undefined,
  next: ComponentStatus,
): boolean => previous !== undefined && previous !== next;

export const formatAlert = (row: ProbeResult): string => {
  const wentDown = row.status === "down";
  const latency = row.latencyMs === null ? "timeout" : `${row.latencyMs}ms`;
  return (
    `${wentDown ? "🔴" : "🟢"} <b>${row.component}</b> is ` +
    `${wentDown ? "DOWN" : "back UP"}\n` +
    `Probe latency: ${latency}\n` +
    `<i>External probe</i>`
  );
};

const sendAlert = async (row: ProbeResult): Promise<boolean> => {
  if (!CONFIG.botToken || !CONFIG.adminId) {
    log(
      "[alert] alerting is not configured — transition recorded without a message",
    );
    return true;
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${CONFIG.botToken}/sendMessage`,
      {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: CONFIG.adminId,
          text: formatAlert(row),
          parse_mode: "HTML",
          disable_notification: row.status === "up",
        }),
        signal: globalThis.AbortSignal.timeout(CONFIG.timeoutMs),
      },
    );
    await res.body?.cancel();
    if (!res.ok) {
      log(`[alert] Telegram returned HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch {
    // never log the error object: the request URL contains the bot token
    log("[alert] Telegram request failed");
    return false;
  }
};

/**
 * Checks the alert credentials once at startup. A wrong token or an admin who
 * never started the bot would otherwise stay invisible until the first
 * outage, which is exactly the wrong moment to discover it.
 */
const checkAlertChannel = async (): Promise<void> => {
  if (!CONFIG.botToken || !CONFIG.adminId) return;

  const check = async (method: string, query = ""): Promise<boolean> => {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${CONFIG.botToken}/${method}${query}`,
        {
          redirect: "error",
          signal: globalThis.AbortSignal.timeout(CONFIG.timeoutMs),
        },
      );
      await res.body?.cancel();
      if (!res.ok) {
        log(`[alert] Telegram ${method} returned HTTP ${res.status}`);
        return false;
      }
      return true;
    } catch {
      // never log the error object: the request URL contains the bot token
      log(`[alert] Telegram ${method} request failed`);
      return false;
    }
  };

  if (!(await check("getMe"))) return;
  await check("getChat", `?chat_id=${encodeURIComponent(CONFIG.adminId)}`);
};

export const notifyTransitions = async (rows: ProbeResult[]): Promise<void> => {
  const state = await readState();
  let changed = false;

  for (const row of rows) {
    const previous = state[row.component];

    if (previous === undefined) {
      // Fresh state file (first run, or a component added later). Seed it, but
      // do not swallow an outage: an up result is silent, a down result alerts
      // once. The status is cached first, so the same outage is not alerted on
      // every cycle. A failed send leaves the state unseeded so it retries.
      if (row.status === "up") {
        state[row.component] = row.status;
        changed = true;
        continue;
      }

      const sentFresh = await sendAlert(row);
      if (!sentFresh) {
        log(
          `[alert] fresh state reports ${row.component} down — alert not delivered, will retry`,
        );
        continue;
      }

      state[row.component] = row.status;
      changed = true;
      continue;
    }

    if (!isTransition(previous, row.status)) continue;

    const sent = await sendAlert(row);
    if (!sent) {
      // Leave the previous state in place so the transition is retried on the
      // next cycle instead of being silently lost.
      log(
        `[alert] ${row.component} transition to ${row.status} not delivered — will retry`,
      );
      continue;
    }

    state[row.component] = row.status;
    changed = true;
  }

  if (changed) await writeState(state);
};

let running = false;
let startedAt = 0;
let lastCycleCompletedAt = 0;

export const runCycle = async (): Promise<void> => {
  if (running) {
    log("[cycle] previous cycle still running — skipping");
    return;
  }
  running = true;

  try {
    const [api, portal] = await Promise.all([probeApi(), probePortal()]);
    const first: ProbeResult[] = [api, portal];

    // Database and Redis live inside the API process/host. If the public API
    // cannot be reached they were not checked: recording them as down would
    // invent an outage the monitor never observed. Leave them out of this
    // cycle so the status page keeps showing its last known (or no) data.
    if (api.status !== "up") {
      log("[probe] api is down — database/redis were not checked");
    } else {
      try {
        const internal = await probeDeep();
        first.push(internal.database, internal.redis);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log(
          `[probe] deep health failed: ${message} — database/redis were not checked`,
        );
      }
    }

    // A short VM pause can fail every probe at once. Re-probe only failures
    // among the components that were actually probed; a single blip is
    // recorded as healthy, not as an outage.
    const confirmed = await Promise.all(
      first.map(async (result) => {
        if (result.status === "up") return result;
        await sleep(CONFIG.confirmMs);
        return reprobe(result.component);
      }),
    );

    const apiUp =
      confirmed.find((result) => result.component === "api")?.status === "up";
    await submit(confirmed, apiUp);
    await notifyTransitions(confirmed);
    lastCycleCompletedAt = Date.now();
    log(
      `[cycle] ${confirmed.map((r) => `${r.component}=${r.status}`).join(" ")}`,
    );
  } finally {
    running = false;
  }
};

const main = async (): Promise<void> => {
  process.umask(0o077);

  try {
    assertConfig(CONFIG);
  } catch (e) {
    console.error(`[monitor] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  await mkdir(CONFIG.stateDir, { recursive: true, mode: 0o700 });
  await chmod(CONFIG.stateDir, 0o700).catch(() => undefined);

  if (!CONFIG.botToken || !CONFIG.adminId) {
    console.warn(
      "[monitor] alerting is not configured — transitions will be recorded without a Telegram message",
    );
  } else {
    await checkAlertChannel();
  }

  log(
    `[monitor] starting: api=${CONFIG.baseUrl} portal=${CONFIG.portalUrl} ` +
      `interval=${CONFIG.intervalMs}ms state=${CONFIG.stateDir}`,
  );

  startedAt = Date.now();

  const tick = () => {
    void runCycle().catch((e) => {
      const message = e instanceof Error ? e.message : String(e);
      log(`[cycle] crashed: ${message}`);
    });
  };

  await sleep(10_000);
  tick();
  const timer = setInterval(tick, CONFIG.intervalMs);

  // A hung fetch or a dead event loop would otherwise leave the service
  // "active" while recording nothing. Exit and let systemd restart it.
  const staleAfterMs =
    CONFIG.intervalMs + CONFIG.timeoutMs * 3 + CONFIG.confirmMs + 60_000;
  const watchdog = setInterval(
    () => {
      const now = Date.now();
      const reference = lastCycleCompletedAt || startedAt;
      if (now - reference > staleAfterMs) {
        log(
          `[watchdog] no completed cycle in ${Math.round(
            (now - reference) / 1000,
          )}s — exiting for systemd restart`,
        );
        process.exit(1);
      }
    },
    Math.min(60_000, CONFIG.intervalMs),
  );

  const stop = (signal: string) => {
    log(`[monitor] ${signal} received, stopping`);
    clearInterval(timer);
    clearInterval(watchdog);
    process.exit(0);
  };

  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));
};

const entry = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;

if (entry) {
  void main().catch((e) => {
    console.error(
      `[monitor] fatal: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  });
}
