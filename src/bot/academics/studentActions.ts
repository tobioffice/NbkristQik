import { Signal } from "../../constants/index.js";
import {
  getMidMarksCard,
  getAttendanceCard,
  getBunkPlanCard,
} from "../../services/student.service.js";
import type {
  LookupReplyMarkup,
  LookupResult,
} from "../../services/student.utils/errorMessages.js";

import { bot } from "../bot.js";
import type { Message } from "node-telegram-bot-api";
import { logger } from "../../config/logger.js";
import { cardMarkup, isRollSaved, type CardMarkup } from "./cardMarkup.js";

/**
 * Where a card should appear.
 *
 * A tapped action edits the card that is already on screen. A typed roll or a
 * command sends one new card, replying to the message that asked for it.
 */
export interface CardOptions {
  /** Edit this message in place instead of sending a new card. */
  editMessageId?: number;
  /** The message a newly sent card replies to. */
  replyToMessageId?: number;
  /**
   * The reader whose registration decides the Save button. Defaults to the
   * message author, which is right for a typed roll; a callback must pass the
   * tap's user, because the card message was authored by the bot.
   */
  userId?: number;
  /** The keyboard to keep on the card. Built from the roll when omitted. */
  replyMarkup?: CardMarkup;
  /** A line to keep above the card, e.g. the O/0 correction notice. */
  notice?: string;
}

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

/** `editMessageText` rejects a second identical edit; that is not a failure. */
const isNotModified = (error: unknown): boolean =>
  /message is not modified/i.test(
    error instanceof Error ? error.message : String(error ?? ""),
  );

const displayText = (text: string, notice?: string): string =>
  notice ? `${notice}\n\n${text}` : text;

/**
 * Keep the card's own actions and append whatever the answer brought with it
 * (today: the suggested rolls of a "not found" answer).
 */
const mergeMarkup = (
  card: CardMarkup | undefined,
  extra: LookupReplyMarkup | undefined,
): CardMarkup | undefined => {
  if (!extra || extra.inline_keyboard.length === 0) return card;
  if (!card) return extra;
  return {
    inline_keyboard: [...card.inline_keyboard, ...extra.inline_keyboard],
  };
};

/**
 * Build the keyboard when the caller did not supply one. Save is hidden only
 * for the reader who already saved this exact roll.
 */
const resolveMarkup = async (
  msg: Message,
  roll: string,
  options?: CardOptions,
): Promise<CardMarkup | undefined> => {
  if (options?.replyMarkup) return options.replyMarkup;
  const userId = options?.userId ?? msg.from?.id;
  const showSave = userId ? !(await isRollSaved(userId, roll)) : false;
  return cardMarkup({
    roll,
    isPrivate: msg.chat.type === "private",
    showSave,
  });
};

/**
 * Shared flow for roll-number actions: show a placeholder, fetch the real
 * content, then turn the placeholder into the answer card. Every render keeps
 * the card's action buttons.
 */
const fetchAndEdit = async (
  msg: Message,
  placeholder: string,
  fetchContent: () => Promise<LookupResult>,
  options: CardOptions = {},
): Promise<void> => {
  const chatId = msg.chat.id;
  const replyMarkup = options.replyMarkup;
  const replyTo = options.replyToMessageId ?? msg.reply_to_message?.message_id;
  let messageId = options.editMessageId;

  try {
    const placeholderText = displayText(
      `<code>${placeholder}</code>`,
      options.notice,
    );

    if (messageId) {
      try {
        await bot.editMessageText(placeholderText, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: "HTML",
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        });
      } catch (e: unknown) {
        // A rapid second tap can arrive while the card already says this.
        if (!isNotModified(e)) throw e;
      }
    } else {
      const sent = await bot.sendMessage(chatId, placeholderText, {
        parse_mode: "HTML",
        disable_notification: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        ...(replyTo ? { reply_to_message_id: replyTo } : {}),
      });
      messageId = sent.message_id;
    }

    const content = await fetchContent();
    const markup = mergeMarkup(replyMarkup, content.markup);
    const finalText = displayText(content.text, options.notice);

    try {
      await bot.editMessageText(finalText, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "HTML",
        ...(markup ? { reply_markup: markup } : {}),
      });
    } catch (e: unknown) {
      // The placeholder is already gone from the reader's view if the edit
      // landed; a repeat tap simply has nothing new to show.
      if (isNotModified(e)) return;
      logger.warn(
        "[studentActions] edit failed, falling back to plain text:",
        (e as Error)?.message,
      );
      // Same numbers, no markup to reject. Keep the buttons: losing them
      // would strand the student on a dead card.
      try {
        await bot.editMessageText(toPlainText(finalText), {
          chat_id: chatId,
          message_id: messageId,
          ...(markup ? { reply_markup: markup } : {}),
        });
      } catch (plainError: unknown) {
        logger.warn(
          "[studentActions] plain-text edit failed, sending a new card:",
          (plainError as Error)?.message,
        );
        await bot
          .sendMessage(chatId, toPlainText(finalText), {
            disable_notification: true,
            ...(markup ? { reply_markup: markup } : {}),
            ...(replyTo ? { reply_to_message_id: replyTo } : {}),
          })
          .catch(() => {});
      }
    }
  } catch (error: unknown) {
    const err = error as Error;
    logger.error("Error in student action:", error);
    bot
      .sendMessage(
        chatId,
        err?.message || "Something broke on my side. Try again in a bit.",
      )
      .catch(() => {});
  }
};

export const sendAttendanceOrMidMarks = async (
  msg: Message,
  rollno: string,
  signal: Signal,
  options?: CardOptions,
): Promise<void> => {
  const replyMarkup = await resolveMarkup(msg, rollno, options);
  await fetchAndEdit(
    msg,
    `Getting ${signal == "att" ? "your attendance" : "your mid marks"}...`,
    () =>
      signal == "att" ? getAttendanceCard(rollno) : getMidMarksCard(rollno),
    { ...options, replyMarkup },
  );
};

export const sendBunkPlan = async (
  msg: Message,
  rollno: string,
  options?: CardOptions,
): Promise<void> => {
  const replyMarkup = await resolveMarkup(msg, rollno, options);
  await fetchAndEdit(
    msg,
    "Working out what you can bunk...",
    () => getBunkPlanCard(rollno),
    { ...options, replyMarkup },
  );
};
