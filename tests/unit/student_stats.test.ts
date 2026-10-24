import { describe, it, expect, beforeAll } from "vitest";
import { turso } from "../../src/db/db";
import {
  getLeaderboard,
  initLeaderboardIndexes,
  initUptimeTable,
  getUptimeDailyBuckets,
  getUptimeSummary,
  recordHeartbeat,
} from "../../src/db/student_stats.model";

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
    expect(rows.map((r: { rank: number }) => r.rank)).toEqual([1, 1, 3]);
  });

  it("should apply section filters to rows and total", async () => {
    const { rows, total } = await getLeaderboard("attendance", 10, 0, {
      section: "B",
    });

    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { roll_no: string }).roll_no).toBe("AAA00003");
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

describe("getUptimeSummary", () => {
  it("reports the newest heartbeat's status, not just the newest ping", async () => {
    await initUptimeTable();
    await turso.execute("DELETE FROM uptime_log WHERE component = 'portal'");

    await recordHeartbeat("portal", "up", 12);
    await recordHeartbeat("portal", "down", null);
    await recordHeartbeat("portal", "down", null);

    const summary = await getUptimeSummary();
    const portal = summary.find((s) => s.component === "portal");

    expect(portal?.lastStatus).toBe("down");
    expect(portal?.lastPing).toBeTruthy();
  });
});
