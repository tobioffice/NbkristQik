import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";

// A private in-memory DB for this file. db.js is mocked so the model reads
// from here instead of touching Turso.
const client = createClient({ url: "file::memory:" });
vi.mock("../../src/db/db.js", () => ({ turso: client }));

const { getLeaderboard } = await import("../../src/db/student_stats.model.js");

beforeAll(async () => {
  await client.batch(
    [
      `CREATE TABLE studentsnew (
        roll_no TEXT PRIMARY KEY,
        name TEXT,
        section TEXT,
        branch TEXT,
        year TEXT
      )`,
      `CREATE TABLE student_stats (
        roll_no TEXT PRIMARY KEY,
        attendance_percentage REAL,
        mid_marks_avg REAL,
        last_updated TEXT,
        attendance_updated_at TEXT,
        midmarks_updated_at TEXT,
        year_sem TEXT
      )`,
      // Deliberately no unique index on roll_no and two rows for the same
      // roll: the query must still return one leaderboard row per student.
      `CREATE TABLE registrations (
        userId TEXT PRIMARY KEY,
        roll_no TEXT NOT NULL,
        display_name TEXT,
        registered_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `INSERT INTO studentsnew VALUES
        ('AAA00001', 'ALICE MASTER', 'A', '5', '31'),
        ('AAA00002', 'BOB MASTER', 'A', '5', '31')`,
      `INSERT INTO student_stats VALUES
        ('AAA00001', 90.0, 28.0, datetime('now'), datetime('now'), datetime('now'), '31'),
        ('AAA00002', 90.0, 27.0, datetime('now'), datetime('now'), datetime('now'), '31')`,
      `INSERT INTO registrations VALUES
        ('u1', 'AAA00001', 'ALICE REGISTERED', datetime('now'), '2026-01-01 00:00:00'),
        ('u2', 'AAA00001', 'ALICE NEWER', datetime('now'), '2026-02-01 00:00:00')`,
    ],
    "write",
  );
});

describe("getLeaderboard names", () => {
  it("uses the newest explicit registration name over the master name", async () => {
    const { rows, total } = await getLeaderboard("attendance", 10, 0, {});

    expect(total).toBe(2);
    // one row per student, even though registrations has two claims for S1
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name)).toEqual(["ALICE NEWER", "BOB MASTER"]);
  });

  it("falls back to the master name when the registration has no display name", async () => {
    await client.execute(
      `UPDATE registrations SET display_name = NULL WHERE userId = 'u2'`,
    );
    try {
      const { rows } = await getLeaderboard("attendance", 10, 0, {});
      expect(rows[0].name).toBe("ALICE REGISTERED");
    } finally {
      await client.execute(
        `UPDATE registrations SET display_name = 'ALICE NEWER' WHERE userId = 'u2'`,
      );
    }
  });

  it("returns NULL names for anonymous callers", async () => {
    const { rows, total } = await getLeaderboard(
      "attendance",
      10,
      0,
      {},
      { includeNames: false },
    );

    expect(total).toBe(2);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.name === null)).toBe(true);
  });
});

describe("getLeaderboard search privacy", () => {
  it("matches names for identified callers", async () => {
    const { rows, total } = await getLeaderboard("attendance", 10, 0, {
      search: "alice",
    });

    expect(total).toBe(1);
    expect(rows[0].name).toBe("ALICE NEWER");
  });

  it("searches the displayed pseudonym, not the hidden master name", async () => {
    const pseudonym = await getLeaderboard("attendance", 10, 0, {
      search: "ALICE NEWER",
    });
    expect(pseudonym.total).toBe(1);

    const hiddenMasterName = await getLeaderboard("attendance", 10, 0, {
      search: "ALICE MASTER",
    });
    expect(hiddenMasterName.total).toBe(0);
  });

  it("matches rolls only for anonymous callers", async () => {
    const byName = await getLeaderboard(
      "attendance",
      10,
      0,
      { search: "alice" },
      { includeNames: false },
    );
    expect(byName.total).toBe(0);

    const byRoll = await getLeaderboard(
      "attendance",
      10,
      0,
      { search: "aaa00001" },
      { includeNames: false },
    );
    expect(byRoll.total).toBe(1);
    expect(byRoll.rows[0].roll_no).toBe("AAA00001");
  });

  it("keeps rank ties and totals unchanged with names off", async () => {
    const { rows, total } = await getLeaderboard(
      "attendance",
      10,
      0,
      {},
      { includeNames: false },
    );

    expect(total).toBe(2);
    expect(rows.map((r) => r.rank)).toEqual([1, 1]);
  });
});
