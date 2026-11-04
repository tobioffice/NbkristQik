import { describe, it, expect, beforeAll } from "vitest";
import { turso } from "../../src/db/db.js";
import { initDatabase, SCHEMA_VERSION } from "../../src/db/init.js";

const pragmaNumber = async (sql: string): Promise<number> => {
  const result = await turso.execute(sql);
  return Number(result.rows[0] ? Object.values(result.rows[0])[0] : 0);
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

  it("refuses to boot against a newer schema", async () => {
    await turso.execute(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    try {
      await expect(initDatabase()).rejects.toThrow(/newer than this build/);
    } finally {
      await turso.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
  });
});
