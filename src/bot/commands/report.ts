import { bot } from "../bot.js";
import {
  createAndAnnounce,
  tooSoonToReport,
} from "../../services/reportService.js";
import { trackMessage } from "../../services/tracker.js";
import {
  REPORT_LIST_WEBAPP_URL,
  REPORT_WEBAPP_URL,
} from "../../constants/webapp.js";
import { CHIT_CHAT_ID } from "../../constants/index.js";
import { logger } from "../../config/logger.js";

// /report now lives on the web: easy typing, an issue id, and replies that
// reach the reporter here in Telegram. A bare /report opens the form — plus
// a second button straight into "My reports", where every past issue and its
// conversation is waiting. "/report <message>" still works and files a
// tracked report with an id.

bot.onText(/\/report$/, (msg) => {
  trackMessage(msg, "command:report");

  // Telegram only allows web_app buttons in private chats
  const isPrivate = msg.chat.type === "private";
  const button = (text: string, url: string) =>
    isPrivate ? { text, web_app: { url } } : { text, url };

  bot
    .sendMessage(
      msg.chat.id,
      `Something broken? Open the form and tell me what happened. You'll get a tracking id like <code>QIK-0012</code> and I'll reply here.`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [button("🐞 Report an issue", REPORT_WEBAPP_URL)],
            [button("🗂 My reports", REPORT_LIST_WEBAPP_URL)],
          ],
        },
      },
    )
    .catch((e: Error) =>
      logger.warn("[report] form message failed:", e?.message ?? e),
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
      "Give me a little more to go on, between 10 and 1000 characters.",
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
      bot.sendMessage(chatId, `Got it, I've filed ${issueId}.`);
    }
  } catch (e) {
    logger.error("[report] chat submission failed:", e);
    bot
      .sendMessage(chatId, "I couldn't file that. Try again in a bit.")
      .catch(() => {});
  }
});
