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
 *
 * Version 2 adds per-metric timestamps and a semester key to student_stats,
 * and updated_at to fallbackResponses. See migrateToV2().
 *
 * Version 4 drops the unique roll index. One roll may be saved by more than
 * one account until a college-email OTP proves who the student is; see
 * docs/ROADMAP.md. See migrateToV4().
 */
export const SCHEMA_VERSION = 4;

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
        content TEXT,
        updated_at TEXT
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
  // Not unique on purpose: several accounts may save the same roll until
  // ownership is proven (see docs/ROADMAP.md). The index only speeds up the
  // "who holds this roll" lookups.
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_registrations_roll ON registrations (roll_no);`,
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

  // Additive v2 columns. Guarded by the version and by PRAGMA table_info, so
  // a database that already has a column (or a crashed half-migration) is
  // safe to run through again.
  if (schemaVersion < 2) {
    await migrateToV2();
  }
  if (schemaVersion < 3) {
    await migrateToV3();
  }
  if (schemaVersion < 4) {
    await migrateToV4();
  }

  // Stamp after every table exists, so a crash mid-init leaves the old version
  // and the next boot retries the whole (idempotent) schema instead of
  // claiming a version it never finished.
  if (schemaVersion < SCHEMA_VERSION) {
    try {
      await turso.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      logger.debug(`[db] schema version stamped at ${SCHEMA_VERSION}`);
    } catch (e) {
      logger.warn("[db] could not stamp PRAGMA user_version:", e);
    }
  }
};

/** Column names currently on a table (empty for a missing table). */
const tableColumns = async (table: string): Promise<Set<string>> => {
  const result = await turso.execute(`PRAGMA table_info(${table})`);
  return new Set(result.rows.map((row) => String(row.name)));
};

/** `ALTER TABLE ... ADD COLUMN` only when the column is actually missing. */
const ensureColumn = async (
  table: string,
  column: string,
  definition: string,
): Promise<void> => {
  const columns = await tableColumns(table);
  if (columns.has(column)) return;

  await turso.execute(
    `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
  );
  logger.info(`[db] added ${table}.${column}`);
};

/**
 * Schema v2: per-metric timestamps and the semester key.
 *
 * Backfill is deliberately conservative and idempotent (only null columns):
 *  - attendance_updated_at <- last_updated where an attendance value exists
 *  - midmarks_updated_at   <- last_updated where a mid-mark value exists
 *  - year_sem              <- studentsnew.year for the roll
 *
 * A row whose roll is not in studentsnew keeps a null year_sem and is
 * excluded from the leaderboard until a lookup refreshes it. Count is logged
 * once per boot so the state is visible.
 */
const migrateToV2 = async (): Promise<void> => {
  await ensureColumn("student_stats", "attendance_updated_at", "TEXT");
  await ensureColumn("student_stats", "midmarks_updated_at", "TEXT");
  await ensureColumn("student_stats", "year_sem", "TEXT");
  await ensureColumn("fallbackResponses", "updated_at", "TEXT");

  await turso.execute(`
    UPDATE student_stats
    SET attendance_updated_at = last_updated
    WHERE attendance_updated_at IS NULL
      AND attendance_percentage IS NOT NULL
      AND last_updated IS NOT NULL
  `);
  await turso.execute(`
    UPDATE student_stats
    SET midmarks_updated_at = last_updated
    WHERE midmarks_updated_at IS NULL
      AND mid_marks_avg IS NOT NULL
      AND last_updated IS NOT NULL
  `);
  await turso.execute(`
    UPDATE student_stats
    SET year_sem = (
      SELECT s.year FROM studentsnew s WHERE s.roll_no = student_stats.roll_no
    )
    WHERE year_sem IS NULL
  `);

  const missing = await turso.execute(
    `SELECT COUNT(*) AS n FROM student_stats WHERE year_sem IS NULL`,
  );
  const missingCount = Number(missing.rows[0]?.n ?? 0);
  if (missingCount > 0) {
    logger.warn(
      `[db] ${missingCount} student_stats row(s) have no year_sem (roll not in studentsnew) — excluded from the leaderboard until refreshed`,
    );
  }

  logger.info("[db] schema v2 migration complete");
};

/**
 * Schema v3: reading surface on the library audit trail.
 *
 * `library_reads.surface` records where the page was served from
 * ('telegram' inside the app, 'pc' from a computer link). It powers the
 * admin Library view's split, and older rows carry NULL, read as 'telegram'
 * by the queries that need it.
 */
const migrateToV3 = async (): Promise<void> => {
  await ensureColumn("library_reads", "surface", "TEXT");
  logger.info("[db] schema v3 migration complete");
};

/**
 * v4: the unique roll index goes away.
 *
 * It was added to keep one roll to one account, which blocked honest people
 * who share a roll and could not be told apart from squatters anyway. Drop it
 * and leave a plain index for lookups. The ownership check returns only when
 * it can prove something (college email OTP, docs/ROADMAP.md).
 */
const migrateToV4 = async (): Promise<void> => {
  await turso.execute("DROP INDEX IF EXISTS idx_registrations_roll");
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_registrations_roll ON registrations (roll_no);`,
  );
  logger.info(
    "[db] schema v4 migration complete: roll index is no longer unique",
  );
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
