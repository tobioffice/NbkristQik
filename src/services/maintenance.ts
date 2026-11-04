import { turso } from "../db/db.js";
import { logger } from "../config/logger.js";

/**
 * Daily housekeeping for the local database. The probes themselves now run
 * on oracle2, but the data still belongs to this process: it keeps the
 * uptime history, the activity log, expired admin sessions and the library
 * read trail bounded.
 */
const RETENTION_DAYS = 95;
const DAY_MS = 24 * 60 * 60 * 1000;

let started = false;

/**
 * Best-effort retention. Each table is pruned independently: a missing or
 * locked table must not skip the others, and a prune failure must never
 * break boot or the caller.
 */
const pruneTable = async (table: string, sql: string): Promise<void> => {
  try {
    await turso.execute(sql);
  } catch (e) {
    logger.warn(`[maintenance] prune ${table} failed:`, e);
  }
};

export const prune = async (): Promise<void> => {
  // RETENTION_DAYS is a module constant (not user input), so interpolating
  // the integer into a datetime() modifier is safe
  await pruneTable(
    "uptime_log",
    `DELETE FROM uptime_log WHERE created_at < datetime('now', '-${RETENTION_DAYS} days')`,
  );
  await pruneTable(
    "activity_log",
    `DELETE FROM activity_log WHERE created_at < datetime('now', '-${RETENTION_DAYS} days')`,
  );
  await pruneTable(
    "admin_sessions",
    `DELETE FROM admin_sessions WHERE expires_at < datetime('now')`,
  );
  // The page-read audit trail is what a takedown is argued from, so it gets
  // the same 95-day window as the other history tables instead of growing
  // forever (one row per served page).
  await pruneTable(
    "library_reads",
    `DELETE FROM library_reads WHERE at < datetime('now', '-${RETENTION_DAYS} days')`,
  );
};

export const startMaintenance = (): void => {
  if (started) return;
  started = true;

  // Prune once at boot, before the interval is scheduled. Otherwise a deploy
  // cadence shorter than 24h (the normal case) restarts the timer every time
  // and retention would never run at all.
  void prune();

  const timer = setInterval(() => void prune(), DAY_MS);
  timer.unref();
  logger.info(
    "[maintenance] startup prune done, daily prune scheduled (95-day retention)",
  );
};
