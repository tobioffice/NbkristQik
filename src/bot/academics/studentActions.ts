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
import type { InputRichMessage, Message } from "node-telegram-bot-api";
import { logger } from "../../config/logger.js";
import {
  cardMarkup,
  isRollSaved,
  withTextCard,
  type CardMarkup,
} from "./cardMarkup.js";
import {
  editWidgetCaption,
  editWidgetState,
  isWidgetMessage,
  sendLoadingWidget,
  widgetEnabledFor,
} from "./widgetCard.js";
import {
  widgetFits,
  type WidgetState,
} from "../../services/student.utils/widget.js";
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
  /** Use the text/rich card even when the widget is available. */
  forceText?: boolean;
  /** The widget keyboard; defaults to the normal card plus a Text card row. */
  widgetMarkup?: CardMarkup;
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

const asRich = (rich: string | InputRichMessage): InputRichMessage =>
  typeof rich === "string" ? { html: rich } : rich;

const displayRich = (
  rich: string | InputRichMessage,
  notice?: string,
): InputRichMessage => {
  const card = asRich(rich);
  return notice
    ? { ...card, html: `<p>${notice}</p>${card.html ?? ""}` }
    : card;
};

const postCard = async (
  chatId: number,
  text: string,
  markup: CardMarkup | undefined,
  replyTo: number | undefined,
): Promise<number> => {
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
  content: { text: string; rich?: string | InputRichMessage },
  markup: CardMarkup | undefined,
): Promise<void> => {
  await bot.api.editMessageText({
    chat_id: chatId,
    message_id: messageId,
    ...(content.rich
      ? { rich_message: asRich(content.rich) }
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
const fetchAndEditText = async (
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
        await editCard(
          chatId,
          messageId,
          { text: placeholderText },
          replyMarkup,
        );
      } catch (e: unknown) {
        // A rapid second tap can arrive while the card already says this.
        if (!isNotModified(e)) throw e;
      }
    } else {
      messageId = await postCard(chatId, placeholderText, replyMarkup, replyTo);
    }

    const content = await fetchContent();
    const markup = mergeMarkup(replyMarkup, content.markup);
    const finalText = displayText(content.text, options.notice);
    const rich = content.rich
      ? displayRich(content.rich, options.notice)
      : undefined;

    try {
      await editCard(chatId, messageId, { text: finalText, rich }, markup);
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
        );
      } catch (plainError: unknown) {
        logger.warn(
          "[studentActions] plain-text edit failed, sending a new card:",
          (plainError as Error)?.message,
        );
        await postCard(chatId, toPlainText(finalText), markup, replyTo).catch(
          () => {},
        );
      }
    }
  } catch (error: unknown) {
    const err = error as Error;
    logger.error("Error in student action:", error);
    bot.api
      .sendMessage({
        chat_id: chatId,
        text: err?.message || "Something broke on my side. Try again in a bit.",
      })
      .catch(() => {});
  }
};

const widgetMarkupFor = (options: CardOptions): CardMarkup | undefined =>
  options.widgetMarkup ?? options.replyMarkup;

/**
 * The widget flow: one card, a loading state, then the state the widget
 * redraws from. The text/rich card is the fallback if the widget cannot be
 * sent or updated.
 */
