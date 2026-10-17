import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";

/** Escape user-controlled text for Telegram HTML parse mode. */
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

bot.onText(/\/start/, (msg) => {
  trackMessage(msg, "command:start");

  const first = msg.from?.first_name?.trim();
  const greeting = first ? `Hi ${esc(first)}, welcome in` : `Welcome in`;

  const message =
    `${greeting}. I keep the NBKRIST attendance register here.\n` +
    `\n` +
    `Send me a roll number like <code>23KB1A0599</code> and I'll pull your attendance and mid marks from the college portal.\n` +
    `\n` +
    `Save yours once with /register and /attendance answers in one tap. /help covers the rest.`;

  bot.sendMessage(msg.chat.id, message, { parse_mode: "HTML" });
});
