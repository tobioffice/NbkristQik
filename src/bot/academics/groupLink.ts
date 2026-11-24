import type { InlineKeyboardMarkup, Message } from "node-telegram-bot-api";
import { bot } from "../bot.js";
import type { DeepLinkSignal } from "../commands/startPayload.js";
import { botLink } from "../../constants/telegram.js";
import { logger } from "../../config/logger.js";
import {
  forgetGroupPrompt,
  rememberGroupPrompt,
  type GroupPrompt,
} from "./groupPrompt.js";

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
 * How long the room keeps the prompt when the student never taps it. Long
 * enough to read the line and act, short enough that an ignored prompt does
 * not sit in the chat forever.
 */
export const GROUP_PROMPT_LIFETIME_MS = 2 * 60 * 1000;

/**
 * Delete a prompt and the roll message it answered.
 *
 * Deleting a member's message needs the bot to be an admin with delete
 * rights, so a refusal is expected noise. Deliberately not awaited: a slow
 * delete must never hold a reply back.
 */
export const clearGroupPrompt = (prompt: GroupPrompt): void => {
  for (const messageId of [prompt.messageId, prompt.sourceMessageId]) {
    void bot.api
      .deleteMessage({ chat_id: prompt.chatId, message_id: messageId })
      .catch((e: unknown) => {
        logger.debug(
          "[groupLink] group message could not be deleted:",
          e instanceof Error ? e.message : e,
        );
      });
  }
};

/** Sweep the prompt and its roll message when no tap ever comes. */
const schedulePromptCleanup = (
  userId: number,
  rollNumber: string,
  prompt: GroupPrompt,
): void => {
  const timer = setTimeout(() => {
    const parked = forgetGroupPrompt(userId, rollNumber, prompt.messageId);
    if (parked) clearGroupPrompt(parked);
  }, GROUP_PROMPT_LIFETIME_MS);
  // A pending sweep must not keep a short-lived process alive.
  timer.unref?.();
};

/**
 * A public group prompt. It exists only to carry the student into the bot, so
 * it is parked under user + roll, cleared when the private `/start` lands, and
 * swept up on a timer when the student never taps.
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
    const parked: GroupPrompt = {
      chatId: msg.chat.id,
      messageId: sent.message_id,
      sourceMessageId: msg.message_id,
    };
    rememberGroupPrompt(msg.from.id, rollNumber, parked);
    schedulePromptCleanup(msg.from.id, rollNumber, parked);
  }
};
