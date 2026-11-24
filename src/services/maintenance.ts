import { turso } from "../db/db.js";
import { logger } from "../config/logger.js";
import { pruneDownloadCache } from "./library/pdf.js";
import {
  pruneChatMessages,
  pruneExpiredModeratedUsers,
} from "../db/chatModeration.model.js";

/**
 * Daily housekeeping for the local database. The probes themselves now run
 * on monitor-host, but the data still belongs to this process: it keeps the
 * uptime history, the activity log, expired admin sessions and the library
 * read trail bounded.
 */
const RETENTION_DAYS = 95;
const LIBRARY_RETENTION_DAYS = 365;
const GAME_RETENTION_DAYS = 180;
const DUEL_RETENTION_DAYS = 90;
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
  // The page-read audit trail is what a takedown is argued from, and what
  // the product is improved from, so it gets a longer 365-day window than
  // the other history tables instead of growing forever (one row per served
  // page).
  await pruneTable(
    "library_reads",
    `DELETE FROM library_reads WHERE at < datetime('now', '-${LIBRARY_RETENTION_DAYS} days')`,
  );

  // Chat regulation keeps two clocks: the message-id trail only matters while
  // Telegram will still delete the message (48 hours), while the action log is
  // audit history and follows the standard 95 days. A mute whose clock ran out
  // is already lifted on Telegram's side, so its row is just noise. The two
  // model helpers own those rules; this job only schedules them.
  try {
    await pruneChatMessages(48);
  } catch (e) {
    logger.warn("[maintenance] prune chat_messages failed:", e);
  }
  try {
    await pruneExpiredModeratedUsers();
  } catch (e) {
    logger.warn("[maintenance] prune chat_moderation_users failed:", e);
  }
  await pruneTable(
    "chat_moderation_log",
    `DELETE FROM chat_moderation_log WHERE created_at < datetime('now', '-${RETENTION_DAYS} days')`,
  );

  // League history is useful for a full season and the weekly boards, not
  // forever. Attempts and score rows are the bulky ones (one JSON answer set
  // per run); a day key is a plain YYYY-MM-DD string, so a date compare is
  // enough. Duels and round rows are smaller but still bounded.
  await pruneTable(
    "game_attempts",
    `DELETE FROM game_attempts WHERE day_key < date('now', '-${GAME_RETENTION_DAYS} days')`,
  );
  await pruneTable(
    "game_scores",
    `DELETE FROM game_scores WHERE day_key < date('now', '-${GAME_RETENTION_DAYS} days')`,
  );
  await pruneTable(
    "game_duels",
    `DELETE FROM game_duels WHERE day_key < date('now', '-${DUEL_RETENTION_DAYS} days')`,
  );
  await pruneTable(
    "game_rounds",
    `DELETE FROM game_rounds WHERE day_key < date('now', '-${GAME_RETENTION_DAYS} days')`,
  );

  // Stamped PDFs expire on their own seven-day clock and a disk budget; this
  // is housekeeping, not retention evidence, so a failure stays a warning.
  try {
    await pruneDownloadCache();
  } catch (e) {
    logger.warn("[maintenance] prune download cache failed:", e);
  }
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
    "[maintenance] startup prune done, daily prune scheduled (95-day retention, 365-day library, 180-day league)",
  );
};
