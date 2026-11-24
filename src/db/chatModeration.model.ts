import { turso } from "./db.js";
import { DEFAULT_BLOCKED_KEYWORDS } from "../constants/chatModeration.js";

/**
 * Chat regulation: the words the group may not carry, the people currently
 * muted or banned, the messages the bot has seen (so it can clear a user's
 * history when asked) and an audit trail of every action.
 *
 * The layer is one group per deployment by default (see
 * `MODERATION_CHAT_IDS`), but every row carries its chat id so a second group
 * is a config change, not a migration. The state here is the admin panel's
 * source of truth; Telegram is the source of the actual restriction, and the
 * two are reconciled by the next action.
 */

export type ModerationUserState = "muted" | "banned";

/** One person the bot has muted or banned in a chat. */
export interface ModerationUserRow {
  chatId: number;
  userId: number;
  state: ModerationUserState;
  /** UTC `YYYY-MM-DD HH:MM:SS` when the mute lifts; null for permanent/ban. */
  untilDate: string | null;
  reason: string | null;
  actor: string;
  username: string | null;
  firstName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One moderation action, for the panel's recent-actions feed. */
export interface ModerationActionRow {
  id: number;
  chatId: number;
  userId: number;
  username: string | null;
  firstName: string | null;
  action: string;
  reason: string | null;
  actor: string;
  deletedCount: number;
  createdAt: string;
}

export interface BlockedKeywordRow {
  id: number;
  phrase: string;
  createdAt: string;
}

export interface ModerationStats {
  muted: number;
  banned: number;
  actionsToday: number;
  deletedToday: number;
}

export interface NewModeratedUser {
  chatId: number;
  userId: number;
  state: ModerationUserState;
  /** How long a mute lasts; null for a ban or an indefinite mute. */
  untilSeconds?: number | null;
  reason?: string | null;
  actor: string;
  username?: string | null;
  firstName?: string | null;
}

export interface NewModerationAction {
  chatId: number;
  userId: number;
  username?: string | null;
  firstName?: string | null;
  action: string;
  reason?: string | null;
  actor: string;
  deletedCount?: number;
}

/**
 * Settings the service falls back to when the table has no row. `enabled` is
 * the master switch for automatic moderation; admin reply commands keep
 * working with it off, because a human asked for them.
 */
export const MODERATION_SETTING_DEFAULTS: Readonly<Record<string, string>> = {
  enabled: "1",
  auto_delete: "1",
  auto_mute: "1",
  mute_seconds: "900",
  notice_in_chat: "1",
  notify_user: "1",
};

const nullableText = (value: unknown): string | null =>
  value == null || value === "" ? null : String(value);

const num = (value: unknown): number => Number(value ?? 0);

const stateOf = (value: unknown): ModerationUserState =>
  String(value) === "banned" ? "banned" : "muted";

const mapUser = (row: Record<string, unknown>): ModerationUserRow => ({
  chatId: num(row.chat_id),
  userId: num(row.user_id),
  state: stateOf(row.state),
  untilDate: nullableText(row.until_date),
  reason: nullableText(row.reason),
  actor: String(row.actor ?? ""),
  username: nullableText(row.username),
  firstName: nullableText(row.first_name),
  createdAt: String(row.created_at ?? ""),
  updatedAt: String(row.updated_at ?? ""),
});

const mapAction = (row: Record<string, unknown>): ModerationActionRow => ({
  id: num(row.id),
  chatId: num(row.chat_id),
  userId: num(row.user_id),
  username: nullableText(row.username),
  firstName: nullableText(row.first_name),
  action: String(row.action ?? ""),
  reason: nullableText(row.reason),
  actor: String(row.actor ?? ""),
  deletedCount: num(row.deleted_count),
  createdAt: String(row.created_at ?? ""),
});

/**
 * Creates the moderation tables and seeds the first run's settings and word
 * list. Called once by initDatabase(); every statement is idempotent.
 *
 * The seed words are inserted exactly once: `keywords_seeded` is the marker,
 * so a word the admin deliberately removed never comes back after a restart.
 */
export const initChatModerationTables = async (): Promise<void> => {
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS chat_moderation_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS chat_keywords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phrase TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS chat_moderation_users (
        chat_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('muted', 'banned')),
        until_date TEXT,
        reason TEXT,
        actor TEXT NOT NULL,
        username TEXT,
        first_name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (chat_id, user_id)
    );
  `);
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS chat_moderation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        username TEXT,
        first_name TEXT,
        action TEXT NOT NULL,
        reason TEXT,
        actor TEXT NOT NULL,
        deleted_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // The ids the bot has delivered recently. Telegram only lets a bot delete a
  // message for 48 hours, so this table is pruned on the same clock.
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages (chat_id, user_id, id);`,
  );
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages (created_at);`,
  );
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_chat_moderation_log_created ON chat_moderation_log (created_at);`,
  );
  await turso.execute(
    `CREATE INDEX IF NOT EXISTS idx_chat_moderation_log_user ON chat_moderation_log (chat_id, user_id, created_at);`,
  );

  // Defaults are INSERT OR IGNORE: a value the admin changed is never
  // overwritten by a restart.
  await turso.batch(
    Object.entries(MODERATION_SETTING_DEFAULTS).map(([key, value]) => ({
      sql: `INSERT OR IGNORE INTO chat_moderation_settings (key, value) VALUES (?, ?)`,
      args: [key, value],
    })),
    "write",
  );

  const seeded = await turso.execute(
    `SELECT value FROM chat_moderation_settings WHERE key = 'keywords_seeded'`,
  );
  if (seeded.rows.length === 0) {
    await turso.batch(
      DEFAULT_BLOCKED_KEYWORDS.map((phrase) => ({
        sql: `INSERT OR IGNORE INTO chat_keywords (phrase) VALUES (?)`,
        args: [phrase],
      })),
      "write",
    );
    await turso.execute(
      `INSERT OR IGNORE INTO chat_moderation_settings (key, value) VALUES ('keywords_seeded', '1')`,
    );
  }
};

