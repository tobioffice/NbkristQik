import { bot } from "../bot.js";

bot.onText(/\/help/, (msg) => {
   const helpMessage = `<b>How to use NbkristQik:</b>

1️⃣ <b>Send your Roll Number</b>
   (Example: <code>23KB1A0599</code>)

2️⃣ <b>Get Instant Results</b>
   • Attendance 📊
   • Mid-Marks 📝

<i>That's it! No complex commands needed.</i>`;

   bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: "HTML" });
});
