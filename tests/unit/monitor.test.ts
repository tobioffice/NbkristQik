import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendSpool,
  assertConfig,
  flushSpool,
  formatAlert,
  isTransition,
  notifyTransitions,
  readConfig,
  readSpool,
  runCycle,
  setMonitorConfigForTests,
  spoolPath,
  sqliteTimestamp,
  submit,
  writeSpool,
  type Component,
  type ProbeResult,
} from "../../src/monitor/index.js";
import { isHeartbeatRow, isValidTimestamp } from "../../src/api/internal.js";

describe("external uptime monitor", () => {
  it("formats timestamps in the database's UTC shape", () => {
    expect(sqliteTimestamp(new Date("2026-01-02T03:04:05.678Z"))).toBe(
      "2026-01-02 03:04:05",
    );
  });

  it("only alerts on a real status change", () => {
    expect(isTransition(undefined, "down")).toBe(false);
    expect(isTransition("up", "up")).toBe(false);
    expect(isTransition("down", "down")).toBe(false);
    expect(isTransition("up", "down")).toBe(true);
    expect(isTransition("down", "up")).toBe(true);
  });

  it("renders a down alert without leaking the monitor secret", () => {
    const alert = formatAlert({
      component: "api",
      status: "down",
      latencyMs: null,
      at: "2026-11-04 04:00:00",
    });

    expect(alert).toContain("<b>api</b> is DOWN");
    expect(alert).toContain("timeout");
    expect(alert).not.toContain(readConfig().secret);
  });

  it("refuses a missing or short ingest secret", () => {
    const config = readConfig();

    expect(() => assertConfig({ ...config, secret: "" })).toThrow(
      /UPTIME_INGEST_SECRET is required/,
    );
    expect(() => assertConfig({ ...config, secret: "too-short" })).toThrow(
      /at least 32/,
    );
  });

  it("refuses plain HTTP to a remote host but allows loopback", () => {
    const config = readConfig();

    expect(() =>
      assertConfig({ ...config, baseUrl: "http://checker.example" }),
    ).toThrow(/must use HTTPS/);
    expect(() =>
      assertConfig({ ...config, baseUrl: "http://127.0.0.1:3000" }),
    ).not.toThrow();
  });

  it("refuses credentials embedded in the base URL", () => {
    const config = readConfig();

    expect(() =>
      assertConfig({
        ...config,
        baseUrl: "https://user:pass@checker.example",
      }),
    ).toThrow(/must not embed credentials/);
  });

  it("refuses malformed Telegram credentials", () => {
    const config = readConfig();

    expect(() =>
      assertConfig({ ...config, botToken: "not-a-bot-token" }),
    ).toThrow(/not a Telegram bot token/);
    expect(() => assertConfig({ ...config, adminId: "not a chat id" })).toThrow(
      /ADMIN_ID/,
    );
  });

  it("accepts the production-shaped config", () => {
    expect(() => assertConfig(readConfig())).not.toThrow();
  });
});

describe("heartbeat ingest validation", () => {
  const row = {
    component: "api",
    status: "up",
    latencyMs: 12,
    at: sqliteTimestamp(new Date()),
  };

  it("accepts a well-formed row", () => {
    expect(isHeartbeatRow(row)).toBe(true);
  });

  it("rejects unknown components and statuses", () => {
    expect(isHeartbeatRow({ ...row, component: "portal2" })).toBe(false);
    expect(isHeartbeatRow({ ...row, status: "degraded" })).toBe(false);
  });

  it("rejects impossible latencies", () => {
    expect(isHeartbeatRow({ ...row, latencyMs: -1 })).toBe(false);
    expect(isHeartbeatRow({ ...row, latencyMs: 1.5 })).toBe(false);
    expect(isHeartbeatRow({ ...row, latencyMs: 300001 })).toBe(false);
    expect(isHeartbeatRow({ ...row, latencyMs: null })).toBe(true);
  });

  it("rejects future and expired timestamps", () => {
    const future = sqliteTimestamp(new Date(Date.now() + 11 * 60 * 1000));
    const expired = sqliteTimestamp(
      new Date(Date.now() - 96 * 24 * 60 * 60 * 1000),
    );

    expect(isValidTimestamp(future)).toBe(false);
    expect(isValidTimestamp(expired)).toBe(false);
    expect(isHeartbeatRow({ ...row, at: future })).toBe(false);
    expect(isHeartbeatRow({ ...row, at: expired })).toBe(false);
  });

  it("rejects malformed timestamps", () => {
    expect(isHeartbeatRow({ ...row, at: "2026-11-04T04:00:00Z" })).toBe(false);
    expect(isHeartbeatRow({ ...row, at: "" })).toBe(false);
  });
});

type StubResponse = {
  ok: boolean;
  status: number;
  body: { cancel: () => Promise<void> };
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

const response = ({
  ok = true,
  status = 200,
  json = {},
  text = "",
}: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
} = {}): StubResponse => ({
  ok,
  status,
  body: { cancel: async () => undefined },
  json: async () => json,
  text: async () => text,
});

type StubFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

const stubFetch = (
  impl: (url: string, init?: StubFetchInit) => Promise<StubResponse>,
) => {
  const mock = vi.fn(async (input: string, init?: StubFetchInit) =>
    impl(String(input), init),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
};

const TEST_SECRET = "test_monitor_secret_0123456789abcdef";
const TELEGRAM_TOKEN = "123456789:test_monitor_token";
const ADMIN_CHAT = "123456789";

const makeRow = (
  component: Component,
  status: "up" | "down",
  latencyMs: number | null = status === "up" ? 5 : null,
): ProbeResult => ({
  component,
  status,
  latencyMs,
  at: sqliteTimestamp(),
});

let stateDir = "";

beforeEach(async () => {
  stateDir = await mkdtemp(path.join(os.tmpdir(), "nbkristqik-monitor-"));
  setMonitorConfigForTests({
    baseUrl: "https://monitor.test",
    portalUrl: "https://portal.test",
    secret: TEST_SECRET,
    botToken: "",
    adminId: "",
    stateDir,
    intervalMs: 60_000,
    timeoutMs: 1_000,
    confirmMs: 0,
    spoolLimit: 10_000,
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(stateDir, { recursive: true, force: true });
});

describe("monitor spool", () => {
  it("round-trips rows and ignores blank, torn and invalid lines", async () => {
    const first = makeRow("api", "up", 12);
    const second = makeRow("portal", "down");
    const third = makeRow("database", "up", 3);

    await appendSpool([first, second]);
    await appendSpool([third]);
    // a blank line, a torn final write after a hard stop, and a row whose
    // timestamp does not match the database's shape must all be ignored
    await appendFile(
      spoolPath(),
      '\n{"component":"redis","status":"up"',
      "utf8",
    );
    await appendFile(
      spoolPath(),
      '\n{"component":"api","status":"up","latencyMs":5,"at":"yesterday"}\n',
      "utf8",
    );

    expect(await readSpool()).toEqual([first, second, third]);

    await writeSpool([second]);
    expect(await readSpool()).toEqual([second]);
  });

  it("posts chunks in order and keeps the un-replayed tail when a chunk fails", async () => {
    const rows = Array.from({ length: 250 }, (_, index) =>
      makeRow("api", index % 3 === 0 ? "down" : "up", index),
    );
    await writeSpool(rows);

    const posted: ProbeResult[][] = [];
    const fetchMock = stubFetch(async (url, init) => {
      expect(url).toBe("https://monitor.test/internal/uptime");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        authorization: `Bearer ${TEST_SECRET}`,
      });
      const body = JSON.parse(String(init?.body)) as { rows: ProbeResult[] };
      posted.push(body.rows);
      if (posted.length === 2) {
        return response({ ok: false, status: 500, text: "ingest exploded" });
      }
      return response();
    });

    await expect(flushSpool()).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(posted[0]).toEqual(rows.slice(0, 100));
    expect(posted[1]).toEqual(rows.slice(100, 200));
    // the failed chunk and everything after it stay queued for the next run
    expect(await readSpool()).toEqual(rows.slice(100));

    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { rows: ProbeResult[] };
      posted.push(body.rows);
      return response();
    });
    await expect(flushSpool()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(posted[2]).toEqual(rows.slice(100, 200));
    expect(posted[3]).toEqual(rows.slice(200));
    expect(await readSpool()).toEqual([]);
  });

  it("spools while the API is down and posts after it recovers", async () => {
    const queued = makeRow("api", "down");
    const fetchMock = stubFetch(async () => response());

    await submit([queued], false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await readSpool()).toEqual([queued]);

    await submit([makeRow("portal", "up", 7)], true);
    // the queued row is replayed first, then the new rows go out
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await readSpool()).toEqual([]);
  });
});

