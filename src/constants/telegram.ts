import { CHANNEL_ID } from "../config/environmentals.js";

/**
 * The bot's own handles, in one place.
 *
 * The username appears in deep links, in the mention normalizer and in the
 * lines that tell a student where to go; the channel username appears in the
 * check-in link and in join cards. Both are spelled out here so a rename is
 * one edit and no link is left pointing at the old name.
 */

/** The bot's Telegram username, without the @. */
export const BOT_USERNAME = "NbkristQik_bot";

/** The channel's username, without the @. Falls back to the bot. */
export const CHANNEL_USERNAME =
  (CHANNEL_ID || "").replace("@", "") || BOT_USERNAME;

/** A deep link into the bot, optionally with a /start payload. */
export const botLink = (payload?: string): string =>
  payload
    ? `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(payload)}`
    : `https://t.me/${BOT_USERNAME}`;

/** A link to the channel, or to one of its posts. */
export const channelLink = (messageId?: number | string): string =>
  messageId
    ? `https://t.me/${CHANNEL_USERNAME}/${messageId}`
    : `https://t.me/${CHANNEL_USERNAME}`;
