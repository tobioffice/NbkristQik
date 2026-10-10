import { describe, it, expect, beforeAll } from "vitest";
import { turso } from "../../src/db/db";
import {
  getLeaderboard,
  initLeaderboardIndexes,
  initUptimeTable,
  getUptimeDailyBuckets,
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
    // 18:20 UTC = 23:50 IST Sep 24; 18:40 UTC = 00:10 IST Sep 25
    await turso.execute(
      "INSERT INTO uptime_log (component, status, latency_ms, created_at) VALUES ('api', 'up', 5, '2026-09-24 18:20:00')",
    );
    await turso.execute(
      "INSERT INTO uptime_log (component, status, latency_ms, created_at) VALUES ('api', 'up', 6, '2026-09-24 18:40:00')",
    );

    const buckets = await getUptimeDailyBuckets("api", 30);
    const byDay = Object.fromEntries(buckets.map((b) => [b.day, b.pings]));

    expect(byDay["2026-09-24"]).toBe(1);
    expect(byDay["2026-09-25"]).toBe(1);
  });
});
