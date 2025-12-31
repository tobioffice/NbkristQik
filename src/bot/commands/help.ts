import { bot } from "../bot.js";

bot.onText(/\/help/, (msg) => {
   const helpMessage = `ℹ️ To check your attendance or mid-term marks:
    
Simply send your roll number (e.g., <code>23KB1A0599</code>) in the chat.

The system will automatically show your:
• Attendance records
• Mid-term marks`;

   bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: "HTML" });
});
