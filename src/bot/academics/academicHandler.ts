import { bot } from "../bot.js";

import { sendAttendanceOrMidMarks } from "./studentActions.js";
import { checkMembership } from "../../services/student.utils/checkMembership.js";
import { getClient } from "../../services/redis/getRedisClient.js";

import { ROLL_REGEX, PROTECTED_CHAT_ID } from "../../constants/index.js";
import { sendJoinChannelMsg } from "./studentActions.js";

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

   const authorized = await isAuthorizedUser(msg.from.id, chatId);
   if (!authorized) return;
   await bot.sendMessage(chatId, "Select an option:", {
      reply_markup: {
         inline_keyboard: [
            [{ text: "Attendance 🚀", callback_data: `att_${msg.text}` }],
            [{ text: "Mid Marks 📊", callback_data: `mid_${msg.text}` }],
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
   const authorized = await isAuthorizedUser(userId, msg.chat.id);
   if (!authorized) return;

   await Promise.allSettled([
      bot.deleteMessage(msg.chat.id, msg.message_id),
      handleCallbackAction(data, msg),
      bot.answerCallbackQuery(callbackQuery.id),
   ]);
});

const handleCallbackAction = async (data: string, msg: any) => {
   if (data.startsWith("att_")) {
      const rollNumber = data.slice(4); // More efficient than split
      await sendAttendanceOrMidMarks(msg, rollNumber, "att");
   } else if (data.startsWith("mid_")) {
      const rollNumber = data.slice(4);
      await sendAttendanceOrMidMarks(msg, rollNumber, "mid");
   }
};
