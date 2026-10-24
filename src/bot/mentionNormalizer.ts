import type { Message } from "node-telegram-bot-api";

/** The bot's Telegram username, without the @. */
export const BOT_USERNAME = "NbkristQik_bot";

/**
 * In groups Telegram appends the bot username to typed commands
 * (/report@NbkristQik_bot), and anchored command regexes never match
 * that form. Readdress commands aimed at US to their bare form so the
 * onText handlers see one shape everywhere; commands addressed to
 * another bot are left alone and therefore ignored, as Telegram intends.
 */
export const stripOwnMention = (msg: Message): void => {
  if (typeof msg.text === "string" && msg.text.startsWith("/")) {
    msg.text = msg.text.replace(
      new RegExp(`^/([^@\\s]+)@${BOT_USERNAME}(?=\\s|$)`, "i"),
      "/$1",
    );
  }
};
