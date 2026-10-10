import TelegramBot from "node-telegram-bot-api";
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
export const bot = new TelegramBot(token || "test-token", { polling: false });

bot.on("polling_error", (error) => {
  logger.warn("[bot] polling error:", error?.message ?? error);
});