/** The raw setting rows, so the service can merge them over its defaults. */
export const readModerationSettingRows = async (): Promise<
  Map<string, string>
> => {
  const result = await turso.execute(
    `SELECT key, value FROM chat_moderation_settings`,
  );
  return new Map(
    result.rows.map((row) => [String(row.key), String(row.value)]),
  );
};

/** Writes only the keys given, leaving every other setting untouched. */
export const writeModerationSettingRows = async (
  values: Readonly<Record<string, string>>,
): Promise<void> => {
  const entries = Object.entries(values);
  if (entries.length === 0) return;
  await turso.batch(
    entries.map(([key, value]) => ({
      sql: `INSERT INTO chat_moderation_settings (key, value, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET
              value = excluded.value,
              updated_at = datetime('now')`,
      args: [key, value],
    })),
    "write",
  );
};

/** Every blocked phrase, oldest first, for the admin panel. */
export const listBlockedKeywords = async (): Promise<BlockedKeywordRow[]> => {
  const result = await turso.execute(
    `SELECT id, phrase, created_at FROM chat_keywords ORDER BY id ASC`,
  );
  return result.rows.map((row) => ({
    id: num(row.id),
    phrase: String(row.phrase),
    createdAt: String(row.created_at),
  }));
};

/**
 * Adds one phrase. Returns null when the phrase is already listed (the UNIQUE
 * NOCASE index makes that a no-change instead of an error).
 */
