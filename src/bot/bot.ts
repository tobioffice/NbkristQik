import TelegramBot from "node-telegram-bot-api";
import { TELEGRAM_BOT_TOKEN } from "../config/environmentals.js";
import { logger } from "../config/logger.js";

const token = TELEGRAM_BOT_TOKEN || "";

export const bot = new TelegramBot(token, { polling: true });

bot.on("polling_error", (error) => {
  logger.warn("[bot] polling error:", error?.message ?? error);
});
