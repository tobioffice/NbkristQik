import type { Message } from "node-telegram-bot-api";
import { turso } from "../db/db.js";
import { getClient } from "./redis/getRedisClient.js";
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
 * Records one user interaction for the admin panel.
 * Fire-and-forget by design — tracking must never delay or break a reply.
 *
 * Write budget: the per-user profile upsert runs at most once a minute per
 * user (Redis NX gate) — a hot user hammering the bot was re-writing their
 * row on every action. The activity_log row is written for EVERY action,
 * since all charts and feeds aggregate from it.
 */
const record = async (event: ActivityEvent): Promise<void> => {
  const surface = event.chatType === "supergroup" ? "group" : event.chatType;

  let skipProfile = false;
  try {
    const redis = await getClient();
    const claimed = await redis.set(`track:p:${event.userId}`, "1", {
      EX: 60,
      NX: true,
    });
    skipProfile = !claimed;
  } catch {
    // Redis unavailable — fall through and do the full upsert
  }

  const statements = skipProfile
    ? []
    : [
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
      ];

  statements.push({
    sql: `INSERT INTO activity_log (user_id, chat_type, action, detail)
          VALUES (?, ?, ?, ?)`,
    args: [event.userId, surface, event.action, event.detail ?? null],
  });

  await turso.batch(statements, "write");
};

export const trackActivity = (event: ActivityEvent): void => {
  record(event).catch((e) =>
    logger.debug("[tracker] activity write failed:", e),
  );
};
