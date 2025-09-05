import TelegramBot from "node-telegram-bot-api";
import { TELEGRAM_BOT_TOKEN } from "../config/environmentals.js";
import { setupBot } from "./setup.js";

const token = TELEGRAM_BOT_TOKEN || "";

export const bot = new TelegramBot(token, { polling: true });

// Import commands
import "./commands/help";
import "./commands/start";
import "./commands/report";

// Setup bot commands
setupBot(bot);

// Import features
import "./features/bot.academic";
