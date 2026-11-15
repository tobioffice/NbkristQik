import { Bot } from "node-telegram-bot-api";
import { TELEGRAM_BOT_TOKEN } from "../config/environmentals.js";
import { logger } from "../config/logger.js";

const token = TELEGRAM_BOT_TOKEN;

if (!token) {
  if (process.env.NODE_ENV === "test") {
    logger.error("[config] TELEGRAM_BOT_TOKEN is required");
  } else {
    logger.error("[config] TELEGRAM_BOT_TOKEN is required — exiting");
    process.exit(1);
  }
}

// Start polling only after all handlers are registered (bot/index.ts).
export const bot = new Bot(token || "test-token");

// The library's default boundary is console.error. Keep update failures on the
// project logger, and log the id only: a stack trace can carry a request URL
// with the bot token.
bot.catch((error, ctx) => {
  logger.error(
    `[bot] update ${ctx.update.update_id} failed:`,
    error instanceof Error ? error.message : error,
  );
});
