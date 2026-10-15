import { bot } from "./bot.js";
import { getClient } from "../services/redis/getRedisClient.js";
import { redisKeys } from "../services/redis/keys.js";
import { ADMIN_ID } from "../config/environmentals.js";
import { logger } from "../config/logger.js";

/** Free academic answers per user in group chats, lifetime. */
export const GROUP_USE_LIMIT = 2;

const BOT_USERNAME = "NbkristQik_bot";
const BOT_DM_URL = `https://t.me/${BOT_USERNAME}?start=fromgroup`;

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
): Promise<boolean> => {
  // private chats and the admin are unlimited
  if (chatId >= 0 || userId === ADMIN_ID) return true;

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

  await bot
    .sendMessage(
      chatId,
      "💬 This group is meant for discussions — you've used your 2 checks here.\n\nUse me in private for unlimited checks 👇",
      {
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
        reply_markup: {
          inline_keyboard: [
            [{ text: "🤖 Open bot in private", url: BOT_DM_URL }],
          ],
        },
      },
    )
    .catch(() => {});
  return false;
};
