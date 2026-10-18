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

/**
 * Telegram rejected the HTML entities (portal data can contain `<` or `&`).
 * Deliver the same content as plain text instead of leaving the placeholder
 * on screen.
 */
const toPlainText = (html: string): string =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/**
 * Shared flow for roll-number actions: acknowledge with a placeholder
 * message, fetch the real content, then edit the placeholder in place.
 */
const fetchAndEdit = async (
  msg: Message,
  placeholder: string,
  fetchContent: () => Promise<string>,
): Promise<void> => {
  try {
    const chatId = msg.chat.id;
    const message = await bot.sendMessage(
      chatId,
      `<code>${placeholder}</code>`,
      {
        parse_mode: "HTML",
        disable_notification: true,
        reply_to_message_id: msg.reply_to_message?.message_id,
      },
    );

    const finalMessage = await fetchContent();

    try {
      await bot.editMessageText(finalMessage, {
        chat_id: chatId,
        message_id: message.message_id,
        parse_mode: "HTML",
      });
    } catch (e: unknown) {
      logger.warn(
        "[studentActions] edit failed, falling back to plain text:",
        (e as Error)?.message,
      );
      await bot
        .sendMessage(chatId, toPlainText(finalMessage), {
          disable_notification: true,
          reply_to_message_id: msg.message_id,
        })
        .catch(() => {});
    }
  } catch (error: unknown) {
    const err = error as Error;
    logger.error("Error in student action:", error);
    bot
      .sendMessage(msg.chat.id, err?.message || "An unexpected error occurred.")
      .catch(() => {});
  }
};

export const sendAttendanceOrMidMarks = async (
  msg: Message,
  rollno: string,
  signal: Signal,
) => {
  await fetchAndEdit(
    msg,
    `Getting ${signal == "att" ? "attendance" : "mid marks"}...`,
    () => (signal == "att" ? getAttendance(rollno) : getMidMarks(rollno)),
  );
};

export const sendBunkPlan = async (msg: Message, rollno: string) => {
  await fetchAndEdit(msg, "Working out your bunk plan...", () =>
    getBunkPlan(rollno),
  );
};

export const sendJoinChannelMsg = async (chatId: number): Promise<void> => {
  const channelName = CHANNEL_ID.slice(1);
  await bot.sendMessage(
    chatId,
    "👥 Join our channel first, then I can help you here.",
    {
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
    },
  );
};
