import { turso } from "./db.js";

export interface OverviewTotals {
  users: number;
  activeToday: number;
  active7d: number;
  active30d: number;
  commands7d: number;
}

/**
 * The single source of the usage totals. This exact function feeds both the
 * admin overview and the public /api/stats, so the two surfaces cannot
 * diverge.
 *
 * "Today" and the trailing windows are IST calendar days: IST is UTC+5:30, so
 * midnight IST is 330 minutes before UTC midnight.
 */
export const getOverviewTotals = async (): Promise<OverviewTotals> => {
  const results = await turso.batch(
    [
      { sql: `SELECT COUNT(*) n FROM botusers`, args: [] },
      {
        sql: `SELECT
                COUNT(DISTINCT CASE WHEN created_at >= datetime('now','start of day','-330 minutes') THEN user_id END) dau,
                COUNT(DISTINCT CASE WHEN created_at >= datetime('now','start of day','-330 minutes','-6 days') THEN user_id END) wau,
                COUNT(DISTINCT CASE WHEN created_at >= datetime('now','start of day','-330 minutes','-29 days') THEN user_id END) mau
              FROM activity_log
              WHERE created_at >= datetime('now','start of day','-330 minutes','-29 days')`,
        args: [],
      },
      {
        sql: `SELECT COUNT(*) n FROM activity_log WHERE created_at >= datetime('now','start of day','-330 minutes','-6 days')`,
        args: [],
      },
    ],
    "read",
  );
  const [usersQ, activeQ, commandsQ] = results;

  return {
    users: Number(usersQ.rows[0]?.n || 0),
    activeToday: Number(activeQ.rows[0]?.dau || 0),
    active7d: Number(activeQ.rows[0]?.wau || 0),
    active30d: Number(activeQ.rows[0]?.mau || 0),
    commands7d: Number(commandsQ.rows[0]?.n || 0),
  };
};
