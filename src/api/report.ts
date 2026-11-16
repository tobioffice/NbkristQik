import { Request, Response, Router } from "express";
import { resolveUserId } from "./resolveUser.js";
import {
  appendUserMessage,
  createAndAnnounce,
  tooSoonToFollowUp,
  tooSoonToReport,
} from "../services/reportService.js";
import {
  ReportUploadError,
  readReportUpload,
  reportAttachmentUrl,
  type PendingReportUpload,
  type StoredReportFile,
} from "../services/reportFiles.js";
import {
  formatIssueId,
  getReportThread,
  listUserReports,
  markReportRead,
  parseIssueId,
  type ReportAttachment,
} from "../db/report.model.js";
import { logger } from "../config/logger.js";

export const reportRouter = Router();

const unauthorized = (res: Response, error: string | undefined) => {
  res
    .status(401)
    .json({ ok: false, error: error ?? "Telegram initData required" });
};

/** The wire shape of one screenshot: a URL plus what the client needs to render it. */
const attachmentJson = (attachment: ReportAttachment) => ({
  url: reportAttachmentUrl(attachment.file_name),
  mimeType: attachment.mime_type,
  byteSize: attachment.byte_size,
});

/** The report model wants disk metadata, not the absolute path. */
const attachmentRows = (files: StoredReportFile[]) =>
  files.map((file) => ({
    fileName: file.fileName,
    mimeType: file.mimeType,
    byteSize: file.byteSize,
  }));

/**
 * Parse a multipart form when that is what arrived. JSON callers (older
 * clients and the bot) keep the plain body path and never touch the disk.
 */
const readUpload = async (
  req: Request,
): Promise<PendingReportUpload | null> => {
  if (!req.is("multipart/form-data")) return null;
  return readReportUpload(req);
};

// POST /api/report — submit from the web form (identity required). JSON and
// multipart are both accepted; multipart carries up to three screenshots.
reportRouter.post("/report", async (req: Request, res: Response) => {
  let upload: PendingReportUpload | null = null;
  // Clean up before answering, not after: a client that retries immediately
  // must not race a temp directory that is still being removed.
  const dropUpload = async () => {
    if (!upload) return;
    const pending = upload;
    upload = null;
    // A cleanup failure must not turn a clean 400 into a 500 or an
    // unhandled rejection; the row was never written, so the bytes are
    // at worst an orphan on disk.
    await pending
      .discard()
      .catch((e) => logger.warn("[report] upload cleanup failed:", e));
  };
  try {
    const resolved = resolveUserId(req);
    if (!resolved || resolved.error) {
      unauthorized(res, resolved?.error);
      return;
    }

    try {
      upload = await readUpload(req);
    } catch (e) {
      if (e instanceof ReportUploadError) {
        res.status(400).json({ ok: false, error: e.message });
        return;
      }
      throw e;
    }

    // sanitizeInput already trims the body; multipart fields are read here
    const message = upload
      ? upload.message
      : String(req.body?.message ?? "").trim();
    if (message.length < 10 || message.length > 1000) {
      await dropUpload();
      res.status(400).json({
        ok: false,
        error: "Give me a bit more detail: between 10 and 1000 characters.",
      });
      return;
    }

    const userId = Number(resolved.userId);
    if (await tooSoonToReport(userId)) {
      await dropUpload();
      res.status(429).json({
        ok: false,
        error: "Hold on a minute before reporting again.",
      });
      return;
    }

    const files = upload ? await upload.commit() : [];
    const { issueId } = await createAndAnnounce({
      userId,
      username: resolved.user?.username ?? null,
      firstName: resolved.user?.first_name ?? null,
      chatType: "unknown",
      message,
      attachments: attachmentRows(files),
    });
    // the report now owns the files; a later failure must not delete them
    upload = null;

    res.json({ ok: true, issueId });
  } catch (e) {
    logger.error("[report] submit failed:", e);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  } finally {
    await dropUpload();
  }
});

