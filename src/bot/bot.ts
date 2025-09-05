import TelegramBot from "node-telegram-bot-api";
import { TELEGRAM_BOT_TOKEN } from "../config/environmentals.js";

const token = TELEGRAM_BOT_TOKEN || "";

export const bot = new TelegramBot(token, { polling: true });
