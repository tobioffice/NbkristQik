import { createClient } from "@libsql/client";
import { config } from "dotenv";
import { logger } from "../config/logger.js";
config();

/**
 * Database connection.
 *
 * Set LOCAL_DB_URL (e.g. "file:/home/ubuntu/nbkristqik/data/qik.db") to run
 * the database as an embedded libSQL/SQLite file on the same box as the bot:
 * no network hop, no read quota, microsecond queries. Leave it unset to use
 * Turso Cloud as before.
 */
const localUrl = process.env.LOCAL_DB_URL?.trim();
const remoteUrl = process.env.TURSO_DATABASE_URL || "";

/** The URL this process is actually talking to (LOCAL_DB_URL wins). */
export const databaseUrl = localUrl || remoteUrl;

/**
 * True for the embedded database — a local file, or the `file::memory:` URL
 * the tests use. A networked Turso URL is false: connection pragmas are a
 * local-engine concern and the server manages its own.
 */
export const isEmbeddedDatabase = databaseUrl.startsWith("file:");

export const turso = localUrl
  ? createClient({ url: localUrl })
  : createClient({
      url: remoteUrl,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

/**
 * Apply the durability/concurrency settings the embedded database needs.
 *
 *  - journal_mode=WAL: readers never block the writer, and a crash leaves a
 *    recoverable WAL instead of a half-written rollback journal.
 *  - busy_timeout=5000: a concurrent writer waits up to 5s instead of failing
 *    the statement with SQLITE_BUSY immediately (prune, /syncdb and the API
 *    can overlap).
 *  - synchronous=NORMAL: with WAL this is durable across app crashes; only an
 *    OS/power loss can lose the last transaction (acceptable for this data).
 *  - foreign_keys=ON: enforce declared relations instead of SQLite's off
 *    default.
 *
 * `file::memory:` returns journal_mode "memory" instead of "wal" — that is
 * expected in tests and ignored. Every pragma is best-effort: a failure is
 * logged so boot still succeeds against a read-only or exotic database.
 *
 * Called once at the start of initDatabase(), so every entry point inherits
 * it before touching a table.
 */
export const configureDatabase = async (): Promise<void> => {
  if (!isEmbeddedDatabase) return;

  try {
    const result = await turso.execute("PRAGMA journal_mode = WAL");
    const mode = String(result.rows[0]?.journal_mode ?? "").toLowerCase();
    if (mode === "memory") {
      // file::memory: databases cannot journal to disk — expected, not an error
      logger.debug("[db] in-memory database: journal_mode stays memory");
    } else if (mode !== "wal") {
      logger.warn(
        `[db] journal_mode is "${mode || "unknown"}" (expected "wal") — continuing`,
      );
    }
  } catch (e) {
    logger.warn("[db] could not enable WAL — continuing:", e);
  }

  for (const pragma of [
    "PRAGMA busy_timeout = 5000",
    "PRAGMA synchronous = NORMAL",
    "PRAGMA foreign_keys = ON",
  ]) {
    try {
      await turso.execute(pragma);
    } catch (e) {
      logger.warn(`[db] ${pragma} failed — continuing:`, e);
    }
  }
};