export const addBlockedKeyword = async (
  phrase: string,
): Promise<BlockedKeywordRow | null> => {
  const inserted = await turso.execute({
    sql: `INSERT OR IGNORE INTO chat_keywords (phrase) VALUES (?)`,
    args: [phrase],
  });
  if (Number(inserted.rowsAffected ?? 0) === 0) return null;

  const row = await turso.execute({
    sql: `SELECT id, phrase, created_at FROM chat_keywords
          WHERE phrase = ? COLLATE NOCASE`,
    args: [phrase],
  });
  const found = row.rows[0];
  if (!found) return null;
  return {
    id: num(found.id),
    phrase: String(found.phrase),
    createdAt: String(found.created_at),
  };
};

/** Removes one phrase; true when a row was actually deleted. */
export const removeBlockedKeyword = async (id: number): Promise<boolean> => {
  const result = await turso.execute({
    sql: `DELETE FROM chat_keywords WHERE id = ?`,
    args: [id],
  });
  return Number(result.rowsAffected ?? 0) > 0;
};

/** One message id the bot delivered, recorded so an action can clear it later. */
export const logChatMessage = async (
  chatId: number,
  userId: number,
  messageId: number,
): Promise<void> => {
  await turso.execute({
    sql: `INSERT INTO chat_messages (chat_id, user_id, message_id)
          VALUES (?, ?, ?)`,
    args: [chatId, userId, messageId],
  });
};

/** The ids of this user's recent messages in one chat, newest last. */
export const readChatMessageIds = async (
  chatId: number,
  userId: number,
  limit = 500,
): Promise<number[]> => {
  const result = await turso.execute({
    sql: `SELECT message_id FROM chat_messages
          WHERE chat_id = ? AND user_id = ?
          ORDER BY id DESC
          LIMIT ?`,
    args: [chatId, userId, Math.min(Math.max(limit, 1), 2000)],
  });
  return result.rows.map((row) => num(row.message_id));
};

/** Drops one logged message id, after the bot deleted it by itself. */
export const removeChatMessage = async (
  chatId: number,
  messageId: number,
): Promise<void> => {
  await turso.execute({
    sql: `DELETE FROM chat_messages WHERE chat_id = ? AND message_id = ?`,
    args: [chatId, messageId],
  });
};

/** Drops everything the bot still remembers about one user in one chat. */
export const clearChatMessages = async (
  chatId: number,
  userId: number,
): Promise<void> => {
  await turso.execute({
    sql: `DELETE FROM chat_messages WHERE chat_id = ? AND user_id = ?`,
    args: [chatId, userId],
  });
};

/**
 * Forgets message ids older than Telegram's delete window. Returns how many
 * rows went, so the caller can log a real number at debug level.
 */
export const pruneChatMessages = async (hours = 48): Promise<number> => {
  const safeHours = Math.min(Math.max(Math.trunc(hours), 1), 24 * 30);
  const result = await turso.execute({
    sql: `DELETE FROM chat_messages
          WHERE created_at < datetime('now', ?)`,
    args: [`-${safeHours} hours`],
  });
  return Number(result.rowsAffected ?? 0);
};

/** Records the current restriction on one user, replacing any previous one. */
export const upsertModeratedUser = async (
  user: NewModeratedUser,
): Promise<void> => {
  await turso.execute({
    sql: `INSERT INTO chat_moderation_users
            (chat_id, user_id, state, until_date, reason, actor, username, first_name)
          VALUES (
            ?, ?, ?,
            CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', ?) END,
            ?, ?, ?, ?
          )
          ON CONFLICT(chat_id, user_id) DO UPDATE SET
            state = excluded.state,
            until_date = excluded.until_date,
            reason = excluded.reason,
            actor = excluded.actor,
            username = COALESCE(excluded.username, chat_moderation_users.username),
            first_name = COALESCE(excluded.first_name, chat_moderation_users.first_name),
            updated_at = datetime('now')`,
    args: [
      user.chatId,
      user.userId,
      user.state,
      user.untilSeconds ?? null,
      user.untilSeconds == null
        ? null
        : `+${Math.trunc(user.untilSeconds)} seconds`,
      user.reason ?? null,
      user.actor,
      user.username ?? null,
      user.firstName ?? null,
    ],
  });
};

