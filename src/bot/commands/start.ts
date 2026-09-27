import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";

bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
  trackMessage(msg, "command:start");

  if (match?.[1] === "unlocked") {
    bot.sendMessage(
      msg.chat.id,
      `✅ <b>You're unlocked for today!</b>\n\n🆔 Just send me your <b>Roll Number</b> and I'll fetch your attendance & mid marks.`,
      { parse_mode: "HTML" },
    );
    return;
  }

  const message = `
👋 <b>Hey there! Welcome to NbkristQik!</b>

I can help you check your college stats instantly.

🆔 <b>Just send me your Roll Number</b>
(e.g., <code>21B81A0501</code>)

I'll fetch your:
📊 <b>Attendance</b>
📝 <b>Mid-Term Marks</b>

<i>Tap /help if you're stuck!</i>`;

  bot.sendMessage(msg.chat.id, message, { parse_mode: "HTML" });
});
