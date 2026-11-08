import { describe, it, expect, beforeAll } from "vitest";
import { turso } from "../../src/db/db.js";
import {
  getLeaderboard,
  getLeaderboardCoverage,
  getLeaderboardFacets,
  getLastSyncAt,
  getStudentRank,
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
    last_updated TEXT,
    attendance_updated_at TEXT,
    midmarks_updated_at TEXT,
    year_sem TEXT
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

  // Each metric has its own age: attendance refreshed within hours, mid-marks
  // days ago. The shared last_updated is deliberately not the freshness source.
  const students = [
    ["AAA00001", "Alice", "A", "5", "31", 90.0, 28.0, "2 hours", "6 days"],
    ["AAA00002", "Bob", "A", "5", "31", 90.0, 27.0, "1 hour", "5 days"],
    ["AAA00003", "Cara", "B", "5", "31", 85.5, 29.0, "3 hours", "4 days"],
  ] as const;

  for (const [
    roll,
    name,
    section,
    branch,
    year,
    att,
    mid,
    attAge,
    midAge,
  ] of students) {
    await turso.execute({
      sql: "INSERT INTO studentsnew VALUES (?, ?, ?, ?, ?)",
      args: [roll, name, section, branch, year],
    });
    await turso.execute({
      sql: `INSERT INTO student_stats
              (roll_no, attendance_percentage, mid_marks_avg, last_updated,
               attendance_updated_at, midmarks_updated_at, year_sem)
            VALUES (?, ?, ?, datetime('now'), datetime('now', ?), datetime('now', ?), ?)`,
      args: [roll, att, mid, `-${attAge}`, `-${midAge}`, year],
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

  it("matches both semester codes for a year digit and keeps facets in step", async () => {
    await turso.batch(
      [
        `INSERT INTO studentsnew VALUES ('BBB00011', 'Year One Sem One', 'A', '5', '11')`,
        `INSERT INTO studentsnew VALUES ('BBB00012', 'Year One Sem Two', 'A', '5', '12')`,
        `INSERT INTO student_stats
           (roll_no, attendance_percentage, attendance_updated_at, year_sem)
         VALUES ('BBB00011', 70.0, datetime('now'), '11')`,
        `INSERT INTO student_stats
           (roll_no, attendance_percentage, attendance_updated_at, year_sem)
         VALUES ('BBB00012', 71.0, datetime('now'), '12')`,
      ],
      "write",
    );

    try {
      const { rows, total } = await getLeaderboard("attendance", 10, 0, {
        year: "1",
      });
      expect(total).toBe(2);
      expect(rows.map((row) => row.roll_no).sort()).toEqual([
        "BBB00011",
        "BBB00012",
      ]);

      const facets = await getLeaderboardFacets({ year: "1" });
      expect(facets).toContain("A");
    } finally {
      await turso.execute(
        "DELETE FROM student_stats WHERE roll_no LIKE 'BBB%'",
      );
      await turso.execute("DELETE FROM studentsnew WHERE roll_no LIKE 'BBB%'");
    }
  });

  it("does not rank a 12 semester row for a 11 student", async () => {
    await turso.batch(
      [
        `INSERT INTO studentsnew VALUES ('CCC00001', 'Stale Sem', 'A', '5', '11')`,
        // the stat still carries the other semester's key
        `INSERT INTO student_stats
           (roll_no, attendance_percentage, attendance_updated_at, year_sem)
         VALUES ('CCC00001', 99.0, datetime('now'), '12')`,
      ],
      "write",
    );

    try {
      const { rows } = await getLeaderboard("attendance", 10, 0, {
        year: "1",
      });
      expect(rows.map((row) => row.roll_no)).not.toContain("CCC00001");

      // and it is not ranked globally either
      const rank = await getStudentRank("CCC00001", "attendance");
      expect(rank).toBeNull();
    } finally {
      await turso.execute(
        "DELETE FROM student_stats WHERE roll_no = 'CCC00001'",
      );
      await turso.execute("DELETE FROM studentsnew WHERE roll_no = 'CCC00001'");
    }
  });
});

describe("getLeaderboardCoverage", () => {
  it("counts the directory for the same filters as the ranked view", async () => {
    expect(await getLeaderboardCoverage({})).toBe(3);
    expect(await getLeaderboardCoverage({ section: "A" })).toBe(2);
    expect(await getLeaderboardCoverage({ year: "3" })).toBe(3);
    expect(
      await getLeaderboardCoverage({ year: "3", branch: "5", section: "B" }),
    ).toBe(1);
  });

  it("returns 0 for a filter with no known students", async () => {
    expect(await getLeaderboardCoverage({ year: "4" })).toBe(0);
  });

  it("matches both semester codes for a year digit", async () => {
    await turso.batch(
      [
        `INSERT INTO studentsnew VALUES ('DDD00011', 'Y1S1', 'A', '5', '11')`,
        `INSERT INTO studentsnew VALUES ('DDD00012', 'Y1S2', 'A', '5', '12')`,
      ],
      "write",
    );

    try {
      expect(await getLeaderboardCoverage({ year: "1" })).toBe(2);
    } finally {
      await turso.execute("DELETE FROM studentsnew WHERE roll_no LIKE 'DDD%'");
    }
  });
});

describe("getLastSyncAt", () => {
  it("reports a separate range per metric", async () => {
    const attendance = await getLastSyncAt("attendance");
    const midmarks = await getLastSyncAt("midmarks");

    expect(attendance.newest).not.toBeNull();
    expect(attendance.oldest).not.toBeNull();
    expect(midmarks.newest).not.toBeNull();
    expect(midmarks.oldest).not.toBeNull();

    // mid-marks were refreshed days ago; attendance within hours
    expect(String(attendance.newest) > String(midmarks.newest)).toBe(true);
    expect(String(midmarks.oldest) < String(attendance.oldest)).toBe(true);
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
