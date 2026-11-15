import type { InlineKeyboardMarkup, Message } from "node-telegram-bot-api";
import { bot } from "../bot.js";
import type { DeepLinkSignal } from "../commands/startPayload.js";
import { botLink } from "../../constants/telegram.js";
import { rememberGroupPrompt } from "./groupPrompt.js";

const COPY: Record<DeepLinkSignal, { line: string; button: string }> = {
  att: {
    line: "Your attendance is private. Tap to open it in the bot.",
    button: "Open attendance",
  },
  mid: {
    line: "Your mid marks are private. Tap to open it in the bot.",
    button: "Open mid marks",
  },
  bunk: {
    line: "Your bunk plan is private. Tap to open it in the bot.",
    button: "Open bunk plan",
  },
};

export interface PrivateCardPrompt {
  text: string;
  markup: InlineKeyboardMarkup;
}

/**
 * The one line a group gets for a personal lookup: where to go, never what
 * the roll says. The roll travels in the button's deep link; the card itself
 * waits in the bot.
 */
export const privateCardPrompt = (
  rollNumber: string,
  signal: DeepLinkSignal = "att",
): PrivateCardPrompt => {
  const copy = COPY[signal];
  return {
    text: copy.line,
    markup: {
      inline_keyboard: [
        [
          {
            text: copy.button,
            url: botLink(`${signal}_${rollNumber}`),
            style: "primary",
          },
        ],
      ],
    },
  };
};

/**
 * A public group prompt. It exists only to carry the student into the bot, so
 * it is parked under user + roll and cleared when the private `/start` lands.
 */
export const sendPrivateCardLink = async (
  msg: Message,
  rollNumber: string,
  signal: DeepLinkSignal = "att",
): Promise<void> => {
  const prompt = privateCardPrompt(rollNumber, signal);
  const sent = await bot.api.sendMessage({
    chat_id: msg.chat.id,
    text: prompt.text,
    reply_parameters: { message_id: msg.message_id },
    reply_markup: prompt.markup,
  });

  if (msg.from && typeof sent?.message_id === "number") {
    rememberGroupPrompt(msg.from.id, rollNumber, {
      chatId: msg.chat.id,
      messageId: sent.message_id,
      sourceMessageId: msg.message_id,
    });
  }
};
