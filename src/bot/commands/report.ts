import { bot } from "../bot.js";

bot.onText(/\/report$/, (msg) => {
   bot.sendMessage(
      msg.chat.id,
      "⚠️ Please include your report message after /report\nExample: /report I found a bug here"
   );
});

bot.onText(/\/report (.+)/, (msg, match) => {
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
   bot.sendMessage(process.env.ADMIN_ID || "1329532701", formattedMessage, {
      parse_mode: "HTML",
   }).catch((err) => console.error("Error forwarding report:", err));

   // Confirm to the user
   bot.sendMessage(
      msg.chat.id,
      "✅ Thank you! Your report has been sent to the admin.",
      { parse_mode: "HTML" }
   );
});
