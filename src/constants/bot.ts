/**
 * The bot's Telegram handle, without the @.
 *
 * Kept apart from `telegram.ts` because the app constants need the username
 * but not the channel configuration. A module that only builds links must not
 * pull in the environment just to spell the bot's name.
 */
export const BOT_USERNAME = "NbkristQik_bot";
