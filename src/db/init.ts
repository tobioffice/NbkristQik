import { turso } from "./db.js";
import {
  initStatsTable,
  initUptimeTable,
  initLeaderboardIndexes,
} from "./student_stats.model.js";

/**
 * Single schema entry point — creates every table/index the app assumes.
 * Called once from bot/index.ts before any handlers or the API start.
 */
export const initDatabase = async () => {
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS fallbackResponses (
        id TEXT PRIMARY KEY CHECK(LENGTH(id) <= 50),
        content TEXT
    );
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS tgusers (
        userId TEXT PRIMARY KEY,
        rollNo TEXT,
        semester TEXT,
        department TEXT,
        section TEXT
    );
  `);
  // populated by /syncdb; created here so a fresh DB boots and the
  // studentsnew indexes below don't fail
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS studentsnew (
        roll_no TEXT PRIMARY KEY,
        name TEXT,
        section TEXT,
        branch TEXT,
        year TEXT
    );
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS botusers (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        first_seen TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen TEXT NOT NULL DEFAULT (datetime('now')),
        private_actions INTEGER NOT NULL DEFAULT 0,
        channel_actions INTEGER NOT NULL DEFAULT 0,
        group_actions INTEGER NOT NULL DEFAULT 0,
        total_actions INTEGER NOT NULL DEFAULT 0
    );
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        chat_type TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
        token_hash TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL
    );
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS registrations (
        userId TEXT PRIMARY KEY,
        roll_no TEXT NOT NULL,
        display_name TEXT,
        registered_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        admin_reply TEXT,
        replied_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log (created_at);`,
  );
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log (user_id, created_at);`,
  );
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_reports_created ON reports (created_at);`,
  );
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_reports_user ON reports (user_id, created_at);`,
  );
  await initStatsTable();
  await initUptimeTable();
  await initLeaderboardIndexes();
};
