import { describe, it, expect, beforeAll } from "vitest";
import { turso } from "../../src/db/db.js";
import { prune } from "../../src/services/maintenance.js";

const countWhere = async (table: string, column: string, value: string) =>
  Number(
    (
      await turso.execute({
        sql: `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`,
        args: [value],
      })
    ).rows[0].n,
  );

beforeAll(async () => {
  await turso.batch(
    [
      `CREATE TABLE IF NOT EXISTS uptime_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        component TEXT NOT NULL,
        status TEXT NOT NULL,
        latency_ms INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        chat_type TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS admin_sessions (
        token_hash TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS library_reads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        doc_id TEXT NOT NULL,
        page INTEGER NOT NULL,
        token TEXT,
        at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ],
    "write",
  );

  await turso.batch(
    [
      `INSERT INTO uptime_log (component, status, created_at) VALUES ('old-component', 'up', datetime('now', '-100 days'))`,
      `INSERT INTO uptime_log (component, status, created_at) VALUES ('fresh-component', 'up', datetime('now'))`,
      `INSERT INTO activity_log (user_id, chat_type, action, created_at) VALUES (1, 'private', 'old-action', datetime('now', '-100 days'))`,
      `INSERT INTO activity_log (user_id, chat_type, action, created_at) VALUES (1, 'private', 'fresh-action', datetime('now'))`,
      `INSERT INTO admin_sessions (token_hash, expires_at) VALUES ('old-session', datetime('now', '-1 day'))`,
      `INSERT INTO admin_sessions (token_hash, expires_at) VALUES ('live-session', datetime('now', '+1 day'))`,
      `INSERT INTO library_reads (user_id, doc_id, page, at) VALUES ('u1', 'old-doc', 1, datetime('now', '-400 days'))`,
      `INSERT INTO library_reads (user_id, doc_id, page, at) VALUES ('u1', 'fresh-doc', 2, datetime('now'))`,
    ],
    "write",
  );

  await prune();
});

describe("prune", () => {
  it("drops history older than the retention window", async () => {
    expect(await countWhere("uptime_log", "component", "old-component")).toBe(
      0,
    );
    expect(await countWhere("activity_log", "action", "old-action")).toBe(0);
    expect(await countWhere("library_reads", "doc_id", "old-doc")).toBe(0);
  });

  it("keeps recent history and live sessions", async () => {
    expect(await countWhere("uptime_log", "component", "fresh-component")).toBe(
      1,
    );
    expect(await countWhere("activity_log", "action", "fresh-action")).toBe(1);
    expect(await countWhere("library_reads", "doc_id", "fresh-doc")).toBe(1);
    expect(
      await countWhere("admin_sessions", "token_hash", "live-session"),
    ).toBe(1);
  });

  it("removes expired admin sessions", async () => {
    expect(
      await countWhere("admin_sessions", "token_hash", "old-session"),
    ).toBe(0);
  });

  it("is safe to run again", async () => {
    await expect(prune()).resolves.toBeUndefined();
  });
});
