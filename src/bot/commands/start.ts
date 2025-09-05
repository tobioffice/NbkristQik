import { bot } from "../index.js";

bot.onText(/\/start/, (msg) => {
  try {
    const message = `🎓 Welcome! I can help you check your:
    • Attendance records
    • Mid-term marks
    
    Simply send your roll number to get started.`;
    bot.sendMessage(msg.chat.id, message, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Error in /start command:", error);
    bot.sendMessage(
      msg.chat.id,
      "An error occurred while processing your request. Please try again later.",
    );
    return;
  }
});
