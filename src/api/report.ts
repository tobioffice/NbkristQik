import { Request, Response, Router } from "express";
import { resolveUserId } from "./resolveUser.js";
import {
  appendUserMessage,
  createAndAnnounce,
  tooSoonToFollowUp,
  tooSoonToReport,
} from "../services/reportService.js";
import {
  formatIssueId,
  getReportThread,
  listUserReports,
  markReportRead,
  parseIssueId,
} from "../db/report.model.js";
import { logger } from "../config/logger.js";

export const reportRouter = Router();

const unauthorized = (res: Response, error: string | undefined) => {
  res
    .status(401)
    .json({ ok: false, error: error ?? "Telegram initData required" });
};

// POST /api/report — submit from the web form (identity required)
reportRouter.post("/report", async (req: Request, res: Response) => {
  try {
    const resolved = resolveUserId(req);
    if (!resolved || resolved.error) {
      unauthorized(res, resolved?.error);
      return;
    }

    // sanitizeInput already strips angle brackets from the body
    const message = String(req.body?.message ?? "").trim();
    if (message.length < 10 || message.length > 1000) {
      res.status(400).json({
        ok: false,
        error: "Give me a bit more detail: between 10 and 1000 characters.",
      });
      return;
    }

    const userId = Number(resolved.userId);
    if (await tooSoonToReport(userId)) {
      res.status(429).json({
        ok: false,
        error: "Hold on a minute before reporting again.",
      });
      return;
    }

    const { issueId } = await createAndAnnounce({
      userId,
      username: resolved.user?.username ?? null,
      firstName: resolved.user?.first_name ?? null,
      chatType: "unknown",
      message,
    });

    res.json({ ok: true, issueId });
  } catch (e) {
    logger.error("[report] submit failed:", e);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
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
        })),
      },
    });
  } catch (e) {
    logger.error("[report] thread read failed:", e);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

// POST /api/thread/:issue — the reporter adds a message to the conversation
reportRouter.post("/thread/:issue", async (req: Request, res: Response) => {
  try {
    const resolved = resolveUserId(req);
    if (!resolved || resolved.error) {
      unauthorized(res, resolved?.error);
      return;
    }

    const message = String(req.body?.message ?? "").trim();
    if (message.length < 1 || message.length > 1000) {
      res.status(400).json({
        ok: false,
        error: "Between 1 and 1000 characters.",
      });
      return;
    }

    const userId = Number(resolved.userId);
    if (await tooSoonToFollowUp(userId)) {
      res.status(429).json({
        ok: false,
        error: "Hold on a moment before sending again.",
      });
      return;
    }

    const result = await appendUserMessage(
      String(req.params.issue),
      userId,
      message,
      {
        username: resolved.user?.username ?? null,
        firstName: resolved.user?.first_name ?? null,
      },
    );
    if (!result) {
      res.status(404).json({ ok: false, error: "Unknown report" });
      return;
    }
    if ("closed" in result) {
      res.status(410).json({
        ok: false,
        error:
          "This issue is resolved and the thread is closed. File a new report if it came back.",
      });
      return;
    }

    res.json({ ok: true, issueId: result.issueId });
  } catch (e) {
    logger.error("[report] thread message failed:", e);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});
