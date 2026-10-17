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
      { command: "register", description: "Save your roll number" },
      { command: "report", description: "Tell me something's broken" },
      { command: "help", description: "How this works" },
      { command: "leaderboard", description: "View the leaderboard" },
    ])
    .catch((e) => logger.warn("[bot] setMyCommands failed:", e?.message ?? e));
}
