import { bot } from "../bot.js";

import { sendAttendanceOrMidMarks } from "./studentActions.js";
import { checkMembership } from "../../services/student.utils/checkMembership.js";
import { getClient } from "../../services/redis/getRedisClient.js";

import { ROLL_REGEX, PROTECTED_CHAT_ID } from "../../constants/index.js";
import { sendJoinChannelMsg } from "./studentActions.js";
import { botSecurityHandler, isValidRollNumber } from "../../middleware/security.js";

const getCachedMembership = async (userId: number) => {
   const redisClient = await getClient();
   return (await redisClient.get(`isMember:${userId}`)) === "true";
};

const isAuthorizedUser = async (
   userId: number,
   chatId: number
): Promise<boolean> => {
   let isMember = await getCachedMembership(userId);
   if (!isMember) isMember = await checkMembership(userId);

   if (!isMember && !(chatId === PROTECTED_CHAT_ID)) {
      await sendJoinChannelMsg(userId);
      return false;
   }
   return true;
};

const handleRollNumberMessage = async (msg: any): Promise<void> => {
   const chatId = msg.chat.id;
   const userId = msg.from.id;
   const rollNumber = msg.text.trim().toUpperCase();

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
            [{ text: "Leaderboard 🏆", url: "https://t.me/NbkristQik_bot/nbkristqik_leaderboard" }],
         ],
      },
      reply_to_message_id: msg.message_id,
   });
};

bot.onText(ROLL_REGEX, (msg) => handleRollNumberMessage(msg));

//HANDLE CALLBACK QUERY
bot.on("callback_query", async (callbackQuery) => {
   const { data = "", message: msg } = callbackQuery;

   if (!msg) return;

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
   }
};
