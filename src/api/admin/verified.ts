import type { Express, Request, Response } from "express";
import { turso } from "../../db/db.js";
import { logger } from "../../config/logger.js";
import { cached } from "./cache.js";
import type { RequireAdmin } from "./auth.js";

interface VerifiedRow {
  userId: number | null;
  username: string | null;
  firstName: string | null;
  displayName: string | null;
  masterName: string | null;
  rollNo: string;
  email: string;
  verifiedAt: string;
  hideLeaderboard: boolean;
  blockLookups: boolean;
  blockRegistration: boolean;
  lastSeen: string | null;
}

const mapRow = (r: Record<string, unknown>): VerifiedRow => ({
  userId: r.user_id == null ? null : Number(r.user_id),
  username: r.username ? String(r.username) : null,
  firstName: r.first_name ? String(r.first_name) : null,
  displayName: r.display_name ? String(r.display_name) : null,
  masterName: r.master_name ? String(r.master_name) : null,
  rollNo: String(r.roll_no),
  email: String(r.email),
  verifiedAt: String(r.verified_at),
  hideLeaderboard: Number(r.hide_leaderboard) === 1,
  blockLookups: Number(r.block_lookups) === 1,
  blockRegistration: Number(r.block_registration) === 1,
  lastSeen: r.last_seen ? String(r.last_seen) : null,
});

const queryVerified = async (q: string, limit: number) => {
  const like = `%${q}%`;
  const where = q
    ? `WHERE c.roll_no LIKE ? OR c.email LIKE ? OR s.name LIKE ?
         OR r.display_name LIKE ? OR u.username LIKE ? OR u.first_name LIKE ?`
    : "";
  const result = await turso.execute({
    sql: `SELECT c.roll_no, c.user_id, c.email, c.verified_at,
                 c.hide_leaderboard, c.block_lookups, c.block_registration,
                 s.name AS master_name, r.display_name,
                 u.username, u.first_name, u.last_seen
          FROM roll_claims c
          LEFT JOIN studentsnew s ON s.roll_no = c.roll_no
          LEFT JOIN registrations r ON r.userId = c.user_id
          LEFT JOIN botusers u ON CAST(u.user_id AS TEXT) = c.user_id
          ${where}
          ORDER BY c.verified_at DESC
          LIMIT ?`,
    args: q ? [like, like, like, like, like, like, limit] : [limit],
  });
  return { claims: result.rows.map(mapRow) };
};

/** Mounts GET {base}/api/verified — who proved a roll with their college mail. */
export const registerVerifiedRoutes = (
  app: Express,
  base: string,
  requireAdmin: RequireAdmin,
): void => {
  app.get(
    `${base}/api/verified`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const q = String(req.query.q || "")
          .trim()
          .slice(0, 60);
        const limit = Math.min(
          Math.max(parseInt(String(req.query.limit)) || 200, 1),
          500,
        );
        const data = await cached(`verified:${q}:${limit}`, 20_000, () =>
          queryVerified(q, limit),
        );
        res.json(data);
      } catch (e) {
        logger.error("[admin] verified query failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );
};
