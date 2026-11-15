import type { InlineKeyboardMarkup, Message } from "node-telegram-bot-api";
import { bot } from "../bot.js";

/**
 * A private answer inside a group.
 *
 * Telegram delivers an ephemeral message to the client that asked for it and
 * to nobody else. The bot answers an ephemeral command within 15 seconds of
 * the command, so every prompt that uses this must send immediately.
 */
export interface EphemeralTarget {
  /** The one member who sees the message. */
  receiverUserId: number;
  /** The incoming ephemeral command this answer replies to. */
  replyToEphemeralId: number;
}

/** The ephemeral target of a command, or null for an ordinary message. */
export const ephemeralCommand = (msg: Message): EphemeralTarget | null =>
  msg.ephemeral_message_id && msg.from
    ? {
        receiverUserId: msg.from.id,
        replyToEphemeralId: msg.ephemeral_message_id,
      }
    : null;

/**
 * Send a private message to the member who sent the ephemeral command.
 *
 * Only used for the "open this in the bot" prompt and the short registration
 * hints. The card itself is never rendered in the group.
 */
export const sendEphemeral = async (
  chatId: number,
  target: EphemeralTarget,
  text: string,
  markup?: InlineKeyboardMarkup,
): Promise<void> => {
  await bot.api.sendMessage({
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...(markup ? { reply_markup: markup } : {}),
    reply_parameters: { ephemeral_message_id: target.replyToEphemeralId },
    ephemeral_message_parameters: {
      receiver_user_id: target.receiverUserId,
    },
  });
};
