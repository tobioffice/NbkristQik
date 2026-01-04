import { bot } from "../bot.js";

bot.onText(/\/start/, (msg) => {
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