// GET /api/myreports — the caller's own reports, newest first, each with a
// thread roll-up: how many messages, who spoke last, how many are unseen
reportRouter.get("/myreports", async (req: Request, res: Response) => {
  try {
    const resolved = resolveUserId(req);
    if (!resolved || resolved.error) {
      unauthorized(res, resolved?.error);
      return;
    }

    const rows = await listUserReports(Number(resolved.userId));
    res.json({
      reports: rows.map((r) => ({
        issueId: formatIssueId(r.id),
        message: r.message,
        status: r.status,
        adminReply: r.admin_reply,
        repliedAt: r.replied_at,
        createdAt: r.created_at,
        messageCount: r.message_count,
        lastAuthor: r.last_author,
        lastMessageAt: r.last_message_at,
        unread: r.unread,
      })),
    });
  } catch (e) {
    logger.error("[report] myreports failed:", e);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

// GET /api/thread/:issue — one conversation (the caller's own only), read in
// a single round trip. Opening it marks everything in it as read.
reportRouter.get("/thread/:issue", async (req: Request, res: Response) => {
  try {
    const resolved = resolveUserId(req);
    if (!resolved || resolved.error) {
      unauthorized(res, resolved?.error);
      return;
    }

    const id = parseIssueId(String(req.params.issue));
    const data = id ? await getReportThread(id, "user") : null;
    // somebody else's issue must look exactly like a missing one
    if (!id || !data || data.user_id !== Number(resolved.userId)) {
      res.status(404).json({ ok: false, error: "Unknown report" });
      return;
    }

    const messages = data.messages;
    const lastId = messages.length ? messages[messages.length - 1].id : 0;
    // one write, and only when something actually arrived — this read runs
    // on every poll, and a write per poll would burn the write quota
    if (lastId > data.last_seen_id) {
      await markReportRead(id, "user", lastId).catch((e) =>
        logger.warn("[report] mark read failed:", e),
      );
    }

    res.json({
      ok: true,
      thread: {
        issueId: formatIssueId(id),
        status: data.status,
        createdAt: data.created_at,
        messageCount: messages.length,
        messages: messages.map((m) => ({
          id: m.id,
          author: m.author,
          body: m.body,
          createdAt: m.created_at,
          attachments: m.attachments.map(attachmentJson),
        })),
      },
    });
  } catch (e) {
    logger.error("[report] thread read failed:", e);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

// POST /api/thread/:issue — the reporter adds a message to the conversation.
// Text-only JSON stays supported; multipart may carry screenshots and an
// empty body, because a picture of the bug is a complete message.
reportRouter.post("/thread/:issue", async (req: Request, res: Response) => {
  let upload: PendingReportUpload | null = null;
  const dropUpload = async () => {
    if (!upload) return;
    const pending = upload;
    upload = null;
    await pending
      .discard()
      .catch((e) => logger.warn("[report] upload cleanup failed:", e));
  };
  try {
    const resolved = resolveUserId(req);
    if (!resolved || resolved.error) {
      unauthorized(res, resolved?.error);
      return;
    }

    try {
      upload = await readUpload(req);
    } catch (e) {
      if (e instanceof ReportUploadError) {
        res.status(400).json({ ok: false, error: e.message });
        return;
      }
      throw e;
    }

    const message = upload
      ? upload.message
      : String(req.body?.message ?? "").trim();
    const fileCount = upload?.fileCount ?? 0;
    if (message.length > 1000) {
      await dropUpload();
      res.status(400).json({
        ok: false,
        error: "Keep it under 1000 characters.",
      });
      return;
    }
    if (message.length === 0 && fileCount === 0) {
      await dropUpload();
      res.status(400).json({
        ok: false,
        error: "Write a message or add a screenshot.",
      });
      return;
    }

    const userId = Number(resolved.userId);
    if (await tooSoonToFollowUp(userId)) {
      await dropUpload();
      res.status(429).json({
        ok: false,
        error: "Hold on a moment before sending again.",
      });
      return;
    }

    const files = upload ? await upload.commit() : [];
    const result = await appendUserMessage(
      String(req.params.issue),
      userId,
      message,
      {
        username: resolved.user?.username ?? null,
        firstName: resolved.user?.first_name ?? null,
      },
      attachmentRows(files),
    );
    if (!result) {
      await dropUpload();
      res.status(404).json({ ok: false, error: "Unknown report" });
      return;
    }
    if ("closed" in result) {
      await dropUpload();
      res.status(410).json({
        ok: false,
        error:
          "This issue is resolved and the thread is closed. File a new report if it came back.",
      });
      return;
    }
    upload = null;

    res.json({ ok: true, issueId: result.issueId });
  } catch (e) {
    logger.error("[report] thread message failed:", e);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  } finally {
    await dropUpload();
  }
});
