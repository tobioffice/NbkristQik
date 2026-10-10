import type { Express, Request, Response } from "express";
import { turso } from "../../db/db.js";
import {
  getUptimeSummary,
  getUptimeDailyBuckets,
} from "../../db/student_stats.model.js";
import { logger } from "../../config/logger.js";
import { cached } from "./cache.js";
import type { RequireAdmin } from "./auth.js";

/** Mounts GET {base}/api/recent — the live activity feed. */
export const registerRecentRoute = (
  app: Express,
  base: string,
  requireAdmin: RequireAdmin,
): void => {
  app.get(
    `${base}/api/recent`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const limit = Math.min(
          Math.max(parseInt(String(req.query.limit)) || 50, 1),
          200,
        );
        // polled every 10s — a 5s cache halves the DB load with no visible lag
        const data = await cached(`recent:${limit}`, 5_000, async () => {
          const result = await turso.execute({
            sql: `SELECT a.id, a.user_id, a.chat_type, a.action, a.detail, a.created_at,
                         COALESCE(u.first_name, u.username) AS name, u.username
                  FROM activity_log a
                  LEFT JOIN botusers u ON u.user_id = a.user_id
                  ORDER BY a.id DESC
                  LIMIT ?`,
            args: [limit],
          });

          return {
            events: result.rows.map((r) => ({
              id: Number(r.id),
              userId: Number(r.user_id),
              name: r.name ? String(r.name) : null,
              username: r.username ? String(r.username) : null,
              chatType: String(r.chat_type),
              action: String(r.action),
              detail: r.detail ? String(r.detail) : null,
              at: String(r.created_at),
            })),
          };
        });

        res.json(data);
      } catch (e) {
        logger.error("[admin] recent feed failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );
};

/** Mounts GET {base}/api/health — same data the public /api/status serves. */
export const registerHealthRoute = (
  app: Express,
  base: string,
  requireAdmin: RequireAdmin,
): void => {
  app.get(
    `${base}/api/health`,
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        // uptime data only changes on the 5-min probe
        const data = await cached("health", 300_000, async () => {
          const summary = await getUptimeSummary();
          const components = await Promise.all(
            summary.map(async (s) => ({
              component: s.component,
              uptimePct: s.uptimePct,
              pings: s.pings,
              lastPing: s.lastPing,
              avgLatencyMs: s.avgLatencyMs,
              buckets: await getUptimeDailyBuckets(s.component, 90),
            })),
          );
          return { components };
        });
        res.json(data);
      } catch (e) {
        logger.error("[admin] health failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );
};
