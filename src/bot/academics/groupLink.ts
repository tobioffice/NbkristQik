import type { Message } from "node-telegram-bot-api";
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

/**
 * A group is a shared room, so it gets the way into the bot and nothing else.
 * The roll rides in the button's deep link, not in the visible text; the card
 * itself waits in private.
 */
export const sendPrivateCardLink = async (
  msg: Message,
  rollNumber: string,
  signal: DeepLinkSignal = "att",
): Promise<void> => {
  const copy = COPY[signal];
  const prompt = await bot.api.sendMessage({
    chat_id: msg.chat.id,
    text: copy.line,
    reply_parameters: { message_id: msg.message_id },
    reply_markup: {
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
  });

  // the prompt exists only to carry the student into the bot; park it and
  // the roll it answers so the private `/start` can clear both from the room
  if (msg.from && typeof prompt?.message_id === "number") {
    rememberGroupPrompt(msg.from.id, rollNumber, {
      chatId: msg.chat.id,
      messageId: prompt.message_id,
      sourceMessageId: msg.message_id,
    });
  }
};
