import { Signal } from "../../constants/index.js";
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
const toPlainText = (html: string): string => {
  // Walk the string once instead of regex-stripping tags: portal text can
  // contain `<`, and a pattern-based strip is easy to get wrong.
  let out = "";
  let inTag = false;
  for (const ch of html) {
    if (ch === "<") inTag = true;
    else if (ch === ">" && inTag) inTag = false;
    else if (!inTag) out += ch;
  }
  return out
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
};

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
      // Telegram rejected the markup, so the student is still looking at the
      // placeholder. Deliver the same numbers as plain text instead.
      logger.warn(
        "[studentActions] edit failed, falling back to plain text:",
        (e as Error)?.message,
      );
      await bot
        .sendMessage(chatId, toPlainText(finalMessage), {
          disable_notification: true,
          reply_to_message_id: msg.reply_to_message?.message_id,
        })
        .catch(() => {});
    }
  } catch (error: unknown) {
    const err = error as Error;
    logger.error("Error in student action:", error);
    bot
      .sendMessage(
        msg.chat.id,
        err?.message || "Something broke on my side. Try again in a bit.",
      )
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
    `Getting ${signal == "att" ? "your attendance" : "your mid marks"}...`,
    () => (signal == "att" ? getAttendance(rollno) : getMidMarks(rollno)),
  );
};

export const sendBunkPlan = async (msg: Message, rollno: string) => {
  await fetchAndEdit(msg, "Working out what you can bunk...", () =>
    getBunkPlan(rollno),
  );
};
