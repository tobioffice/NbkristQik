/**
 * Report service — shared creation/announcement path for both the web form
 * and the /report command. Writes the report row, records activity, notifies
 * the admin with the issue id, and confirms to the reporter in chat.
 * All Telegram sends are best-effort: a notification failure never loses the
 * report itself.
 */
import {
  createReport,
  getReport,
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
          `I'll look into it and reply here in the chat.`,
        { parse_mode: "HTML" },
      )
      .catch((e: Error) =>
        logger.warn("[report] reporter confirm failed:", e?.message ?? e),
      );
  }

  return { issueId, id };
};

const notifyReply = async (report: ReportRow, reply: string): Promise<void> => {
  const instance = await bot();
  if (!instance) return;
  instance
    .sendMessage(
      report.user_id,
      `↩️ <b>About your report ${formatIssueId(report.id)}</b>\n\n` +
        `${escapeHtml(reply)}`,
      { parse_mode: "HTML" },
    )
    .catch((e: Error) =>
      logger.warn("[report] reply DM failed:", e?.message ?? e),
    );
};

/**
 * Admin reply via /reply or the panel: records the reply, flips the status
 * to answered, and DMs the reporter. Returns the issueId or null when the
 * report id is unknown.
 */
export const adminReplyToReport = async (
  rawId: string,
  reply: string,
): Promise<string | null> => {
  const id = parseIssueId(rawId);
  if (!id) return null;
  const report = await getReport(id);
  if (!report) return null;
  await replyReport(id, reply);
  await notifyReply(report, reply);
  return formatIssueId(id);
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

  const instance = await bot();
  if (instance) {
    instance
      .sendMessage(
        report.user_id,
        `✅ <b>${formatIssueId(id)} resolved</b>\n\n` +
          `Glad it worked out. If it ever comes back, just report it again.`,
        { parse_mode: "HTML" },
      )
      .catch(() => {});
  }
  return formatIssueId(id);
};
