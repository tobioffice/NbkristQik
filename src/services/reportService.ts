/**
 * Report service — shared creation/announcement path for both the web form
 * and the /report command, plus the conversation loop: admin messages (from
 * the panel or /reply) and reporter follow-ups both land in the report's
 * thread and ping the other side in Telegram.
 * All Telegram sends are best-effort: a notification failure never loses the
 * report or a message in it.
 */
import {
  addReportMessage,
  createReport,
  getReport,
  markReportRead,
  replyReport,
  setReportStatus,
  formatIssueId,
  parseIssueId,
  type ReportRow,
} from "../db/report.model.js";
import { trackActivity } from "./tracker.js";
import { getClient } from "./redis/getRedisClient.js";
import { redisKeys } from "./redis/keys.js";
import { logger } from "../config/logger.js";
import { ADMIN_ID } from "../config/environmentals.js";
import { REPORT_WEBAPP_URL } from "../constants/webapp.js";

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const bot = async (): Promise<import("node-telegram-bot-api") | null> => {
  try {
    const { bot: instance } = await import("../bot/bot.js");
    return instance;
  } catch {
    return null;
  }
};

/** Deep link straight into one conversation in the reports mini app. */
export const reportThreadUrl = (issueId: string): string =>
  `${REPORT_WEBAPP_URL}?issue=${encodeURIComponent(issueId)}`;

/** Deep link into the reporter's own issue list. */
export const reportListUrl = (): string => `${REPORT_WEBAPP_URL}?view=reports`;

export interface ReportSubmission {
  userId: number;
  username?: string | null;
  firstName?: string | null;
  /** chat surface for tracking; the web form reports as "unknown" */
  chatType?: "private" | "group" | "supergroup" | "channel" | "unknown";
  message: string;
}

/** One report per user per minute (fail-open), beyond the HTTP rate limiter. */
export const tooSoonToReport = async (userId: number): Promise<boolean> => {
  try {
    const redis = await getClient();
    const claimed = await redis.set(redisKeys.reportGate(userId), "1", {
      EX: 60,
      NX: true,
    });
    return !claimed;
  } catch (e) {
    logger.warn("[report] gate check failed (fail-open):", e);
    return false;
  }
};

/**
 * Chat pace, not a filing gate: one follow-up message every couple of
 * seconds per reporter (fail-open).
 */
export const tooSoonToFollowUp = async (userId: number): Promise<boolean> => {
  try {
    const redis = await getClient();
    const claimed = await redis.set(redisKeys.reportThreadGate(userId), "1", {
      EX: 3,
      NX: true,
    });
    return !claimed;
  } catch (e) {
    logger.warn("[report] follow-up gate check failed (fail-open):", e);
    return false;
  }
};

export const createAndAnnounce = async (
  sub: ReportSubmission,
): Promise<{ issueId: string; id: number }> => {
  const id = await createReport(sub.userId, sub.message);
  const issueId = formatIssueId(id);

  trackActivity({
    userId: sub.userId,
    username: sub.username ?? null,
    firstName: sub.firstName ?? null,
    chatType: sub.chatType ?? "unknown",
    action: "report",
    detail: issueId,
  });

  const instance = await bot();
  if (instance) {
    const reporterName = escapeHtml(
      sub.firstName || sub.username || `User ${sub.userId}`,
    );

    if (ADMIN_ID) {
      const notice =
        `📢 <b>${issueId} · New Report</b>\n\n` +
        `👤 ${reporterName} · <code>${sub.userId}</code>\n` +
        `📝 ${escapeHtml(sub.message)}\n\n` +
        `↩️ Reply with: <code>/reply ${issueId} your answer</code>`;
      instance
        .sendMessage(ADMIN_ID, notice, { parse_mode: "HTML" })
        .catch((e: Error) =>
          logger.warn("[report] admin notice failed:", e?.message ?? e),
        );
    }

    instance
      .sendMessage(
        sub.userId,
        `✅ <b>Report ${issueId} received</b>\n\n` +
          `<i>${escapeHtml(sub.message.slice(0, 200))}${sub.message.length > 200 ? "…" : ""}</i>\n\n` +
          `I'll look into it and reply here in the chat. You can also add to the thread from My reports.`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🗂 My reports", web_app: { url: reportListUrl() } }],
            ],
          },
        },
      )
      .catch((e: Error) =>
        logger.warn("[report] reporter confirm failed:", e?.message ?? e),
      );
  }

  return { issueId, id };
};

