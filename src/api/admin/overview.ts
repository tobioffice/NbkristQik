import type { Express, Request, Response } from "express";
import { turso } from "../../db/db.js";
import { getOverviewTotals } from "../../db/activityStats.model.js";
import { logger } from "../../config/logger.js";
import { cached } from "./cache.js";
import type { RequireAdmin } from "./auth.js";

interface OverviewPayload {
  totals: {
    users: number;
    activeToday: number;
    active7d: number;
    active30d: number;
    commands7d: number;
    totalActions: number;
  };
  daily: Array<{
    day: string;
    actions: number;
    users: number;
  }>;
  hourly: Array<{
    h: string;
    actions: number;
    users: number;
  }>;
  surfaces: Record<string, number>;
  topActions: Array<{ action: string; count: number }>;
}

const computeOverview = async (): Promise<OverviewPayload> => {
  // usage totals are shared with /api/stats, so the public page and this panel
  // cannot report different numbers
  const [totals, results] = await Promise.all([
    getOverviewTotals(),
    turso.batch(
      [
        {
          sql: `SELECT COALESCE(SUM(total_actions), 0) n FROM botusers`,
          args: [],
        },
        {
          sql: `SELECT date(created_at, '+330 minutes') d, COUNT(*) actions, COUNT(DISTINCT user_id) users
             FROM activity_log
             WHERE created_at >= datetime('now', '-30 days')
             GROUP BY d ORDER BY d`,
          args: [],
        },
        {
          sql: `SELECT CASE WHEN chat_type = 'supergroup' THEN 'group' ELSE chat_type END AS surface,
                   COUNT(*) n
            FROM activity_log
            WHERE created_at >= datetime('now', '-30 days')
            GROUP BY surface`,
          args: [],
        },
        {
          sql: `SELECT action, COUNT(*) n FROM activity_log
            WHERE created_at >= datetime('now', '-7 days') AND action != 'roll_lookup'
            GROUP BY action ORDER BY n DESC LIMIT 8`,
          args: [],
        },
        {
          // day+hour keys in IST (+330 min shift) — storage stays UTC,
          // grouping follows IST wall-clock boundaries
          sql: `SELECT strftime('%Y-%m-%d %H', created_at, '+330 minutes') h,
                   COUNT(*) actions, COUNT(DISTINCT user_id) users
             FROM activity_log
             WHERE created_at >= datetime('now', '-30 hours')
             GROUP BY h ORDER BY h`,
          args: [],
        },
      ],
      "read",
    ),
  ]);
  const [actionsQ, dailyQ, surfaceQ, topQ, hourlyQ] = results;

  const surfaces: Record<string, number> = {};
  for (const row of surfaceQ.rows) {
    surfaces[String(row.surface)] = Number(row.n);
  }

  return {
    totals: {
      users: totals.users,
      activeToday: totals.activeToday,
      active7d: totals.active7d,
      active30d: totals.active30d,
      commands7d: totals.commands7d,
      totalActions: Number(actionsQ.rows[0]?.n || 0),
    },
    daily: dailyQ.rows.map((r) => ({
      day: String(r.d),
      actions: Number(r.actions),
      users: Number(r.users),
    })),
    hourly: hourlyQ.rows.map((r) => ({
      h: String(r.h),
      actions: Number(r.actions),
      users: Number(r.users),
    })),
    surfaces,
    topActions: topQ.rows.map((r) => ({
      action: String(r.action),
      count: Number(r.n),
    })),
  };
};

/** Mounts GET {base}/api/overview — totals, 30-day pulse, surface split, top actions. */
export const registerOverviewRoute = (
  app: Express,
  base: string,
  requireAdmin: RequireAdmin,
): void => {
  // cached for 60s — the panel re-requests it on every visit
  app.get(
    `${base}/api/overview`,
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const data = await cached("overview", 60_000, computeOverview);
        res.json(data);
      } catch (e) {
        logger.error("[admin] overview failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );
};
