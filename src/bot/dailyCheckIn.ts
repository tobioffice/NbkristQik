/**
 * Daily check-in: attention farm for channel ad impressions.
 *
 * - /postcheckin (admin only): posts + pins the check-in message in the channel,
 *   stores its message_id in Redis.
 * - Users click "I'm not a robot" on the pinned channel post -> dailyUnlocked:{userId}
 *   with TTL until next midnight IST (calendar-day reset).
 * - academicHandler gates bot access on this key.
 */
import { bot } from "./bot.js";
import { ADMIN_ID, CHANNEL_ID } from "../config/environmentals.js";
import { getClient } from "../services/redis/getRedisClient.js";
import { redisKeys } from "../services/redis/keys.js";
import { logger } from "../config/logger.js";
import { trackActivity, ChatSurface } from "../services/tracker.js";

const MSG_ID_KEY = redisKeys.checkinPostMsgId;

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

/** Check if user unlocked today. Gate is OFF until /postcheckin has been run once. */
export const isDailyUnlocked = async (userId: number): Promise<boolean> => {
  try {
    const redis = await getClient();
    // no check-in post created yet -> gate dormant
    if (!(await redis.get(MSG_ID_KEY))) return true;
    return (await redis.get(redisKeys.dailyUnlocked(userId))) === "1";
  } catch (e) {
    logger.error("[dailyCheckIn] isDailyUnlocked error:", e);
    return true; // never hard-lock users on redis failure
  }
};

/** Deep link to the pinned check-in post, or channel root as fallback. */
export const getCheckInLink = async (): Promise<string> => {
  const channel = (CHANNEL_ID || "").replace("@", "");
  if (!channel) return "https://t.me/NbkristQik_bot";
  try {
    const redis = await getClient();
    const msgId = await redis.get(MSG_ID_KEY);
    return msgId
      ? `https://t.me/${channel}/${msgId}`
      : `https://t.me/${channel}`;
  } catch (e) {
    logger.error("[dailyCheckIn] getCheckInLink error:", e);
    return `https://t.me/${channel}`;
  }
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
  const sent = await bot.sendMessage(
    CHANNEL_ID,
    `🔓 <b>Quick human check</b>\n\n👇 Tap <b>I'm not a robot</b> and you're in.`,
    {
      parse_mode: "HTML",
      disable_notification: true,
      reply_markup: {
        inline_keyboard: [
          [{ text: "🤖 I'm not a robot 👇", callback_data: "dailycheck" }],
        ],
      },
    },
  );

  // store the post first: even without pin rights the gate can work, and a
  // second /postcheckin won't leave the previous post behind
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

    const channel = (CHANNEL_ID || "").replace("@", "");
    const link = `https://t.me/${channel}/${messageId}`;
    await bot.sendMessage(
      msg.chat.id,
      pinned
        ? `✅ Check-in post created and pinned: ${link}\n<i>Gate is now ACTIVE for all users (until midnight IST).</i>`
        : `✅ Check-in post created: ${link}\n⚠️ I couldn't pin it. Give @NbkristQik_bot "Pin messages" rights in the channel, then run /postcheckin again.\n<i>Gate is now ACTIVE for all users (until midnight IST).</i>`,
      { parse_mode: "HTML" },
    );
  } catch (e) {
    logger.error("[dailyCheckIn] /postcheckin error:", e);
    const reason = e instanceof Error ? e.message : String(e);
    bot
      .sendMessage(
        msg.chat.id,
        `❌ Couldn't post the check-in: ${reason}\n\n` +
          `Make sure @NbkristQik_bot is a channel admin with "Post messages" turned on.`,
      )
      .catch(() => {});
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
      url: "https://t.me/NbkristQik_bot?start=unlocked",
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
