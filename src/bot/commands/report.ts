import { bot } from "../bot.js";

bot.onText(/\/report$/, (msg) => {
  try {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Please include your report message after /report\nExample: /report I found a bug here",
    );
  } catch (error) {
    console.error("Error in /report command:", error);
    bot.sendMessage(
      msg.chat.id,
      "❌ An error occurred. Please try again later.",
    );
  }
});

bot.onText(/\/report (.+)/, (msg, match) => {
  try {
    const reportMessage = match ? match[1] : "No message provided";
    const reporterName = msg.from?.id
      ? `<a href="tg://user?id=${msg.from.id}">${
          msg.from.first_name || `U-K`
        } </a>`
      : msg.from?.username || msg.from?.first_name || "Unknown user";
    const formattedMessage =
      `📝 <b>New Report</b>\n\n` +
      `👤 <b>From:</b> ${reporterName}\n` +
      `💬 <b>Message:</b>\n${reportMessage}`;

    // Forward to personal chat
    bot
      .sendMessage(process.env.ADMIN_ID || "1329532701", formattedMessage, {
        parse_mode: "HTML",
      })
      .catch((err) => console.error("Error forwarding report:", err));

    // Confirm to the user
    bot.sendMessage(
      msg.chat.id,
      "✅ Thank you! Your report has been sent to the admin.",
      { parse_mode: "HTML" },
    );
  } catch (error) {
    console.error("Error in /report command:", error);
    bot.sendMessage(
      msg.chat.id,
      "❌ An error occurred while sending your report. Please try again later.",
    );
  }
});
