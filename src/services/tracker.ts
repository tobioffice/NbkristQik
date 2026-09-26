import type { Message } from "node-telegram-bot-api";
import { turso } from "../db/db.js";
import { logger } from "../config/logger.js";

export type ChatSurface = "private" | "group" | "supergroup" | "channel";

export interface ActivityEvent {
  userId: number;
  username?: string | null;
  firstName?: string | null;
  chatType: ChatSurface | "unknown";
  action: string;
  detail?: string | null;
}

/** Convenience for plain message events (commands etc.) */
export const trackMessage = (
  msg: Message,
  action: string,
  detail?: string,
): void => {
  if (!msg.from?.id) return;
  trackActivity({
    userId: msg.from.id,
    username: msg.from.username,
    firstName: msg.from.first_name,
    chatType: msg.chat.type as ChatSurface,
    action,
    detail,
  });
};

/**
 * Records one user interaction for the admin panel: upserts the user's
 * profile + counters and appends to the activity log.
 * Fire-and-forget by design — tracking must never delay or break a reply.
 */
const record = async (event: ActivityEvent): Promise<void> => {
  const surface = event.chatType === "supergroup" ? "group" : event.chatType;

  await turso.batch(
    [
      {
        sql: `INSERT INTO botusers (user_id, username, first_name, first_seen, last_seen,
                private_actions, channel_actions, group_actions, total_actions)
              VALUES (?, ?, ?, datetime('now'), datetime('now'), 0, 0, 0, 0)
              ON CONFLICT(user_id) DO UPDATE SET
                username = COALESCE(excluded.username, botusers.username),
                first_name = COALESCE(excluded.first_name, botusers.first_name),
                last_seen = datetime('now'),
                private_actions = botusers.private_actions
                  + CASE WHEN ? = 'private' THEN 1 ELSE 0 END,
                channel_actions = botusers.channel_actions
                  + CASE WHEN ? = 'channel' THEN 1 ELSE 0 END,
                group_actions = botusers.group_actions
                  + CASE WHEN ? = 'group' THEN 1 ELSE 0 END,
                total_actions = botusers.total_actions + 1`,
        args: [
          event.userId,
          event.username ?? null,
          event.firstName ?? null,
          surface,
          surface,
          surface,
        ],
      },
      {
        sql: `INSERT INTO activity_log (user_id, chat_type, action, detail)
              VALUES (?, ?, ?, ?)`,
        args: [
          event.userId,
          surface,
          event.action,
          event.detail ?? null,
        ],
      },
    ],
    "write",
  );
};

export const trackActivity = (event: ActivityEvent): void => {
  record(event).catch((e) =>
    logger.debug("[tracker] activity write failed:", e),
  );
};
