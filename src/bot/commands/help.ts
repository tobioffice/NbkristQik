import { bot } from "../bot.js";
import { trackMessage } from "../../services/tracker.js";

bot.onText(/\/help/, (msg) => {
  trackMessage(msg, "command:help");
  const helpMessage = `<b>How NbkristQik works</b>

Send your roll number, like <code>23KB1A0599</code>, and I'll show your attendance and mid-term marks. That's the whole flow.

<b>In a hurry?</b> /register saves your roll once, then /attendance, /midmarks and /bunk work in one tap.

Spotted a problem? /report files it with a trackable issue id.`;

  bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: "HTML" });
});
