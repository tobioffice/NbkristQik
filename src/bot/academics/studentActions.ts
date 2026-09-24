import { Signal } from "../../constants/index.js";
import { CHANNEL_ID } from "../../config/environmentals.js";
import { getMidMarks, getAttendance } from "../../services/student.service.js";
import { getStudentCached } from "../../services/redis/utils.js";
import { upsertTgUser } from "../../db/student.model.js";

import { bot } from "../bot.js";

/**
 * Remember userId→rollNo so the web leaderboard can show "You are #N".
 * Best-effort: never blocks or fails the user's request.
 */
const rememberUserRoll = (userId: number, rollno: string): void => {
   getStudentCached(rollno)
      .then((student) => upsertTgUser(String(userId), student))
      .catch((err) =>
         console.warn("[studentActions] tgusers upsert failed:", err)
      );
};

export const sendAttendanceOrMidMarks = async (
   msg: any,
   rollno: string,
   signal: Signal
) => {
   try {
      const chatId = msg.chat.id;
      const userId = msg.from?.id;
      if (userId) rememberUserRoll(userId, rollno);

      const message = await bot.sendMessage(
         chatId,
         `<code>Fetching ${signal == "att" ? "Attendance" : "Mid marks"
         }...</code>`,
         {
            parse_mode: "HTML",
            disable_notification: true,
            reply_to_message_id: msg.reply_to_message.message_id,
         }
      );

      const finalMessage =
         signal == "att"
            ? await getAttendance(rollno)
            : await getMidMarks(rollno);

      bot.editMessageText(finalMessage, {
         chat_id: chatId,
         message_id: message.message_id,
         parse_mode: "HTML",
      });
   } catch (error: any) {
      console.log("Error in sendAttendanceOrMidMarks:", error);
      bot.sendMessage(
         msg.chat.id,
         error.message || "An unexpected error occurred."
      );
      return;
   }
};

export const sendJoinChannelMsg = async (chatId: number): Promise<void> => {
   const channelName = CHANNEL_ID.slice(1);
   await bot.sendMessage(chatId, "Join the channel to use in private ‼️", {
      reply_markup: {
         inline_keyboard: [
            [
               {
                  text: `Join @${channelName}`,
                  url: `https://t.me/${channelName}`,
               },
            ],
         ],
      },
   });
};
