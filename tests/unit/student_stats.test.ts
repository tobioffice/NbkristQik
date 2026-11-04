import { describe, it, expect, beforeAll } from "vitest";
import { turso } from "../../src/db/db.js";
import {
  getLeaderboard,
  initLeaderboardIndexes,
  initUptimeTable,
  getUptimeDailyBuckets,
  getUptimeSummary,
  recordHeartbeatAt,
  recordHeartbeatsAt,
} from "../../src/db/student_stats.model.js";

beforeAll(async () => {
  await turso.execute(`CREATE TABLE student_stats (
    roll_no TEXT PRIMARY KEY,
    attendance_percentage REAL,
    mid_marks_avg REAL,
    last_updated TEXT
  )`);
  await turso.execute(`CREATE TABLE studentsnew (
    roll_no TEXT PRIMARY KEY,
    name TEXT,
    section TEXT,
    branch TEXT,
    year TEXT
  )`);
  // getLeaderboard reads explicit display names from registrations; the
  // privacy/name cases live in leaderboardPrivacy.test.ts.
  await turso.execute(`CREATE TABLE registrations (
    userId TEXT PRIMARY KEY,
    roll_no TEXT NOT NULL,
    display_name TEXT,
    registered_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const students = [
    ["AAA00001", "Alice", "A", "5", "31", 90.0, 28.0],
    ["AAA00002", "Bob", "A", "5", "31", 90.0, 27.0],
    ["AAA00003", "Cara", "B", "5", "31", 85.5, 29.0],
  ] as const;

  for (const [roll, name, section, branch, year, att, mid] of students) {
    await turso.execute({
      sql: "INSERT INTO studentsnew VALUES (?, ?, ?, ?, ?)",
      args: [roll, name, section, branch, year],
    });
    await turso.execute({
      sql: "INSERT INTO student_stats VALUES (?, ?, ?, ?)",
      args: [roll, att, mid, new Date().toISOString()],
    });
  }
});

describe("getLeaderboard", () => {
  it("should share ranks across ties and report the filtered total", async () => {
    const { rows, total } = await getLeaderboard("attendance", 10, 0, {});

    expect(total).toBe(3);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it("should apply section filters to rows and total", async () => {
    const { rows, total } = await getLeaderboard("attendance", 10, 0, {
      section: "B",
    });

    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].roll_no).toBe("AAA00003");
  });
});

describe("initLeaderboardIndexes", () => {
  it("should create the filter index", async () => {
    await initLeaderboardIndexes();

    const result = await turso.execute(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_studentsnew_filters'",
    );
    expect(result.rows).toHaveLength(1);
  });
});

describe("getUptimeDailyBuckets", () => {
  it("should group buckets by IST day boundaries, not UTC", async () => {
    await initUptimeTable();

    // Built from the clock, not from fixed dates: the query keeps only the
    // last 30 days, so a hard-coded pair of rows stops straddling a boundary
    // as soon as the calendar walks past it.
    const IST_MS = 5.5 * 60 * 60 * 1000;
    const istDay = (at: Date) =>
      new Date(at.getTime() + IST_MS).toISOString().slice(0, 10);
    const sqlTime = (at: Date) =>
      at.toISOString().slice(0, 19).replace("T", " ");
    const ist = new Date(Date.now() + IST_MS);
    const midnight =
      Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) -
      IST_MS;
    // 10 minutes either side of IST midnight: two UTC timestamps, two IST days
    const before = new Date(midnight - 10 * 60 * 1000);
    const after = new Date(midnight + 10 * 60 * 1000);

    await turso.execute({
      sql: "INSERT INTO uptime_log (component, status, latency_ms, created_at) VALUES (?, ?, ?, ?)",
      args: ["api", "up", 5, sqlTime(before)],
    });
    await turso.execute({
      sql: "INSERT INTO uptime_log (component, status, latency_ms, created_at) VALUES (?, ?, ?, ?)",
      args: ["api", "up", 6, sqlTime(after)],
    });

    const buckets = await getUptimeDailyBuckets("api", 30);
    const byDay = Object.fromEntries(buckets.map((b) => [b.day, b.pings]));

    expect(istDay(before)).not.toBe(istDay(after));
    expect(byDay[istDay(before)]).toBe(1);
    expect(byDay[istDay(after)]).toBe(1);
  });
});

describe("recordHeartbeatAt", () => {
  it("stores a replayed spool row only once", async () => {
    await initUptimeTable();
    await turso.execute("DELETE FROM uptime_log WHERE component = 'redis'");

    const at = new Date(Date.now() - 60_000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");

    await recordHeartbeatAt("redis", "up", 20, at);
    await recordHeartbeatAt("redis", "up", 20, at);

    const summary = await getUptimeSummary();
    const redis = summary.find((s) => s.component === "redis");

    expect(redis?.pings).toBe(1);
    expect(redis?.lastPing).toBe(at);
  });
});

describe("recordHeartbeatsAt", () => {
  it("writes a replayed batch once and ignores duplicate timestamps", async () => {
    await initUptimeTable();
    await turso.execute("DELETE FROM uptime_log WHERE component = 'api'");

    const at = new Date(Date.now() - 30_000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    const rows = [
      { component: "api", status: "up" as const, latencyMs: 12, at },
      { component: "api", status: "up" as const, latencyMs: 13, at },
    ];

    await recordHeartbeatsAt(rows);
    await recordHeartbeatsAt(rows);

    const summary = await getUptimeSummary();
    expect(summary.find((s) => s.component === "api")?.pings).toBe(1);
  });
});

describe("getUptimeSummary", () => {
  it("reports the newest heartbeat's status, not just the newest ping", async () => {
    await initUptimeTable();
    await turso.execute("DELETE FROM uptime_log WHERE component = 'portal'");

    const at = (secondsAgo: number) =>
      new Date(Date.now() - secondsAgo * 1000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
    await recordHeartbeatAt("portal", "up", 12, at(3));
    await recordHeartbeatAt("portal", "down", null, at(2));
    await recordHeartbeatAt("portal", "down", null, at(1));

    const summary = await getUptimeSummary();
    const portal = summary.find((s) => s.component === "portal");

    expect(portal?.lastStatus).toBe("down");
    expect(portal?.lastPing).toBeTruthy();
  });
});
