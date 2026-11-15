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
import {
  editEphemeral,
  sendEphemeral,
  type EphemeralTarget,
} from "./ephemeral.js";
import { isLookupBlockedForViewer } from "../../services/verification/otp.js";

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
  /**
   * Answer inside a group with a message only this student can see. Set by
   * the group command and by every button on the card it produced.
   */
  ephemeral?: EphemeralTarget;
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
    showSave,
    isPrivate: msg.chat.type === "private",
  });
};

const displayRich = (rich: string, notice?: string): string =>
  notice ? `<p>${notice}</p>${rich}` : rich;

/**
 * Where the card lives: an ordinary chat message, or an ephemeral message
 * that only the student can see. These two writes are the only places the
 * difference shows.
 */
const postCard = async (
  chatId: number,
  text: string,
  markup: CardMarkup | undefined,
  replyTo: number | undefined,
  ephemeral: EphemeralTarget | undefined,
): Promise<number> => {
  if (ephemeral) {
    const id = await sendEphemeral(chatId, ephemeral, text, markup);
    if (id === null) {
      throw new Error("Telegram returned no ephemeral message id");
    }
    return id;
  }

  const sent = await bot.api.sendMessage({
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_notification: true,
    ...(markup ? { reply_markup: markup } : {}),
    ...(replyTo ? { reply_parameters: { message_id: replyTo } } : {}),
  });
  return sent.message_id;
};

const editCard = async (
  chatId: number,
  messageId: number,
  content: { text: string; rich?: string },
  markup: CardMarkup | undefined,
  ephemeral: EphemeralTarget | undefined,
): Promise<void> => {
  if (ephemeral) {
    await editEphemeral(
      chatId,
      ephemeral,
      messageId,
      content.rich ? { rich: content.rich } : { text: content.text },
      markup,
    );
    return;
  }

  await bot.api.editMessageText({
    chat_id: chatId,
    message_id: messageId,
    ...(content.rich
      ? { rich_message: { html: content.rich } }
      : { text: content.text, parse_mode: "HTML" }),
    ...(markup ? { reply_markup: markup } : {}),
  });
};

/**
 * Shared flow for roll-number actions: show a placeholder, fetch the real
 * content, then turn the placeholder into the answer card. Every render keeps
 * the card's action buttons.
 *
 * A rich card is tried first. If the client refuses it, the same numbers go
 * out as HTML, then as plain text, so a card never dies on a formatting
 * rejection.
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
  const ephemeral = options.ephemeral;
  let messageId = options.editMessageId;

  try {
    const placeholderText = displayText(
      `<code>${placeholder}</code>`,
      options.notice,
    );

    if (messageId) {
      try {
        await editCard(
          chatId,
          messageId,
          { text: placeholderText },
          replyMarkup,
          ephemeral,
        );
      } catch (e: unknown) {
        // A rapid second tap can arrive while the card already says this.
        if (!isNotModified(e)) throw e;
      }
    } else {
      messageId = await postCard(
        chatId,
        placeholderText,
        replyMarkup,
        replyTo,
        ephemeral,
      );
    }

    const content = await fetchContent();
    const markup = mergeMarkup(replyMarkup, content.markup);
    const finalText = displayText(content.text, options.notice);
    const rich = content.rich
      ? displayRich(content.rich, options.notice)
      : undefined;

    try {
      await editCard(
        chatId,
        messageId,
        { text: finalText, rich },
        markup,
        ephemeral,
      );
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
        await editCard(
          chatId,
          messageId,
          { text: toPlainText(finalText) },
          markup,
          ephemeral,
        );
      } catch (plainError: unknown) {
        logger.warn(
          "[studentActions] plain-text edit failed, sending a new card:",
          (plainError as Error)?.message,
        );
        await postCard(
          chatId,
          toPlainText(finalText),
          markup,
          replyTo,
          ephemeral,
        ).catch(() => {});
      }
    }
  } catch (error: unknown) {
    const err = error as Error;
    logger.error("Error in student action:", error);
    const text =
      err?.message || "Something broke on my side. Try again in a bit.";
    if (ephemeral) {
      await sendEphemeral(chatId, ephemeral, text).catch(() => {});
    } else {
      bot.api.sendMessage({ chat_id: chatId, text }).catch(() => {});
    }
  }
};

/**
 * A verified owner can hide the roll. Anyone else asking for it gets one
 * plain sentence, never a card: the refusal must not reveal whether the roll
 * exists or who owns it.
 */
const ROLL_IS_PRIVATE =
  "That roll's data is private. Only its owner can check it.";

const refusePrivateRoll = async (
  msg: Message,
  rollno: string,
  options?: CardOptions,
): Promise<boolean> => {
  const viewer = options?.userId ?? msg.from?.id;
  if (!(await isLookupBlockedForViewer(rollno, viewer))) return false;
  if (options?.ephemeral) {
    await sendEphemeral(msg.chat.id, options.ephemeral, ROLL_IS_PRIVATE).catch(
      () => {},
    );
    return true;
  }
  await bot.api
    .sendMessage({
      chat_id: msg.chat.id,
      text: ROLL_IS_PRIVATE,
      reply_parameters: { message_id: msg.message_id },
    })
    .catch(() => {});
  return true;
};

export const sendAttendanceOrMidMarks = async (
  msg: Message,
  rollno: string,
  signal: Signal,
  options?: CardOptions,
): Promise<void> => {
  if (await refusePrivateRoll(msg, rollno, options)) return;
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
  if (await refusePrivateRoll(msg, rollno, options)) return;
  const replyMarkup = await resolveMarkup(msg, rollno, options);
  await fetchAndEdit(
    msg,
    "Working out what you can bunk...",
    () => getBunkPlanCard(rollno),
    { ...options, replyMarkup },
  );
};
