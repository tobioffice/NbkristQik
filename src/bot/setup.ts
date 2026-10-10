import TelegramBot from "node-telegram-bot-api";
import { logger } from "../config/logger.js";

// Telegram expects command names WITHOUT the leading slash.
export function setupBot(bot: TelegramBot): void {
  bot
    .setMyCommands([
      { command: "start", description: "Start the bot" },
      { command: "attendance", description: "Check your attendance" },
      { command: "midmarks", description: "Check your mid-term marks" },
      { command: "bunk", description: "See your bunk plan" },
      { command: "register", description: "Set your roll for instant lookups" },
      { command: "report", description: "Report an issue" },
      { command: "help", description: "Get help" },
      { command: "leaderboard", description: "View the leaderboard" },
    ])
    .catch((e) => logger.warn("[bot] setMyCommands failed:", e?.message ?? e));
}
