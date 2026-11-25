import type { Express, Request, Response } from "express";
import { turso } from "../../db/db.js";
import { getWeekSections } from "../../db/game.model.js";
import { logger } from "../../config/logger.js";
import { seasonKey } from "../../games/config.js";
import { istStamp, weekLabel } from "../../games/time.js";
import { cached } from "./cache.js";
import type { RequireAdmin } from "./auth.js";

/**
 * The league boards, read-only, for the admin panel.
 *
 * This is the operator's view of the same week the channel and games page
 * show: every scorer with their roll, display name, section, verification
 * state and privacy switch, plus the Section Wars board that only verified
 * students count for. Nothing here is written back.
 */

interface LeaguePlayer {
  userId: number;
  rollNo: string;
  displayName: string | null;
  firstName: string | null;
  username: string | null;
  sectionLabel: string | null;
  points: number;
  /** Finished daily runs this week; a duel is a match, not a run. */
  plays: number;
  verified: boolean;
  hidden: boolean;
}

interface LeagueStats {
  players: number;
  verified: number;
  sections: number;
  runsToday: number;
  playersToday: number;
}

const num = (value: unknown): number => Number(value ?? 0);
const nullableText = (value: unknown): string | null =>
  value == null || value === "" ? null : String(value);

/** The week's scorers, in one pass, limited to what one table can read. */
const PLAYER_LIMIT = 500;

const queryLeague = async (dayKey: string) => {
  const stamp = istStamp();
  const season = seasonKey();
  const [players, sections, totalRows, verifiedRows, todayRows] =
    await Promise.all([
      turso.execute({
        sql: `SELECT s.user_id,
                     MAX(s.roll_no) AS roll_no,
                     MAX(p.display_name) AS display_name,
                     MAX(p.section_label) AS section_label,
                     SUM(s.points) AS points,
                     (SELECT COUNT(*) FROM game_attempts a
                       WHERE a.user_id = s.user_id AND a.season = ?
                         AND a.week_key = ? AND a.status = 'done'
                         AND a.game = 'five') AS plays,
                     MAX(CASE WHEN c.roll_no IS NULL THEN 0 ELSE 1 END) AS verified,
                     MAX(CASE WHEN c.roll_no IS NULL THEN 0
                              ELSE COALESCE(c.hide_leaderboard, 0) END) AS hidden,
                     MAX(u.username) AS username,
                     MAX(u.first_name) AS first_name
              FROM game_scores s
              LEFT JOIN game_players p ON p.user_id = s.user_id
              LEFT JOIN botusers u ON u.user_id = s.user_id
              LEFT JOIN roll_claims c ON UPPER(c.roll_no) = UPPER(s.roll_no)
              WHERE s.season = ? AND s.week_key = ? AND s.source <> 'duel'
              GROUP BY s.user_id
              ORDER BY points DESC, s.user_id ASC
              LIMIT ?`,
        args: [season, stamp.week, season, stamp.week, PLAYER_LIMIT],
      }),
      getWeekSections(season, stamp.week, 100),
      turso.execute({
        sql: `SELECT COUNT(DISTINCT user_id) AS n FROM game_scores
              WHERE season = ? AND week_key = ? AND source <> 'duel'`,
        args: [season, stamp.week],
      }),
      turso.execute({
        sql: `SELECT COUNT(DISTINCT s.user_id) AS n
              FROM game_scores s
              JOIN roll_claims c ON UPPER(c.roll_no) = UPPER(s.roll_no)
              WHERE s.season = ? AND s.week_key = ? AND s.source <> 'duel'`,
        args: [season, stamp.week],
      }),
      turso.execute({
        sql: `SELECT COUNT(*) AS runs, COUNT(DISTINCT user_id) AS users
              FROM game_attempts
              WHERE day_key = ? AND status = 'done' AND game = 'five'`,
        args: [dayKey],
      }),
    ]);

  const rows: LeaguePlayer[] = players.rows.map((row) => ({
    userId: num(row.user_id),
    rollNo: String(row.roll_no),
    displayName: nullableText(row.display_name),
    firstName: nullableText(row.first_name),
    username: nullableText(row.username),
    sectionLabel: nullableText(row.section_label),
    points: num(row.points),
    plays: num(row.plays),
    verified: num(row.verified) === 1,
    hidden: num(row.hidden) === 1,
  }));

  const stats: LeagueStats = {
    players: num(totalRows.rows[0]?.n),
    verified: num(verifiedRows.rows[0]?.n),
    sections: sections.length,
    runsToday: num(todayRows.rows[0]?.runs),
    playersToday: num(todayRows.rows[0]?.users),
  };

  return {
    season,
    week: stamp.week,
    weekLabel: weekLabel(stamp.monday),
    stats,
    playerTotal: stats.players,
    playersShown: rows.length,
    players: rows,
    sections: sections.map((section) => ({
      label: section.label,
      points: section.points,
      players: section.players,
    })),
  };
};

/** Mounts GET {base}/api/league — the week's boards for the operator. */
export const registerLeagueRoutes = (
  app: Express,
  base: string,
  requireAdmin: RequireAdmin,
): void => {
  app.get(
    `${base}/api/league`,
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const stamp = istStamp();
        const data = await cached("league", 20_000, () =>
          queryLeague(stamp.date),
        );
        res.json(data);
      } catch (e) {
        logger.error("[admin] league query failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );
};
