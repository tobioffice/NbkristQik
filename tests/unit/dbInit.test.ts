import { describe, it, expect, beforeAll } from "vitest";
import { turso } from "../../src/db/db.js";
import { initDatabase, SCHEMA_VERSION } from "../../src/db/init.js";

const pragmaNumber = async (sql: string): Promise<number> => {
  const result = await turso.execute(sql);
  return Number(result.rows[0] ? Object.values(result.rows[0])[0] : 0);
};

const columnNames = async (table: string): Promise<string[]> => {
  const result = await turso.execute(`PRAGMA table_info(${table})`);
  return result.rows.map((row) => String(row.name));
};

// A database from before the registration guard: two users already hold the
// same roll and PRAGMA user_version was never stamped.
beforeAll(async () => {
  await turso.execute(`
    CREATE TABLE registrations (
        userId TEXT PRIMARY KEY,
        roll_no TEXT NOT NULL,
        display_name TEXT,
        registered_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await turso.batch(
    [
      `INSERT INTO registrations (userId, roll_no, display_name, registered_at, updated_at)
       VALUES ('u-old', '26KB1A0501', 'old row', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`,
      `INSERT INTO registrations (userId, roll_no, display_name, registered_at, updated_at)
       VALUES ('u-new', '26KB1A0501', 'newer row', '2026-02-01 00:00:00', '2026-02-01 00:00:00')`,
      `INSERT INTO registrations (userId, roll_no, display_name, registered_at, updated_at)
       VALUES ('u-other', '26KB1A0502', 'other roll', '2026-01-15 00:00:00', '2026-01-15 00:00:00')`,
    ],
    "write",
  );

  // A v1 database with real stat rows: the v2 migration must add the columns
  // and backfill the per-metric timestamps and the semester key.
  await turso.batch(
    [
      `CREATE TABLE studentsnew (
        roll_no TEXT PRIMARY KEY,
        name TEXT,
        section TEXT,
        branch TEXT,
        year TEXT
      )`,
      `INSERT INTO studentsnew VALUES ('26KB1A0501', 'Test Student', 'A', '5', '31')`,
      `CREATE TABLE student_stats (
        roll_no TEXT PRIMARY KEY,
        attendance_percentage REAL,
        mid_marks_avg REAL,
        last_updated TEXT
      )`,
      `INSERT INTO student_stats VALUES
        ('26KB1A0501', 82.5, 21.0, '2026-02-01 10:00:00')`,
    ],
    "write",
  );
  await turso.execute("PRAGMA user_version = 1");

  await initDatabase();
});

describe("initDatabase", () => {
  it("deduplicates registrations before enforcing one row per roll", async () => {
    const rows = await turso.execute(
      "SELECT userId, roll_no FROM registrations ORDER BY userId",
    );
    expect(
      rows.rows.map((row) => [String(row.userId), String(row.roll_no)]),
    ).toEqual([
      ["u-new", "26KB1A0501"],
      ["u-other", "26KB1A0502"],
    ]);

    const index = await turso.execute(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_registrations_roll'`,
    );
    expect(index.rows).toHaveLength(1);
  });

  it("rejects a second registration for an already-taken roll", async () => {
    await expect(
      turso.execute(
        `INSERT INTO registrations (userId, roll_no) VALUES ('u-third', '26KB1A0501')`,
      ),
    ).rejects.toThrow(/UNIQUE|constraint/i);
  });

  it("stamps user_version on a previously unversioned database", async () => {
    expect(await pragmaNumber("PRAGMA user_version")).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(2);

    // a second boot is idempotent and does not move the stamp
    await initDatabase();
    expect(await pragmaNumber("PRAGMA user_version")).toBe(SCHEMA_VERSION);
    expect(
      Number(
        (await turso.execute("SELECT COUNT(*) AS n FROM registrations")).rows[0]
          .n,
      ),
    ).toBe(2);
  });

  it("migrates v1 student_stats to per-metric timestamps and a semester key", async () => {
    expect(await columnNames("student_stats")).toEqual(
      expect.arrayContaining([
        "attendance_updated_at",
        "midmarks_updated_at",
        "year_sem",
      ]),
    );
    expect(await columnNames("fallbackResponses")).toContain("updated_at");

    const row = (
      await turso.execute(
        `SELECT attendance_updated_at, midmarks_updated_at, year_sem
         FROM student_stats WHERE roll_no = '26KB1A0501'`,
      )
    ).rows[0];

    expect(String(row.attendance_updated_at)).toBe("2026-02-01 10:00:00");
    expect(String(row.midmarks_updated_at)).toBe("2026-02-01 10:00:00");
    expect(String(row.year_sem)).toBe("31");
  });

  it("is idempotent when the v2 migration runs again on an already-v2 database", async () => {
    // Simulate a crash after ALTER but before the version stamp.
    await turso.execute("PRAGMA user_version = 1");
    try {
      await initDatabase();
      expect(await pragmaNumber("PRAGMA user_version")).toBe(SCHEMA_VERSION);

      const row = (
        await turso.execute(
          `SELECT attendance_updated_at, midmarks_updated_at, year_sem
           FROM student_stats WHERE roll_no = '26KB1A0501'`,
        )
      ).rows[0];
      // backfill is guarded by IS NULL: an existing value is never rewritten
      expect(String(row.attendance_updated_at)).toBe("2026-02-01 10:00:00");
      expect(String(row.year_sem)).toBe("31");
    } finally {
      await turso.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
  });

  it("refuses to boot against a newer schema", async () => {
    await turso.execute(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    try {
      await expect(initDatabase()).rejects.toThrow(/newer than this build/);
    } finally {
      await turso.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
  });
});
