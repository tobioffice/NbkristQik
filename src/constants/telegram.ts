import { CHANNEL_ID } from "../config/environmentals.js";
import { BOT_USERNAME } from "./bot.js";

export { BOT_USERNAME } from "./bot.js";

/**
 * The bot's own handles, in one place.
 *
 * The username appears in deep links, in the mention normalizer and in the
 * lines that tell a student where to go; the channel username appears in the
 * join cards. Both are spelled out here so a rename is one edit and no link is
 * left pointing at the old name.
 */

/** The channel's username, without the @. Falls back to the bot. */
export const CHANNEL_USERNAME =
  (CHANNEL_ID || "").replace("@", "") || BOT_USERNAME;

/** A deep link into the bot, optionally with a /start payload. */
export const botLink = (payload?: string): string =>
  payload
    ? `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(payload)}`
    : `https://t.me/${BOT_USERNAME}`;
