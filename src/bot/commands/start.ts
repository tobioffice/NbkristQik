import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";

bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
  trackMessage(msg, "command:start");

  if (match?.[1] === "unlocked") {
    bot.sendMessage(
      msg.chat.id,
      `✅ <b>You're unlocked for today.</b>\n\nSend your roll number and I'll pull up your stats.`,
      { parse_mode: "HTML" },
    );
    return;
  }

  const message = `
👋 <b>Welcome to NbkristQik</b>

Send your roll number, like <code>23KB1A0599</code>, and I'll pull up your attendance and mid-term marks straight from the college portal.

⚡ In a hurry? /register saves your roll, then /attendance works in one tap.

<i>New here? /help explains everything.</i>`;

  bot.sendMessage(msg.chat.id, message, { parse_mode: "HTML" });
});
