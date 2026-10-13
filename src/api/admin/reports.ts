import type { Express, Request, Response } from "express";
import {
  listReports,
  setReportStatus,
  formatIssueId,
  getReportReadMarker,
  getReportWithReporter,
  listReportMessages,
  markReportRead,
  parseIssueId,
  type ReportStatus,
} from "../../db/report.model.js";
import {
  adminReplyToReport,
  adminCloseReport,
} from "../../services/reportService.js";
import { logger } from "../../config/logger.js";
import { cached, invalidate } from "./cache.js";
import type { RequireAdmin } from "./auth.js";

const isStatus = (value: unknown): value is ReportStatus =>
  value === "open" || value === "answered" || value === "resolved";

/** Mounts GET {base}/api/reports + thread read/reply/close endpoints. */
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
                messageCount: r.message_count,
                lastAuthor: r.last_author,
                lastMessageAt: r.last_message_at,
                unread: r.unread,
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

  // GET {base}/api/reports/:id — the whole conversation behind one issue id.
  // Opening it clears the "new" stamp for the panel.
  app.get(
    `${base}/api/reports/:id`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const id = parseIssueId(String(req.params.id));
        const report = id ? await getReportWithReporter(id) : null;
        if (!id || !report) {
          res.status(404).json({ error: "Unknown report" });
          return;
        }

        const messages = await listReportMessages(id);
        const lastId = messages.length ? messages[messages.length - 1].id : 0;
        // a write only when there was something unread to clear
        if (lastId > (await getReportReadMarker(id, "admin"))) {
          try {
            await markReportRead(id, "admin", lastId);
            invalidate("reports:");
          } catch (e) {
            logger.warn("[admin] mark report read failed:", e);
          }
        }

        res.json({
          ok: true,
          thread: {
            issueId: formatIssueId(id),
            userId: report.user_id,
            name: report.name,
            username: report.username,
            status: report.status,
            createdAt: report.created_at,
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
        logger.error("[admin] report thread failed:", e);
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
        // adminReplyToReport appends to the thread and DMs the reporter
        const issueId = await adminReplyToReport(String(req.params.id), reply);
        if (!issueId) {
          res.status(404).json({ error: "Unknown report" });
          return;
        }
        invalidate("reports:");
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
        invalidate("reports:");
        res.json({ ok: true, issueId });
      } catch (e) {
        logger.error("[admin] report close failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );

  // POST {base}/api/reports/:id/reopen — put a closed issue back in the inbox
  app.post(
    `${base}/api/reports/:id/reopen`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const id = parseIssueId(String(req.params.id));
        const changed = id ? await setReportStatus(id, "open") : false;
        if (!id || !changed) {
          res.status(404).json({ error: "Unknown report" });
          return;
        }
        invalidate("reports:");
        res.json({ ok: true, issueId: formatIssueId(id) });
      } catch (e) {
        logger.error("[admin] report reopen failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );
};
