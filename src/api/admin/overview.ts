import type { Express, Request, Response } from "express";
import { turso } from "../../db/db.js";
import { logger } from "../../config/logger.js";
import { cached } from "./cache.js";
import type { RequireAdmin } from "./auth.js";

interface OverviewPayload {
  totals: {
    users: number;
    activeToday: number;
    active7d: number;
    active30d: number;
    totalActions: number;
  };
  daily: Array<{
    day: string;
    actions: number;
    users: number;
    checkins: number;
  }>;
  hourly: Array<{
    h: string;
    actions: number;
    users: number;
    checkins: number;
  }>;
  surfaces: Record<string, number>;
  topActions: Array<{ action: string; count: number }>;
}

const computeOverview = async (): Promise<OverviewPayload> => {
  const results = await turso.batch(
    [
      { sql: `SELECT COUNT(*) n FROM botusers`, args: [] },
      {
        // "today" = since midnight IST (IST is UTC+5:30, so its
        // midnight is 18:30 UTC the day before)
        sql: `SELECT COUNT(*) n FROM botusers
            WHERE last_seen >= datetime('now', 'start of day', '-330 minutes')`,
        args: [],
      },
      {
        sql: `SELECT COUNT(*) n FROM botusers WHERE last_seen >= datetime('now', '-7 days')`,
        args: [],
      },
      {
        sql: `SELECT COUNT(*) n FROM botusers WHERE last_seen >= datetime('now', '-30 days')`,
        args: [],
      },
      {
        sql: `SELECT COALESCE(SUM(total_actions), 0) n FROM botusers`,
        args: [],
      },
      {
        sql: `SELECT date(created_at, '+330 minutes') d, COUNT(*) actions, COUNT(DISTINCT user_id) users,
                   SUM(CASE WHEN action = 'daily_checkin' THEN 1 ELSE 0 END) checkins
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
                   COUNT(*) actions, COUNT(DISTINCT user_id) users,
                   SUM(CASE WHEN action = 'daily_checkin' THEN 1 ELSE 0 END) checkins
             FROM activity_log
             WHERE created_at >= datetime('now', '-30 hours')
             GROUP BY h ORDER BY h`,
        args: [],
      },
    ],
    "read",
  );
  const [
    usersQ,
    todayQ,
    weekQ,
    monthQ,
    actionsQ,
    dailyQ,
    surfaceQ,
    topQ,
    hourlyQ,
  ] = results;

  const surfaces: Record<string, number> = {};
  for (const row of surfaceQ.rows) {
    surfaces[String(row.surface)] = Number(row.n);
  }

  return {
    totals: {
      users: Number(usersQ.rows[0]?.n || 0),
      activeToday: Number(todayQ.rows[0]?.n || 0),
      active7d: Number(weekQ.rows[0]?.n || 0),
      active30d: Number(monthQ.rows[0]?.n || 0),
      totalActions: Number(actionsQ.rows[0]?.n || 0),
    },
    daily: dailyQ.rows.map((r) => ({
      day: String(r.d),
      actions: Number(r.actions),
      users: Number(r.users),
      checkins: Number(r.checkins || 0),
    })),
    hourly: hourlyQ.rows.map((r) => ({
      h: String(r.h),
      actions: Number(r.actions),
      users: Number(r.users),
      checkins: Number(r.checkins || 0),
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
