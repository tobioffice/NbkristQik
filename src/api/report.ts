import { Request, Response, Router } from "express";
import { resolveUserId } from "./resolveUser.js";
import {
  createAndAnnounce,
  tooSoonToReport,
} from "../services/reportService.js";
import { listUserReports, formatIssueId } from "../db/report.model.js";
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

// GET /api/myreports — the caller's own reports with status + replies
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
      })),
    });
  } catch (e) {
    logger.error("[report] myreports failed:", e);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});
