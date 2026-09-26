import { bot } from "../bot.js";
import { ADMIN_ID } from "../../config/environmentals.js";
import { logger } from "../../config/logger.js";

// Telegram HTML parse_mode: these three must be escaped in user content
const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

bot.onText(/\/report$/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "⚠️ <b>Oops! You missed the message.</b>\n\nPlease use the command like this:\n<code>/report [your message]</code>\n\nExample:\n<code>/report I found a bug!</code>",
    { parse_mode: "HTML" },
  );
});

bot.onText(/\/report (.+)/, (msg, match) => {
  const reportMessage = match ? match[1] : "No message provided";
  const reporterName = msg.from?.id
    ? `<a href="tg://user?id=${msg.from.id}">${escapeHtml(
        msg.from.first_name || `U-K`,
      )} </a>`
    : escapeHtml(msg.from?.username || msg.from?.first_name || "Unknown user");
  const formattedMessage =
    `📢 <b>New Report Received</b>\n\n` +
    `👤 <b>Sender:</b> ${reporterName}\n` +
    `🆔 <b>User ID:</b> <code>${msg.from?.id}</code>\n\n` +
    `📝 <b>Report:</b>\n<i>${escapeHtml(reportMessage)}</i>`;

  if (!ADMIN_ID) {
    logger.warn(
      "[report] ADMIN_ID not set — dropping report:",
      reportMessage.slice(0, 100),
    );
    return;
  }

  // Forward to personal chat
  bot
    .sendMessage(ADMIN_ID, formattedMessage, {
      parse_mode: "HTML",
    })
    .catch((err) => logger.error("Error forwarding report:", err));

  // Confirm to the user
  bot.sendMessage(
    msg.chat.id,
    "✅ <b>Thanks for reporting!</b>\n\nI've sent your message to the admin. We'll check it out soon!",
    { parse_mode: "HTML" },
  );
});
