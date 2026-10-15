import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";

/** Escape user-controlled text for Telegram HTML parse mode. */
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

bot.onText(/\/start/, (msg) => {
  trackMessage(msg, "command:start");

  const first = msg.from?.first_name?.trim();
  const greeting = first
    ? `Hi ${esc(first)} — welcome to <b>NbkristQik</b>`
    : `Welcome to <b>NbkristQik</b>`;

  const message =
    `${greeting}, the NBKRIST attendance register on Telegram.\n` +
    `\n` +
    `Send your roll number like <code>23KB1A0599</code> and I'll pull up your attendance and mid-term marks straight from the college portal.\n` +
    `\n` +
    `Save it once with /register and /attendance answers in one tap. /help explains everything.`;

  bot.sendMessage(msg.chat.id, message, { parse_mode: "HTML" });
});
