import { Signal } from "../../constants/index.js";
import { CHANNEL_ID } from "../../config/environmentals.js";
import {
  getMidMarks,
  getAttendance,
  getBunkPlan,
} from "../../services/student.service.js";

import { bot } from "../bot.js";
import type { Message } from "node-telegram-bot-api";
import { logger } from "../../config/logger.js";

export const sendAttendanceOrMidMarks = async (
  msg: Message,
  rollno: string,
  signal: Signal,
) => {
  try {
    const chatId = msg.chat.id;
    const message = await bot.sendMessage(
      chatId,
      `<code>Fetching ${
        signal == "att" ? "Attendance" : "Mid marks"
      }...</code>`,
      {
        parse_mode: "HTML",
        disable_notification: true,
        reply_to_message_id: msg.reply_to_message?.message_id,
      },
    );

    const finalMessage =
      signal == "att" ? await getAttendance(rollno) : await getMidMarks(rollno);

    await bot
      .editMessageText(finalMessage, {
        chat_id: chatId,
        message_id: message.message_id,
        parse_mode: "HTML",
      })
      .catch((e: Error) =>
        logger.warn("[studentActions] edit failed:", e?.message),
      );
  } catch (error: unknown) {
    const err = error as Error;
    logger.error("Error in sendAttendanceOrMidMarks:", error);
    bot
      .sendMessage(msg.chat.id, err?.message || "An unexpected error occurred.")
      .catch(() => {});
    return;
  }
};

export const sendBunkPlan = async (msg: Message, rollno: string) => {
  try {
    const chatId = msg.chat.id;
    const message = await bot.sendMessage(
      chatId,
      `<code>Calculating bunk plan...</code>`,
      {
        parse_mode: "HTML",
        disable_notification: true,
        reply_to_message_id: msg.reply_to_message?.message_id,
      },
    );

    const finalMessage = await getBunkPlan(rollno);

    await bot
      .editMessageText(finalMessage, {
        chat_id: chatId,
        message_id: message.message_id,
        parse_mode: "HTML",
      })
      .catch((e: Error) =>
        logger.warn("[studentActions] edit failed:", e?.message),
      );
  } catch (error: unknown) {
    const err = error as Error;
    logger.error("Error in sendBunkPlan:", error);
    bot
      .sendMessage(msg.chat.id, err?.message || "An unexpected error occurred.")
      .catch(() => {});
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
