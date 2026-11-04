/**
 * Daily check-in: one tap that records the student for the day.
 *
 * - /postcheckin (admin only): posts + pins a check-in message in the channel
 *   and stores its message_id in Redis.
 * - Users tap "Check in" on the post -> dailyUnlocked:{userId} is written with
 *   a TTL until next midnight IST. It records the day; nothing gates on it.
 */
import { bot } from "./bot.js";
import { ADMIN_ID, CHANNEL_ID } from "../config/environmentals.js";
import { getClient } from "../services/redis/getRedisClient.js";
import { redisKeys } from "../services/redis/keys.js";
import { logger } from "../config/logger.js";
import { trackActivity, ChatSurface } from "../services/tracker.js";
import { BOT_USERNAME, channelLink } from "../constants/telegram.js";
import { CHECK_IN_PROMPT } from "./replies.js";

const MSG_ID_KEY = redisKeys.checkinPostMsgId;

/** How long a /postcheckin status reply stays before the bot clears it. */
const ADMIN_REPLY_TTL_MS = 30_000;

/**
 * Send a status reply that removes itself. The admin already knows what they
 * ran; leaving the result in the chat just buries the next message.
 */
const replyAutoDelete = async (
  chatId: number,
  text: string,
  parseMode?: "HTML",
): Promise<void> => {
  try {
    const sent = await bot.sendMessage(
      chatId,
      text,
      parseMode ? { parse_mode: parseMode } : {},
    );
    setTimeout(() => {
      bot.deleteMessage(chatId, sent.message_id).catch(() => {});
    }, ADMIN_REPLY_TTL_MS);
  } catch (e) {
    logger.warn("[dailyCheckIn] reply failed:", e);
  }
};

/** Seconds until next midnight IST (UTC+5:30), calendar-day reset. */
export const secondsUntilMidnightIST = (now: Date = new Date()): number => {
  const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const istMidnight = new Date(
    Date.UTC(
      istNow.getUTCFullYear(),
      istNow.getUTCMonth(),
      istNow.getUTCDate() + 1,
      0,
      0,
      0,
    ),
  );
  return Math.max(
    60,
    Math.floor((istMidnight.getTime() - istNow.getTime()) / 1000),
  );
};

// remove previous pinned check-in post if it exists
const deletePreviousPost = async (
  redis: Awaited<ReturnType<typeof getClient>>,
) => {
  const oldMsgId = await redis.get(MSG_ID_KEY);
  if (oldMsgId) {
    await bot.deleteMessage(CHANNEL_ID, Number(oldMsgId)).catch(() => {});
  }
};

const createCheckInPost = async (
  redis: Awaited<ReturnType<typeof getClient>>,
): Promise<{ messageId: number; pinned: boolean }> => {
  const sent = await bot.sendMessage(CHANNEL_ID, CHECK_IN_PROMPT, {
    parse_mode: "HTML",
    disable_notification: true,
    reply_markup: {
      inline_keyboard: [[{ text: "✅ Check in", callback_data: "dailycheck" }]],
    },
  });

  // store the post first: even without pin rights students can still tap it,
  // and a second /postcheckin won't leave the previous post behind
  await redis.set(MSG_ID_KEY, String(sent.message_id));

  let pinned = true;
  try {
    await bot.pinChatMessage(CHANNEL_ID, sent.message_id, {
      disable_notification: true,
    });
  } catch (e) {
    pinned = false;
    logger.warn("[dailyCheckIn] pin failed:", e);
  }

  return { messageId: sent.message_id, pinned };
};

// --- /postcheckin (admin only) ---
bot.onText(/^\/postcheckin$/, async (msg) => {
  // admin only: silently ignore anyone else, and never advertise it publicly
  if (!ADMIN_ID || msg.from?.id !== ADMIN_ID) return;

  try {
    const redis = await getClient();
    await deletePreviousPost(redis);
    const { messageId, pinned } = await createCheckInPost(redis);

    const link = channelLink(messageId);
    await replyAutoDelete(
      msg.chat.id,
      pinned
        ? `✅ Daily check-in posted and pinned: ${link}\n<i>It stays up until the next one replaces it.</i>`
        : `✅ Daily check-in posted: ${link}\n⚠️ I couldn't pin it. Give @${BOT_USERNAME} "Pin messages" rights in the channel, then run /postcheckin again.`,
      "HTML",
    );
  } catch (e) {
    logger.error("[dailyCheckIn] /postcheckin error:", e);
    const reason = e instanceof Error ? e.message : String(e);
    await replyAutoDelete(
      msg.chat.id,
      `❌ Couldn't post the check-in: ${reason}\n\n` +
        `Make sure @${BOT_USERNAME} is a channel admin with "Post messages" turned on.`,
    );
  }
});

// --- callback: dailycheck ---
bot.on("callback_query", async (query) => {
  if (query.data !== "dailycheck" || !query.message) return;

  try {
    const redis = await getClient();
    const userId = query.from.id;
    const key = redisKeys.dailyUnlocked(userId);

    const ttl = secondsUntilMidnightIST();
    // record the day; nothing gates on this key any more
    await redis.set(key, "1", { EX: ttl });
    await redis.sAdd(redisKeys.broadcastUsers, String(userId));

    trackActivity({
      userId,
      username: query.from.username,
      firstName: query.from.first_name,
      chatType: query.message.chat.type as ChatSurface,
      action: "daily_checkin",
    });

    await bot.answerCallbackQuery(query.id, {
      text: "✅ You're all set!",
    });
  } catch (e) {
    logger.error("[dailyCheckIn] callback error:", e);
    await bot
      .answerCallbackQuery(query.id, {
        text: "❌ Something went wrong. Try again.",
      })
      .catch(() => {});
  }
});
