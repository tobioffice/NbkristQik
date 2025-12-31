import { bot } from "../bot.js";

bot.onText(/\/start/, (msg) => {
   const message = `🎓 Welcome! I can help you check your:
    • Attendance records
    • Mid-term marks
    
    Simply send your roll number to get started.`;
   bot.sendMessage(msg.chat.id, message, { parse_mode: "HTML" });
});
