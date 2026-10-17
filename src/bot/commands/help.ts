import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";

bot.onText(/\/help/, (msg) => {
  trackMessage(msg, "command:help");
  const helpMessage =
    `Send me a roll number like <code>23KB1A0599</code> and I'll show your attendance and mid marks. That's the whole flow.\n` +
    `\n` +
    `In a hurry? /register saves your roll once, then /attendance, /midmarks and /bunk answer in one tap.\n` +
    `\n` +
    `Something broken? /report it to me with a few words. I reply to every report, and My reports on the report page keeps the whole conversation.`;

  bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: "HTML" });
});
