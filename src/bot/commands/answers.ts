import { bot } from "../bot.js";
import {
  adminReplyToReport,
  adminCloseReport,
} from "../../services/reportService.js";
import { ADMIN_ID } from "../../config/environmentals.js";
import { trackMessage } from "../../services/tracker.js";
import { logger } from "../../config/logger.js";

// Admin reply/close for issue reports. The issue id is accepted as
// QIK-0007, QIK-7, or just 7. Replies are recorded on the report and DM'd
// to the reporter automatically.

bot.onText(/\/reply (\S+)(?:\s+([\s\S]+))?/, async (msg, match) => {
  if (msg.from?.id !== ADMIN_ID) return;
  trackMessage(msg, "command:reply");

  const chatId = msg.chat.id;
  const rawId = match?.[1] ?? "";
  const reply = match?.[2]?.trim() ?? "";

  if (!reply) {
    bot.sendMessage(
      chatId,
      "Usage:\n<code>/reply QIK-0007 your answer to the reporter</code>",
      { parse_mode: "HTML" },
    );
    return;
  }

  try {
    const issueId = await adminReplyToReport(rawId, reply);
    if (!issueId) {
      bot.sendMessage(chatId, `Couldn't find a report matching ${rawId}.`);
      return;
    }
    bot.sendMessage(
      chatId,
      `Sent. It's saved on <code>${issueId}</code> and the reporter has it in DM.`,
      { parse_mode: "HTML" },
    );
  } catch (e) {
    logger.error("[answers] /reply failed:", e);
    bot
      .sendMessage(chatId, "That didn't send. Try again in a bit.")
      .catch(() => {});
  }
});

bot.onText(/\/close (\S+)/, async (msg, match) => {
  if (msg.from?.id !== ADMIN_ID) return;
  trackMessage(msg, "command:close");

  const chatId = msg.chat.id;
  const rawId = match?.[1] ?? "";

  try {
    const issueId = await adminCloseReport(rawId);
    if (!issueId) {
      bot.sendMessage(chatId, `Couldn't find a report matching ${rawId}.`);
      return;
    }
    bot.sendMessage(
      chatId,
      `Closed <code>${issueId}</code>. The reporter knows.`,
      { parse_mode: "HTML" },
    );
  } catch (e) {
    logger.error("[answers] /close failed:", e);
    bot
      .sendMessage(chatId, "That didn't close. Try again in a bit.")
      .catch(() => {});
  }
});
