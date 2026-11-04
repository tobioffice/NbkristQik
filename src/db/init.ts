import { configureDatabase, turso } from "./db.js";
import {
  initStatsTable,
  initUptimeTable,
  initLeaderboardIndexes,
} from "./student_stats.model.js";
import { initLibraryTables } from "./library.model.js";
import { logger } from "../config/logger.js";

/**
 * Current schema version stored in `PRAGMA user_version`.
 *
 * Bump this whenever a change adds a column, table or index that an existing
 * database must also get. There is no migration framework: the bump is the
 * signal, and the migration itself lives in initDatabase() next to the
 * idempotent CREATE/ALTER it needs. The guard below stops an older build from
 * booting against a database a newer build already wrote:
 *
 *   - version 0  -> fresh (or pre-versioning) database; stamp current
 *   - version  > current -> refuse to start with a clear error
 *
 * Existing tables stay compatible because every schema statement here is
 * IF NOT EXISTS; only genuinely new columns need an ALTER guarded by a
 * version check.
 *
 * The embedded database always supports PRAGMA user_version. A legacy remote
 * Turso endpoint may not: reading there is logged and skipped rather than
 * turned into a boot failure, since the guard is a safety net, not a
 * connection requirement.
 */
export const SCHEMA_VERSION = 1;

/** Reads the database's user_version, treating a missing row as 0. */
const readSchemaVersion = async (): Promise<number> => {
  try {
    const result = await turso.execute("PRAGMA user_version");
    return Number(result.rows[0]?.user_version ?? 0);
  } catch (e) {
    // e.g. a legacy remote Turso endpoint that does not expose the pragma —
    // the guard is a safety net, not a connection requirement.
    logger.warn(
      "[db] could not read PRAGMA user_version — skipping the schema-version check:",
      e,
    );
    return 0;
  }
};

/**
 * Single schema entry point — creates every table/index the app assumes.
 * Called once from bot/index.ts before any handlers or the API start.
 */
export const initDatabase = async () => {
  // connection-level settings first: WAL must be on before the schema is
  // written (journal_mode is persisted in the file header)
  await configureDatabase();

  const schemaVersion = await readSchemaVersion();
  if (schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${schemaVersion} is newer than this build ` +
        `(schema version ${SCHEMA_VERSION}). Refusing to start: deploy the ` +
        `matching newer build or restore a compatible backup.`,
    );
  }

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
  await dedupeRegistrations();
  // One roll number maps to one registration. The API also rejects a second
  // user registering a taken roll; this index is the database-level backstop
  // for racing requests and pre-guard data.
  await turso.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_roll ON registrations (roll_no);`,
  );
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
  // One row per message in a report's conversation. The reports row keeps the
  // opening message and the latest admin reply so older clients and the
  // Telegram notices keep working; the thread is the source of truth.
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS report_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_id INTEGER NOT NULL,
        author TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // How far each side has read a thread (drives the "new" stamps).
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS report_reads (
        report_id INTEGER NOT NULL,
        reader TEXT NOT NULL,
        last_seen_id INTEGER NOT NULL DEFAULT 0,
        seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (report_id, reader)
    );
  `);
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_report_messages ON report_messages (report_id, id);`,
  );
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
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, id);`,
  );
  await initStatsTable();
  await initUptimeTable();
  await initLeaderboardIndexes();
  await initLibraryTables();
  await backfillReportThreads();

  // Stamp a fresh/pre-versioning database only after every table exists, so a
  // crash mid-init leaves version 0 and the next boot retries the whole
  // (idempotent) schema instead of claiming a version it never finished.
  if (schemaVersion === 0) {
    try {
      await turso.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      logger.debug(`[db] schema version stamped at ${SCHEMA_VERSION}`);
    } catch (e) {
      logger.warn("[db] could not stamp PRAGMA user_version:", e);
    }
  }
};

/**
 * The unique roll index can only be created over clean data. Older databases
 * may hold several users on one roll; keep the newest registration per roll
 * (latest updated_at, then highest rowid) and log how many went.
 */
const dedupeRegistrations = async (): Promise<void> => {
  const result = await turso.execute(`
    DELETE FROM registrations
    WHERE rowid NOT IN (
      SELECT candidate.rowid
      FROM registrations candidate
      WHERE NOT EXISTS (
        SELECT 1
        FROM registrations newer
        WHERE newer.roll_no = candidate.roll_no
          AND (
            COALESCE(newer.updated_at, '') > COALESCE(candidate.updated_at, '')
            OR (
              COALESCE(newer.updated_at, '') = COALESCE(candidate.updated_at, '')
              AND newer.rowid > candidate.rowid
            )
          )
      )
    );
  `);
  const removed = Number(result.rowsAffected ?? 0);
  if (removed > 0) {
    logger.warn(
      `[db] removed ${removed} duplicate registration row(s) for the unique roll index`,
    );
  }
};

/**
 * Idempotent one-time backfill: reports filed before threads existed get
 * their opening message and their single admin reply replayed as the first
 * two entries of the conversation. The NOT EXISTS guards make this a no-op
 * once a report has a thread, so it is safe on every boot.
 */
const backfillReportThreads = async () => {
  await turso.execute(`
    INSERT INTO report_messages (report_id, author, body, created_at)
    SELECT r.id, 'user', r.message, r.created_at
    FROM reports r
    WHERE NOT EXISTS (
      SELECT 1 FROM report_messages m WHERE m.report_id = r.id
    );
  `);
  await turso.execute(`
    INSERT INTO report_messages (report_id, author, body, created_at)
    SELECT r.id, 'admin', r.admin_reply, COALESCE(r.replied_at, r.created_at)
    FROM reports r
    WHERE r.admin_reply IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM report_messages m
        WHERE m.report_id = r.id AND m.author = 'admin'
      );
  `);
  // a replayed report must not look "unread" to the student who wrote it:
  // seed their marker at their own last message, the same way createReport does
  await turso.execute(`
    INSERT INTO report_reads (report_id, reader, last_seen_id, seen_at)
    SELECT r.id, 'user', MAX(m.id), datetime('now')
    FROM reports r
    JOIN report_messages m ON m.report_id = r.id AND m.author = 'user'
    WHERE NOT EXISTS (
      SELECT 1 FROM report_reads rd
      WHERE rd.report_id = r.id AND rd.reader = 'user'
    )
    GROUP BY r.id;
  `);
};
