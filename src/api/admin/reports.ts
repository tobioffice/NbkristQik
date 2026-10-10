import type { Express, Request, Response } from "express";
import {
  listReports,
  replyReport,
  setReportStatus,
  formatIssueId,
  getReport,
  type ReportStatus,
} from "../../db/report.model.js";
import {
  adminReplyToReport,
  adminCloseReport,
} from "../../services/reportService.js";
import { logger } from "../../config/logger.js";
import { cached } from "./cache.js";
import type { RequireAdmin } from "./auth.js";

const isStatus = (value: unknown): value is ReportStatus =>
  value === "open" || value === "answered" || value === "resolved";

/** Mounts GET {base}/api/reports + admin reply/close POSTs. */
export const registerReportsRoutes = (
  app: Express,
  base: string,
  requireAdmin: RequireAdmin,
): void => {
  app.get(
    `${base}/api/reports`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const statusParam =
          req.query.status === "all" || !req.query.status
            ? null
            : isStatus(req.query.status)
              ? (req.query.status as ReportStatus)
              : null;
        if (
          req.query.status &&
          req.query.status !== "all" &&
          !isStatus(req.query.status)
        ) {
          res.status(400).json({ error: "Bad status filter" });
          return;
        }
        const limit = Math.min(
          Math.max(parseInt(String(req.query.limit)) || 50, 1),
          200,
        );

        const data = await cached(
          `reports:${statusParam ?? "all"}:${limit}`,
          10_000,
          async () => {
            const rows = await listReports(statusParam, limit);
            return {
              reports: rows.map((r) => ({
                issueId: formatIssueId(r.id),
                userId: r.user_id,
                name: r.name,
                username: r.username,
                message: r.message,
                status: r.status,
                adminReply: r.admin_reply,
                repliedAt: r.replied_at,
                createdAt: r.created_at,
              })),
            };
          },
        );
        res.json(data);
      } catch (e) {
        logger.error("[admin] reports list failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );

  app.post(
    `${base}/api/reports/:id/reply`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const reply = String(req.body?.reply ?? "")
          .trim()
          .slice(0, 1000);
        if (!reply) {
          res.status(400).json({ error: "Reply text required" });
          return;
        }
        // adminReplyToReport also DMs the reporter via the bot
        const issueId = await adminReplyToReport(String(req.params.id), reply);
        if (!issueId) {
          res.status(404).json({ error: "Unknown report" });
          return;
        }
        res.json({ ok: true, issueId });
      } catch (e) {
        logger.error("[admin] report reply failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );

  app.post(
    `${base}/api/reports/:id/close`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const issueId = await adminCloseReport(String(req.params.id));
        if (!issueId) {
          res.status(404).json({ error: "Unknown report" });
          return;
        }
        res.json({ ok: true, issueId });
      } catch (e) {
        logger.error("[admin] report close failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );
};

// keep imports referenced for type safety
void replyReport;
void setReportStatus;
void getReport;
