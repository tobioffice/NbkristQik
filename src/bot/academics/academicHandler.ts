import { bot } from "../bot.js";

import { sendAttendanceOrMidMarks, sendJoinChannelMsg, sendBunkPlan } from "./studentActions.js";
import { checkMembership } from "../../services/student.utils/checkMembership.js";
import { getClient } from "../../services/redis/getRedisClient.js";

import { ROLL_REGEX, PROTECTED_CHAT_ID, CHIT_CHAT_ID } from "../../constants/index.js";
import { botSecurityHandler, isValidRollNumber } from "../../middleware/security.js";
import { ADMIN_ID } from "../../config/environmentals.js";
import { isDailyUnlocked, getCheckInLink } from "../dailyCheckIn.js";

const getCachedMembership = async (userId: number) => {
   const redisClient = await getClient();
   return (await redisClient.get(`isMember:${userId}`)) === "true";
};

const isAuthorizedUser = async (
   userId: number,
   chatId: number
): Promise<boolean> => {
   // admin always allowed
   if (userId === ADMIN_ID) return true;

   let isMember = await getCachedMembership(userId);
   if (!isMember) isMember = await checkMembership(userId);

   if (!isMember && !(chatId === PROTECTED_CHAT_ID)) {
      await sendJoinChannelMsg(userId);
      return false;
   }

   // daily check-in gate (dormant until /postcheckin creates the post)
   if (!(await isDailyUnlocked(userId))) {
      const checkInLink = await getCheckInLink();
      // reply in the group if used there, DM only for private chats
      const target = chatId < 0 ? chatId : userId;
      await bot.sendMessage(
         target,
         "🤖 <b>Prove you're human!</b>\n\n👇 Tap <b>\"I'm not a robot\"</b> in the channel to unlock the bot for today",
         {
            parse_mode: "HTML",
            reply_markup: {
               inline_keyboard: [[{ text: "👇 I'm not a robot", url: checkInLink }]],
            },
         }
      );
      return false;
   }

   // track user for broadcasts (best-effort, never block)
   try {
      const redisClient = await getClient();
      await redisClient.sAdd("qik:users", String(userId));
   } catch (e) {
      console.error("user tracking failed:", e);
   }
   return true;
};

const handleRollNumberMessage = async (msg: any): Promise<void> => {
   const chatId = msg.chat.id;
   const userId = msg.from.id;
   const rollNumber = msg.text.trim().toUpperCase();

   // remember their roll for "You are #N" in the leaderboard web app (best-effort)
   try {
      const redisClient = await getClient();
      await redisClient.set(`userRoll:${userId}`, rollNumber, { EX: 60 * 60 * 24 * 90 });
   } catch (e) {
      console.warn("roll tracking failed:", e);
   }

   // Check rate limit first
   const rateLimitAllowed = await botSecurityHandler(userId, 'roll_number');
   if (!rateLimitAllowed) {
      await bot.sendMessage(chatId, '🚫 Too many requests! Please wait a minute before trying again.');
      return;
   }

   // Validate roll number format
   if (!isValidRollNumber(rollNumber)) {
      await bot.sendMessage(chatId, '⚠️ Invalid roll number format! Please check and try again.');
      return;
   }

   const authorized = await isAuthorizedUser(msg.from.id, chatId);
   if (!authorized) return;

   await bot.sendMessage(chatId, "Select an option:", {
      reply_markup: {
         inline_keyboard: [
            [{ text: "Attendance 🚀", callback_data: `att_${rollNumber}` }],
            [{ text: "Mid Marks 📊", callback_data: `mid_${rollNumber}` }],
            [{ text: "Bunk Plan 🎯", callback_data: `bunk_${rollNumber}` }],
            [{ text: "Leaderboard 🏆", url: "https://t.me/NbkristQik_bot/nbkristqik_leaderboard" }],
         ],
      },
      reply_to_message_id: msg.message_id,
   });
};

bot.onText(ROLL_REGEX, (msg) => {
   // chit chat group: delete roll numbers, brief in-group notice that self-deletes
   if (msg.chat.id === CHIT_CHAT_ID) {
      bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
      bot.sendMessage(
         msg.chat.id,
         "🤖 Roll numbers don't work here, DM @NbkristQik_bot to check attendance",
         { disable_notification: true }
      )
         .then((notice: any) => {
            setTimeout(() => {
               bot.deleteMessage(msg.chat.id, notice.message_id).catch(() => {});
            }, 15000);
         })
         .catch(() => {});
      return;
   }
   handleRollNumberMessage(msg);
});

//HANDLE CALLBACK QUERY
bot.on("callback_query", async (callbackQuery) => {
   const { data = "", message: msg } = callbackQuery;

   if (!msg) return;

   // chit chat group: bot never responds there
   if (msg.chat.id === CHIT_CHAT_ID) {
      await bot.answerCallbackQuery(callbackQuery.id, {
         text: "🤖 Bot doesn't work here — DM @NbkristQik_bot instead",
         show_alert: true,
      }).catch(() => {});
      return;
   }

   // dailycheck is fully handled in dailyCheckIn.ts (would otherwise
   // rate-limit + try to delete the pinned channel post)
   if (data === "dailycheck") return;

   const userId = callbackQuery.from?.id || msg.chat.id;

   // Check rate limit for callback queries
   const rateLimitAllowed = await botSecurityHandler(userId, 'callback');
   if (!rateLimitAllowed) {
      await bot.answerCallbackQuery(callbackQuery.id, {
         text: '🚫 Too many requests! Please wait a minute.',
         show_alert: true
      });
      return;
   }

   const authorized = await isAuthorizedUser(userId, msg.chat.id);
   if (!authorized) {
      await bot.answerCallbackQuery(callbackQuery.id, {
         text: '❌ Authorization required',
         show_alert: true
      });
      return;
   }

   await Promise.allSettled([
      bot.deleteMessage(msg.chat.id, msg.message_id),
      handleCallbackAction(data, msg),
      bot.answerCallbackQuery(callbackQuery.id),
   ]);
});

const handleCallbackAction = async (data: string, msg: any) => {
   if (data.startsWith("att_")) {
      const rollNumber = data.slice(4); // More efficient than split
      if (!isValidRollNumber(rollNumber)) {
         await bot.sendMessage(msg.chat.id, '⚠️ Invalid roll number format!');
         return;
      }
      await sendAttendanceOrMidMarks(msg, rollNumber, "att");
   } else if (data.startsWith("mid_")) {
      const rollNumber = data.slice(4);
      if (!isValidRollNumber(rollNumber)) {
         await bot.sendMessage(msg.chat.id, '⚠️ Invalid roll number format!');
         return;
      }
      await sendAttendanceOrMidMarks(msg, rollNumber, "mid");
   } else if (data.startsWith("bunk_")) {
      const rollNumber = data.slice(5);
      if (!isValidRollNumber(rollNumber)) {
         await bot.sendMessage(msg.chat.id, '⚠️ Invalid roll number format!');
         return;
      }
      await sendBunkPlan(msg, rollNumber);
   }
};