/** DM the reporter: the admin left a message in their thread. */
const notifyReporterOfMessage = async (
  report: ReportRow,
  body: string,
): Promise<void> => {
  const instance = await bot();
  if (!instance) return;
  const issueId = formatIssueId(report.id);
  instance
    .sendMessage(
      report.user_id,
      `💬 <b>${issueId} · message from the admin</b>\n\n` +
        `${escapeHtml(body)}`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "💬 Open the thread",
                web_app: { url: reportThreadUrl(issueId) },
              },
            ],
          ],
        },
      },
    )
    .catch((e: Error) =>
      logger.warn("[report] reply DM failed:", e?.message ?? e),
    );
};

/** DM the admin: the reporter added something to the thread. */
const notifyAdminOfMessage = async (
  issueId: string,
  report: ReportRow,
  body: string,
  who?: { username?: string | null; firstName?: string | null },
): Promise<void> => {
  const instance = await bot();
  if (!instance || !ADMIN_ID) return;
  const reporterName = escapeHtml(
    who?.firstName || who?.username || `User ${report.user_id}`,
  );
  instance
    .sendMessage(
      ADMIN_ID,
      `💬 <b>${issueId} · reporter replied</b>\n\n` +
        `👤 ${reporterName} · <code>${report.user_id}</code>\n` +
        `📝 ${escapeHtml(body)}\n\n` +
        `↩️ Answer with: <code>/reply ${issueId} your answer</code>`,
      { parse_mode: "HTML" },
    )
    .catch((e: Error) =>
      logger.warn("[report] admin thread notice failed:", e?.message ?? e),
    );
};

/**
 * Admin message via /reply or the panel: it becomes the next entry in the
 * thread, the legacy reply columns are updated, the status flips to
 * answered, and the reporter is DM'd with a link back to the conversation.
 * Returns the issueId or null when the report id is unknown.
 */
export const adminReplyToReport = async (
  rawId: string,
  reply: string,
): Promise<string | null> => {
  const id = parseIssueId(rawId);
  if (!id) return null;
  const report = await getReport(id);
  if (!report) return null;
  await addReportMessage(id, "admin", reply);
  await replyReport(id, reply);
  await notifyReporterOfMessage(report, reply);
  return formatIssueId(id);
};

/**
 * Reporter follow-up on a thread: appends the message, reopens the issue so
 * it lands in the admin's "Open" inbox, and DMs the admin.
 * Returns the issueId, or null when the report is unknown or not theirs.
 */
export const appendUserMessage = async (
  rawId: string,
  userId: number,
  body: string,
  who?: { username?: string | null; firstName?: string | null },
): Promise<string | null> => {
  const id = parseIssueId(rawId);
  if (!id) return null;
  const report = await getReport(id);
  if (!report || report.user_id !== userId) return null;

  const messageId = await addReportMessage(id, "user", body);
  // the author has obviously read their own message
  await markReportRead(id, "user", messageId).catch(() => {});
  // a follow-up means the admin owes an answer again
  if (report.status !== "open") await setReportStatus(id, "open");

  const issueId = formatIssueId(id);
  trackActivity({
    userId,
    username: who?.username ?? null,
    firstName: who?.firstName ?? null,
    chatType: "unknown",
    action: "report_followup",
    detail: issueId,
  });

  await notifyAdminOfMessage(issueId, report, body, who);
  return issueId;
};

/** Admin close: flips status to resolved and tells the reporter. */
export const adminCloseReport = async (
  rawId: string,
): Promise<string | null> => {
  const id = parseIssueId(rawId);
  if (!id) return null;
  const report = await getReport(id);
  if (!report) return null;
  const changed = await setReportStatus(id, "resolved");
  if (!changed) return null;

  const issueId = formatIssueId(id);
  const instance = await bot();
  if (instance) {
    instance
      .sendMessage(
        report.user_id,
        `✅ <b>${issueId} resolved</b>\n\n` +
          `Glad it worked out. If it ever comes back, just report it again.`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "💬 Open the thread",
                  web_app: { url: reportThreadUrl(issueId) },
                },
              ],
            ],
          },
        },
      )
      .catch(() => {});
  }
  return issueId;
};
