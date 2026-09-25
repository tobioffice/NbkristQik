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

const MSG_ID_KEY = "checkin:post:msgId";
const UNLOCK_PREFIX = "dailyUnlocked:";

/** Seconds until next midnight IST (UTC+5:30), calendar-day reset. */
const secondsUntilMidnightIST = (): number => {
   const now = new Date();
   const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
   const istMidnight = new Date(
      Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + 1, 0, 0, 0)
   );
   return Math.max(60, Math.floor((istMidnight.getTime() - istNow.getTime()) / 1000));
};

/** Check if user unlocked today. Gate is OFF until /postcheckin has been run once. */
export const isDailyUnlocked = async (userId: number): Promise<boolean> => {
   try {
      const redis = await getClient();
      // no check-in post created yet -> gate dormant
      if (!(await redis.get(MSG_ID_KEY))) return true;
      return (await redis.get(`${UNLOCK_PREFIX}${userId}`)) === "1";
   } catch (e) {
      console.error("[dailyCheckIn] isDailyUnlocked error:", e);
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
      return msgId ? `https://t.me/${channel}/${msgId}` : `https://t.me/${channel}`;
   } catch (e) {
      console.error("[dailyCheckIn] getCheckInLink error:", e);
      return `https://t.me/${channel}`;
   }
};

// --- /postcheckin (admin only) ---
bot.onText(/\/postcheckin/, async (msg) => {
   if (msg.from?.id !== ADMIN_ID) return;

   try {
      const redis = await getClient();

      // remove previous pinned check-in post if it exists
      const oldMsgId = await redis.get(MSG_ID_KEY);
      if (oldMsgId) {
         await bot.deleteMessage(CHANNEL_ID, Number(oldMsgId)).catch(() => {});
      }

      const sent = await bot.sendMessage(
         CHANNEL_ID,
         `🤖 <b>Prove you're human!</b>\n\n👇 Tap the button below to unlock the bot for today`,
         {
            parse_mode: "HTML",
            disable_notification: true,
            reply_markup: {
               inline_keyboard: [
                  [{ text: "🤖 I'm not a robot 👇", callback_data: "dailycheck" }],
               ],
            },
         }
      );

      await bot.pinChatMessage(CHANNEL_ID, sent.message_id, { disable_notification: true }).catch(() => {});
      await redis.set(MSG_ID_KEY, String(sent.message_id));

      const channel = (CHANNEL_ID || "").replace("@", "");
      await bot.sendMessage(
         msg.chat.id,
         `✅ Check-in post created and pinned: https://t.me/${channel}/${sent.message_id}\n<i>Gate is now ACTIVE for all users (until midnight IST).</i>`,
         { parse_mode: "HTML" }
      );
   } catch (e) {
      console.error("[dailyCheckIn] /postcheckin error:", e);
      bot.sendMessage(msg.chat.id, `❌ Failed to create check-in post: ${e}`).catch(() => {});
   }
});

// --- callback: dailycheck ---
bot.on("callback_query", async (query) => {
   if (query.data !== "dailycheck" || !query.message) return;

   try {
      const redis = await getClient();
      const userId = query.from.id;
      const key = `${UNLOCK_PREFIX}${userId}`;

      const ttl = secondsUntilMidnightIST();
      await redis.set(key, "1", { EX: ttl });
      await redis.sAdd("qik:users", String(userId));

      await bot.answerCallbackQuery(query.id, {
         text: "✅ Unlocked! Go check your attendance",
         show_alert: true,
      });
   } catch (e) {
      console.error("[dailyCheckIn] callback error:", e);
      await bot.answerCallbackQuery(query.id, { text: "❌ Something went wrong, try again" }).catch(() => {});
   }
});