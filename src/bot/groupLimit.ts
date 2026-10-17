import { bot } from "./bot.js";
import { getClient } from "../services/redis/getRedisClient.js";
import { redisKeys } from "../services/redis/keys.js";
import { ADMIN_ID } from "../config/environmentals.js";
import { logger } from "../config/logger.js";
import type { ChatSurface } from "../services/tracker.js";

/** Free academic answers per user in group chats, lifetime. */
export const GROUP_USE_LIMIT = 2;

/** How long the group "continue in private" card lingers before self-deleting. */
export const GROUP_REDIRECT_TTL_MS = 20_000;

const BOT_USERNAME = "NbkristQik_bot";
const BOT_DM_URL = `https://t.me/${BOT_USERNAME}?start=fromgroup`;

export { BOT_USERNAME, BOT_DM_URL };

/**
 * Group-chat usage gate: each user gets GROUP_USE_LIMIT academic answers in
 * groups, lifetime. Past that, groups stay for discussion and the user is
 * pointed to DM with a one-tap Start button.
 *
 * Returns true when the caller may serve the request (consuming one use).
 * Private chats and the admin bypass entirely. Fails open — a Redis problem
 * never blocks answers.
 */
export const checkGroupUse = async (
  userId: number,
  chatId: number,
  replyToMessageId?: number,
  chatType?: ChatSurface | string,
): Promise<boolean> => {
  // private chats and the admin are unlimited
  if (chatId >= 0 || userId === ADMIN_ID) return true;
  // channels are broadcast: never count uses, never post the redirect there
  if (chatType === "channel") return true;

  let used: number;
  try {
    const redis = await getClient();
    // atomic: the count includes this attempt, so concurrent uses can't
    // both slip through on a stale read
    used = await redis.incr(redisKeys.groupUses(userId));
  } catch (e) {
    logger.warn("[groupLimit] counter failed:", e);
    return true;
  }

  if (used <= GROUP_USE_LIMIT) return true;

  // past the quota: every attempt gets exactly one redirect card, sent as a
  // reply to the user's own message. Both the card and the message that
  // triggered it self-delete after GROUP_REDIRECT_TTL_MS, so the group never
  // collects a pile of them.
  try {
    const notice = await bot.sendMessage(
      chatId,
      "This group is meant for chat. You can continue in private.",
      {
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
        disable_notification: true,
        reply_markup: {
          inline_keyboard: [
            [{ text: "🤖 Open bot in private", url: BOT_DM_URL }],
          ],
        },
      },
    );
    setTimeout(() => {
      bot.deleteMessage(chatId, notice.message_id).catch(() => {});
      if (replyToMessageId) {
        bot.deleteMessage(chatId, replyToMessageId).catch(() => {});
      }
    }, GROUP_REDIRECT_TTL_MS);
  } catch (e) {
    logger.warn("[groupLimit] redirect card failed:", e);
  }
  return false;
};
