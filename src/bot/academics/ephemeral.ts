import type { InlineKeyboardMarkup, Message } from "node-telegram-bot-api";
import { bot } from "../bot.js";

/**
 * An answer only one member of a group may see.
 *
 * Telegram delivers an ephemeral message to the client that asked for it and
 * to nobody else. The bot can only answer an ephemeral command within 15
 * seconds of the command, so the card flow sends its placeholder immediately
 * and edits it once the portal answers.
 */
export interface EphemeralTarget {
  /** The one member who sees every message in this exchange. */
  receiverUserId: number;
  /** The incoming ephemeral command this answer replies to. */
  replyToEphemeralId?: number;
  /** The callback that asked for a new message, when the card is being tapped. */
  callbackQueryId?: string;
}

/** The ephemeral target of a command, or null for an ordinary message. */
export const ephemeralCommand = (msg: Message): EphemeralTarget | null =>
  msg.ephemeral_message_id && msg.from
    ? {
        receiverUserId: msg.from.id,
        replyToEphemeralId: msg.ephemeral_message_id,
      }
    : null;

/** The ephemeral card a callback was tapped on, or null for a normal card. */
export const ephemeralCallback = (
  ephemeralMessageId: number | undefined,
  userId: number,
  callbackQueryId: string,
): EphemeralTarget | null =>
  ephemeralMessageId ? { receiverUserId: userId, callbackQueryId } : null;

/**
 * The ephemeral message a command answers, or null when Telegram gave the
 * card no id back (the caller then has no surface left to edit).
 */
export const sendEphemeral = async (
  chatId: number,
  target: EphemeralTarget,
  text: string,
  markup?: InlineKeyboardMarkup,
): Promise<number | null> => {
  if (target.callbackQueryId) {
    // A tap on an ephemeral card: a new private bubble in the same group.
    // The card itself is edited in place by the caller, so this is only for
    // answers that are not the card (an error, a refusal, the register).
    const message = await bot.api.sendMessage({
      text,
      parse_mode: "HTML",
      ...(markup ? { reply_markup: markup } : {}),
      ephemeral_message_parameters: {
        callback_query_id: target.callbackQueryId,
      },
    });
    return message.ephemeral_message_id ?? null;
  }

  if (!target.replyToEphemeralId) return null;

  const message = await bot.api.sendMessage({
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...(markup ? { reply_markup: markup } : {}),
    reply_parameters: { ephemeral_message_id: target.replyToEphemeralId },
    ephemeral_message_parameters: {
      receiver_user_id: target.receiverUserId,
    },
  });
  return message.ephemeral_message_id ?? null;
};

/** Replace the text and buttons of an ephemeral card. */
export const editEphemeral = async (
  chatId: number,
  target: EphemeralTarget,
  ephemeralMessageId: number,
  content: { text: string } | { rich: string },
  markup?: InlineKeyboardMarkup,
): Promise<void> => {
  await bot.api.editEphemeralMessageText({
    chat_id: chatId,
    receiver_user_id: target.receiverUserId,
    ephemeral_message_id: ephemeralMessageId,
    ...("rich" in content
      ? { rich_message: { html: content.rich } }
      : { text: content.text, parse_mode: "HTML" }),
    ...(markup ? { reply_markup: markup } : {}),
  });
};

/** Replace only the buttons of an ephemeral card, keeping its text. */
export const editEphemeralMarkup = async (
  chatId: number,
  target: EphemeralTarget,
  ephemeralMessageId: number,
  markup: InlineKeyboardMarkup,
): Promise<void> => {
  await bot.api.editEphemeralMessageReplyMarkup({
    chat_id: chatId,
    receiver_user_id: target.receiverUserId,
    ephemeral_message_id: ephemeralMessageId,
    reply_markup: markup,
  });
};
