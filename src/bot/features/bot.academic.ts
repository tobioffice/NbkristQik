import { bot } from "../bot.js";
import { sendAttendanceOrMidMarks } from "./utils/studentActions.js";
import { ROLL_REGEX } from "../../constants/index.js";
import { checkMembership } from "../../services/student.utils/checkMembership.js";
import { CHANNEL_ID } from "../../config/environmentals.js";

import { getClient } from "../../services/redis/getRedisClient.js";

const PROTECTED_CHAT_ID = -1002435023187;

const sendJoinChannelMsg = async (chatId: number): Promise<void> => {
  try {
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
  } catch (err) {
    console.log(err);
  }
};

const handleRollNumberMessage = async (msg: any): Promise<void> => {
  const userId = msg.from?.id || msg.chat.id;

  const redisClient = await getClient();
  const cachedMembership = await redisClient.get(`isMember:${userId}`);
  let isMember: boolean;

  if (cachedMembership === "true") {
    isMember = true;
  } else {
    isMember = await checkMembership(userId);
  }

  if (!isMember && msg.chat.id !== PROTECTED_CHAT_ID) {
    await sendJoinChannelMsg(userId);
    return;
  }

  try {
    await bot.sendMessage(msg.chat.id, "Select an option:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Attendance 🚀", callback_data: `att_${msg.text}` }],
          [{ text: "Mid Marks 📊", callback_data: `mid_${msg.text}` }],
        ],
      },
      reply_to_message_id: msg.message_id,
    });
  } catch (error) {
    console.log("Error sending options:", error);
    bot.sendMessage(msg.chat.id, "An error occurred. Please try again later.");
  }
};

bot.onText(ROLL_REGEX, async (msg) => {
  try {
    await handleRollNumberMessage(msg);
  } catch (error) {
    console.error("Error handling roll number message:", error);
  }
});

//HANDLE CALLBACK QUERY
bot.on("callback_query", async (callbackQuery) => {
  const { data = "", message: msg } = callbackQuery;

  if (!msg) return;

  const userId = callbackQuery.from?.id || msg.chat.id;
  const redisClient = await getClient();
  const cachedMembership = await redisClient.get(`isMember:${userId}`);
  let isMember: boolean;

  if (cachedMembership === "true") {
    console.log("done a cashed membership verification");
    isMember = true;
  } else {
    isMember = await checkMembership(userId);
  }

  if (!isMember && msg.chat.id !== -1002435023187) {
    await sendJoinChannelMsg(userId);
    return;
  }

  // Delete the message and handle the callback action
  try {
    await Promise.allSettled([
      bot.deleteMessage(msg.chat.id, msg.message_id),
      handleCallbackAction(data, msg),
      bot.answerCallbackQuery(callbackQuery.id),
    ]);
  } catch (err) {
    console.log(err);
  }
});

const handleCallbackAction = async (data: string, msg: any) => {
  if (data.startsWith("att_")) {
    const rollNumber = data.slice(4); // More efficient than split
    await sendAttendanceOrMidMarks(bot, msg, rollNumber, "att");
  } else if (data.startsWith("mid_")) {
    const rollNumber = data.slice(4);
    await sendAttendanceOrMidMarks(bot, msg, rollNumber, "mid");
  }
};