describe("monitor transitions", () => {
  const configureTelegram = () =>
    setMonitorConfigForTests({
      botToken: TELEGRAM_TOKEN,
      adminId: ADMIN_CHAT,
    });

  it("alerts on a down transition, not on repeats, and still on recovery", async () => {
    configureTelegram();
    const fetchMock = stubFetch(async () => response());

    await notifyTransitions([makeRow("api", "up", 5)]);
    expect(fetchMock).not.toHaveBeenCalled();

    await notifyTransitions([makeRow("api", "down")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const downBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      text: string;
      chat_id: string;
      disable_notification: boolean;
    };
    expect(downBody.text).toContain("<b>api</b> is DOWN");
    expect(downBody.chat_id).toBe(ADMIN_CHAT);
    expect(downBody.disable_notification).toBe(false);

    await notifyTransitions([makeRow("api", "down")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await notifyTransitions([makeRow("api", "up", 9)]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const upBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      text: string;
      disable_notification: boolean;
    };
    expect(upBody.text).toContain("back UP");
    expect(upBody.disable_notification).toBe(true);
  });

  it("alerts at least once when a fresh state already reports down", async () => {
    configureTelegram();
    const fetchMock = stubFetch(async () => response());

    await notifyTransitions([makeRow("database", "down")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).text,
    ).toContain("<b>database</b> is DOWN");

    // the seeded state makes the next identical cycle silent
    await notifyTransitions([makeRow("database", "down")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a failed fresh-down alert instead of seeding it silently", async () => {
    configureTelegram();
    const fetchMock = stubFetch(async () =>
      response({ ok: false, status: 500 }),
    );

    await notifyTransitions([makeRow("redis", "down")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockImplementation(async () => response());
    await notifyTransitions([makeRow("redis", "down")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await notifyTransitions([makeRow("redis", "down")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("monitor cycle truthfulness", () => {
  it("submits only api and portal when the API probe is down", async () => {
    const fetchMock = stubFetch(async (url) => {
      if (url === "https://monitor.test/health") {
        return response({ ok: false, status: 503 });
      }
      if (url === "https://portal.test") return response();
      throw new Error(`unexpected fetch: ${url}`);
    });

    await runCycle();

    const spooled = await readSpool();
    expect(spooled.map((row) => row.component)).toEqual(["api", "portal"]);
    expect(spooled.find((row) => row.component === "api")?.status).toBe("down");
    expect(spooled.find((row) => row.component === "portal")?.status).toBe(
      "up",
    );
    expect(
      spooled.some(
        (row) => row.component === "database" || row.component === "redis",
      ),
    ).toBe(false);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/internal/"),
      ),
    ).toBe(false);
  });

  it("does not invent database/redis rows when deep health fails", async () => {
    const fetchMock = stubFetch(async (url) => {
      if (url === "https://monitor.test/health") {
        return response({ json: { status: "ok" } });
      }
      if (url === "https://monitor.test/internal/health") {
        return response({ ok: false, status: 500, text: "boom" });
      }
      if (url === "https://portal.test") return response();
      if (url === "https://monitor.test/internal/uptime") return response();
      throw new Error(`unexpected fetch: ${url}`);
    });

    await runCycle();

    expect(await readSpool()).toEqual([]);
    const post = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/internal/uptime"),
    );
    expect(post).toBeDefined();
    const body = JSON.parse(String(post?.[1]?.body)) as { rows: ProbeResult[] };
    expect(body.rows.map((row) => row.component)).toEqual(["api", "portal"]);
  });

  it("records database and redis when deep health answers", async () => {
    const fetchMock = stubFetch(async (url) => {
      if (url === "https://monitor.test/health") {
        return response({ json: { status: "ok" } });
      }
      if (url === "https://monitor.test/internal/health") {
        return response({
          json: {
            components: [
              { component: "database", status: "up", latencyMs: 4 },
              { component: "redis", status: "up", latencyMs: 2 },
            ],
          },
        });
      }
      if (url === "https://portal.test") return response();
      if (url === "https://monitor.test/internal/uptime") return response();
      throw new Error(`unexpected fetch: ${url}`);
    });

    await runCycle();

    const post = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/internal/uptime"),
    );
    const body = JSON.parse(String(post?.[1]?.body)) as { rows: ProbeResult[] };
    expect(body.rows.map((row) => row.component)).toEqual([
      "api",
      "portal",
      "database",
      "redis",
    ]);
  });
});

describe("internal route registration", () => {
  const restoreSecret = (original: string | undefined) => {
    if (original === undefined) delete process.env.UPTIME_INGEST_SECRET;
    else process.env.UPTIME_INGEST_SECRET = original;
    vi.resetModules();
  };

  it("fails closed when the configured ingest secret is too short", async () => {
    const original = process.env.UPTIME_INGEST_SECRET;
    vi.resetModules();
    process.env.UPTIME_INGEST_SECRET = "short-secret";

    try {
      const { registerInternalRoutes } =
        await import("../../src/api/internal.js");
      const get = vi.fn();
      const post = vi.fn();

      registerInternalRoutes({ get, post } as never);

      expect(get).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    } finally {
      restoreSecret(original);
    }
  });

  it("registers both routes at the 32-character boundary", async () => {
    const original = process.env.UPTIME_INGEST_SECRET;
    vi.resetModules();
    process.env.UPTIME_INGEST_SECRET = "a".repeat(32);

    try {
      const { registerInternalRoutes } =
        await import("../../src/api/internal.js");
      const get = vi.fn();
      const post = vi.fn();

      registerInternalRoutes({ get, post } as never);

      expect(get).toHaveBeenCalledTimes(1);
      expect(get.mock.calls[0]?.[0]).toBe("/internal/health");
      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0]?.[0]).toBe("/internal/uptime");
    } finally {
      restoreSecret(original);
    }
  });
});