/** Forgets a user's restriction; true when a row was removed. */
export const removeModeratedUser = async (
  chatId: number,
  userId: number,
): Promise<boolean> => {
  const result = await turso.execute({
    sql: `DELETE FROM chat_moderation_users WHERE chat_id = ? AND user_id = ?`,
    args: [chatId, userId],
  });
  return Number(result.rowsAffected ?? 0) > 0;
};

/** The live restriction on one user, ignoring a mute that has already lifted. */
export const getModeratedUser = async (
  chatId: number,
  userId: number,
): Promise<ModerationUserRow | null> => {
  const result = await turso.execute({
    sql: `SELECT * FROM chat_moderation_users
          WHERE chat_id = ? AND user_id = ?
            AND (until_date IS NULL OR until_date > datetime('now'))`,
    args: [chatId, userId],
  });
  const row = result.rows[0];
  return row ? mapUser(row) : null;
};

/** Drops mutes whose clock ran out; Telegram has already lifted them. */
export const pruneExpiredModeratedUsers = async (): Promise<number> => {
  const result = await turso.execute(
    `DELETE FROM chat_moderation_users
     WHERE state = 'muted' AND until_date IS NOT NULL
       AND until_date <= datetime('now')`,
  );
  return Number(result.rowsAffected ?? 0);
};

/** The mute/ban list, newest first, for the admin panel. */
export const listModeratedUsers = async (
  limit = 100,
): Promise<ModerationUserRow[]> => {
  await pruneExpiredModeratedUsers();
  const result = await turso.execute({
    sql: `SELECT * FROM chat_moderation_users
          ORDER BY updated_at DESC
          LIMIT ?`,
    args: [Math.min(Math.max(limit, 1), 500)],
  });
  return result.rows.map(mapUser);
};

/** Writes one line to the moderation audit trail. */
export const logModerationAction = async (
  action: NewModerationAction,
): Promise<void> => {
  await turso.execute({
    sql: `INSERT INTO chat_moderation_log
            (chat_id, user_id, username, first_name, action, reason, actor, deleted_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      action.chatId,
      action.userId,
      action.username ?? null,
      action.firstName ?? null,
      action.action,
      action.reason ?? null,
      action.actor,
      Math.max(0, Math.trunc(action.deletedCount ?? 0)),
    ],
  });
};

/** The panel's recent-actions list, newest first. */
export const listModerationActions = async (
  limit = 50,
): Promise<ModerationActionRow[]> => {
  const result = await turso.execute({
    sql: `SELECT * FROM chat_moderation_log ORDER BY id DESC LIMIT ?`,
    args: [Math.min(Math.max(limit, 1), 200)],
  });
  return result.rows.map(mapAction);
};

/** The four figures at the top of the panel's chat view. */
export const readModerationStats = async (): Promise<ModerationStats> => {
  const [muted, banned, today] = await turso.batch(
    [
      {
        sql: `SELECT COUNT(*) AS n FROM chat_moderation_users
              WHERE state = 'muted'
                AND (until_date IS NULL OR until_date > datetime('now'))`,
      },
      {
        sql: `SELECT COUNT(*) AS n FROM chat_moderation_users
              WHERE state = 'banned'`,
      },
      {
        sql: `SELECT COUNT(*) AS n,
                     COALESCE(SUM(deleted_count), 0) AS removed
              FROM chat_moderation_log
              WHERE date(created_at, '+330 minutes') =
                    date('now', '+330 minutes')`,
      },
    ],
    "read",
  );
  return {
    muted: num(muted.rows[0]?.n),
    banned: num(banned.rows[0]?.n),
    actionsToday: num(today.rows[0]?.n),
    deletedToday: num(today.rows[0]?.removed),
  };
};
