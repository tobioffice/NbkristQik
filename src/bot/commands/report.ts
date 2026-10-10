import { bot } from "../bot.js";
import {
  createAndAnnounce,
  tooSoonToReport,
} from "../../services/reportService.js";
import { trackMessage } from "../../services/tracker.js";
import { REPORT_WEBAPP_URL } from "../../constants/webapp.js";
import { CHIT_CHAT_ID } from "../../constants/index.js";
import { logger } from "../../config/logger.js";

// /report now lives on the web: easy typing, an issue id, and replies that
// reach the reporter here in Telegram. A bare /report opens the form;
// "/report <message>" still works and files a tracked report with an id.

bot.onText(/\/report$/, (msg) => {
  trackMessage(msg, "command:report");
  bot.sendMessage(
    msg.chat.id,
    `🐞 <b>Report an issue</b>\n\n` +
      `Open the form and describe what went wrong. You'll get an issue id like <code>QIK-0012</code>, and I'll reply here in chat.`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🐞 Report an issue", web_app: { url: REPORT_WEBAPP_URL } }],
        ],
      },
    },
  );
});

bot.onText(/\/report ([\s\S]+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const from = msg.from;
  const text = match?.[1]?.trim();
  if (!from || !text) return;

  if (chatId === CHIT_CHAT_ID) {
    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    return;
  }

  trackMessage(msg, "command:report", text.slice(0, 100));

  if (text.length < 10 || text.length > 1000) {
    bot.sendMessage(
      chatId,
      "Give me a bit more detail so I can help: between 10 and 1000 characters.",
    );
    return;
  }

  if (await tooSoonToReport(from.id)) {
    bot.sendMessage(chatId, "One report at a time. Try again in a minute.");
    return;
  }

  try {
    const { issueId } = await createAndAnnounce({
      userId: from.id,
      username: from.username ?? null,
      firstName: from.first_name ?? null,
      chatType: msg.chat.type as "private" | "group" | "supergroup" | "channel",
      message: text,
    });
    // the service already confirmed in DM; in groups confirm inline too
    if (chatId !== from.id) {
      bot.sendMessage(chatId, `✅ Report ${issueId} received.`);
    }
  } catch (e) {
    logger.error("[report] chat submission failed:", e);
    bot
      .sendMessage(chatId, "I couldn't file that report. Please try again.")
      .catch(() => {});
  }
});
