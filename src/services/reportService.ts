/**
 * Report service — shared creation/announcement path for both the web form
 * and the /report command, plus the conversation loop: admin messages (from
 * the panel or /reply) and reporter follow-ups both land in the report's
 * thread and ping the other side in Telegram.
 * All Telegram sends are best-effort: a notification failure never loses the
 * report or a message in it.
 */
import {
  appendUserThreadMessage,
  createReport,
  getReport,
  recordAdminReply,
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
import {
  reportThreadUrl as threadUrl,
  REPORT_LIST_WEBAPP_URL,
} from "../constants/webapp.js";
import { escapeHtml } from "./text.js";

const bot = async (): Promise<import("node-telegram-bot-api") | null> => {
  try {
    const { bot: instance } = await import("../bot/bot.js");
    return instance;
  } catch {
    return null;
  }
};

/** Deep link straight into one conversation in the app. */
export const reportThreadUrl = (issueId: string): string => threadUrl(issueId);

/** Deep link into the reporter's own issue list. */
export const reportListUrl = (): string => REPORT_LIST_WEBAPP_URL;

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
        `New report <code>${issueId}</code> from ${reporterName} · <code>${sub.userId}</code>\n` +
        `${escapeHtml(sub.message)}\n\n` +
        `Reply with <code>/reply ${issueId} your answer</code>`;
      instance
        .sendMessage(ADMIN_ID, notice, { parse_mode: "HTML" })
        .catch((e: Error) =>
          logger.warn("[report] admin notice failed:", e?.message ?? e),
        );
    }

    instance
      .sendMessage(
        sub.userId,
        `Got it, I've filed <code>${issueId}</code>.\n\n` +
          `<i>${escapeHtml(sub.message.slice(0, 200))}${sub.message.length > 200 ? "…" : ""}</i>\n\n` +
          `I'll reply here once I've looked into it. You can add more from My reports.`,
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
      `My reply on <code>${issueId}</code>:\n\n` + `${escapeHtml(body)}`,
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
      `Reply on <code>${issueId}</code> from ${reporterName} · <code>${report.user_id}</code>:\n` +
        `${escapeHtml(body)}\n\n` +
        `Answer with <code>/reply ${issueId} your answer</code>`,
      { parse_mode: "HTML" },
    )
    .catch((e: Error) =>
      logger.warn("[report] admin thread notice failed:", e?.message ?? e),
    );
};

/**
 * Admin message via /reply or the panel: one write round trip appends the
 * message, updates the legacy reply columns and the status, and clears the
 * admin's own unread stamp. The reporter is DM'd with a link back to the
 * conversation. Returns the issueId or null when the report id is unknown.
 */
export const adminReplyToReport = async (
  rawId: string,
  reply: string,
): Promise<string | null> => {
  const id = parseIssueId(rawId);
  if (!id) return null;
  const report = await getReport(id);
  if (!report) return null;
  await recordAdminReply(id, reply);
  await notifyReporterOfMessage(report, reply);
  return formatIssueId(id);
};

export type AppendUserMessageResult =
  | { issueId: string }
  | { closed: true }
  | null;

/**
 * Reporter follow-up on a thread: one write round trip appends the message,
 * moves the author's read marker to it, and reopens an answered issue so it
 * lands back in the admin's "Open" inbox. A resolved thread stays shut —
 * "resolved" means closed, so follow-ups are refused and the reporter files
 * a new report instead. The admin is DM'd on every accepted message.
 */
export const appendUserMessage = async (
  rawId: string,
  userId: number,
  body: string,
  who?: { username?: string | null; firstName?: string | null },
): Promise<AppendUserMessageResult> => {
  const id = parseIssueId(rawId);
  if (!id) return null;
  const report = await getReport(id);
  if (!report || report.user_id !== userId) return null;
  if (report.status === "resolved") return { closed: true };

  await appendUserThreadMessage(id, body, report.status !== "open");

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
  return { issueId };
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
        `I've closed <code>${issueId}</code>. Glad that's sorted.\n\n` +
          `If it comes back, report it again.`,
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