const fetchWidgetAndEdit = async (
  msg: Message,
  placeholder: string,
  fetchContent: () => Promise<LookupResult>,
  options: CardOptions = {},
): Promise<void> => {
  const chatId = msg.chat.id;
  const replyTo = options.replyToMessageId ?? msg.reply_to_message?.message_id;
  const markup = widgetMarkupFor(options);
  let messageId = options.editMessageId;

  try {
    const loading: WidgetState = { v: 1, loading: placeholder };
    if (messageId) {
      await editWidgetState(chatId, messageId, loading);
    } else {
      const sent = await sendLoadingWidget({
        chatId,
        state: loading,
        caption: placeholder,
        markup,
        replyTo,
      });
      messageId = sent.message_id;
    }

    const content = await fetchContent();
    const note = options.notice ? toPlainText(options.notice) : undefined;

    if (content.widget) {
      const state = note
        ? { ...content.widget.state, note }
        : content.widget.state;

      if (widgetFits(state)) {
        await editWidgetState(chatId, messageId, state);
        await editWidgetCaption(chatId, messageId, content.widget.caption);

        if (content.markup) {
          const merged = mergeMarkup(markup, content.markup);
          if (merged) {
            await bot.api
              .editMessageReplyMarkup({
                chat_id: chatId,
                message_id: messageId,
                reply_markup: merged,
              })
              .catch(() => undefined);
          }
        }
        return;
      }

      await editWidgetState(chatId, messageId, {
        v: 1,
        error: "This card is too long for the widget. Tap Text card.",
      });
      await editWidgetCaption(
        chatId,
        messageId,
        "The full card is available as text.",
      );
      return;
    }

    // A successful card without widget state means its table outgrew the
    // 1024-byte chat state. Point at the text card instead of dumping the
    // whole card into the error slot. A text-only lookup is a real error.
    const tooLarge = Boolean(content.rich);
    const plain = tooLarge
      ? "This card is too long for the widget. Tap Text card."
      : toPlainText(displayText(content.text, options.notice));
    await editWidgetState(chatId, messageId, { v: 1, error: plain });
    await editWidgetCaption(
      chatId,
      messageId,
      tooLarge ? "The full card is available as text." : plain,
    );

    if (content.markup) {
      const merged = mergeMarkup(markup, content.markup);
      if (merged) {
        await bot.api
          .editMessageReplyMarkup({
            chat_id: chatId,
            message_id: messageId,
            reply_markup: merged,
          })
          .catch(() => undefined);
      }
    }
  } catch (e: unknown) {
    logger.warn(
      "[studentActions] widget card failed, falling back to text:",
      (e as Error)?.message,
    );
    // The widget may already be on screen. Send the text card as a new
    // message rather than trying to turn a widget into text.
    await fetchAndEditText(msg, placeholder, fetchContent, {
      ...options,
      forceText: true,
      editMessageId: undefined,
      replyToMessageId: options.editMessageId ? msg.message_id : replyTo,
    });
  }
};

/**
 * Pick the card surface once: a widget in a private chat when it is enabled
 * (or when the tapped message already is one), otherwise the text/rich card.
 */
const fetchAndEdit = async (
  msg: Message,
  placeholder: string,
  fetchContent: () => Promise<LookupResult>,
  options: CardOptions = {},
): Promise<void> => {
  const userId = options.userId ?? msg.from?.id;
  const useWidget =
    !options.forceText &&
    msg.chat.type === "private" &&
    (isWidgetMessage(msg) || widgetEnabledFor(userId));

  if (useWidget) {
    return fetchWidgetAndEdit(msg, placeholder, fetchContent, options);
  }
  return fetchAndEditText(msg, placeholder, fetchContent, options);
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
  const widgetMarkup = replyMarkup
    ? withTextCard(replyMarkup, rollno)
    : undefined;
  await fetchAndEdit(
    msg,
    `Getting ${signal == "att" ? "your attendance" : "your mid marks"}...`,
    () =>
      signal == "att" ? getAttendanceCard(rollno) : getMidMarksCard(rollno),
    { ...options, replyMarkup, widgetMarkup },
  );
};

export const sendBunkPlan = async (
  msg: Message,
  rollno: string,
  options?: CardOptions,
): Promise<void> => {
  if (await refusePrivateRoll(msg, rollno, options)) return;
  const replyMarkup = await resolveMarkup(msg, rollno, options);
  const widgetMarkup = replyMarkup
    ? withTextCard(replyMarkup, rollno)
    : undefined;
  await fetchAndEdit(
    msg,
    "Working out what you can bunk...",
    () => getBunkPlanCard(rollno),
    { ...options, replyMarkup, widgetMarkup },
  );
};
