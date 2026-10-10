import type { Express, Request, Response } from "express";
import { turso } from "../../db/db.js";
import { logger } from "../../config/logger.js";
import { cached } from "./cache.js";
import type { RequireAdmin } from "./auth.js";

interface UserRow {
  userId: number;
  username: string | null;
  firstName: string | null;
  rollNo: string | null;
  firstSeen: string;
  lastSeen: string;
  privateActions: number;
  channelActions: number;
  groupActions: number;
  totalActions: number;
}

const mapUserRow = (r: Record<string, unknown>): UserRow => ({
  userId: Number(r.user_id),
  username: r.username ? String(r.username) : null,
  firstName: r.first_name ? String(r.first_name) : null,
  rollNo: r.rollNo ? String(r.rollNo) : null,
  firstSeen: String(r.first_seen),
  lastSeen: String(r.last_seen),
  privateActions: Number(r.private_actions),
  channelActions: Number(r.channel_actions),
  groupActions: Number(r.group_actions),
  totalActions: Number(r.total_actions),
});

const queryUsers = async (q: string, sort: string, limit: number) => {
  const where = q
    ? `WHERE u.username LIKE ? OR u.first_name LIKE ?
       OR CAST(u.user_id AS TEXT) LIKE ? OR COALESCE(t.rollNo, '') LIKE ?`
    : "";
  const like = `%${q}%`;
  const orderBy =
    sort === "total" ? "u.total_actions DESC" : "u.last_seen DESC";

  const result = await turso.execute({
    sql: `SELECT u.user_id, u.username, u.first_name, u.first_seen, u.last_seen,
                 u.private_actions, u.channel_actions, u.group_actions,
                 u.total_actions, t.rollNo
          FROM botusers u
          LEFT JOIN tgusers t ON t.userId = CAST(u.user_id AS TEXT)
          ${where}
          ORDER BY ${orderBy}
          LIMIT ?`,
    args: q ? [like, like, like, like, limit] : [limit],
  });

  return { users: result.rows.map(mapUserRow) };
};

const queryUserDetail = async (userId: number, res: Response) => {
  const [profile, recent, daily] = await turso.batch(
    [
      {
        sql: `SELECT u.*, t.rollNo FROM botusers u
              LEFT JOIN tgusers t ON t.userId = CAST(u.user_id AS TEXT)
              WHERE u.user_id = ?`,
        args: [userId],
      },
      {
        sql: `SELECT action, chat_type, detail, created_at
              FROM activity_log WHERE user_id = ?
              ORDER BY id DESC LIMIT 60`,
        args: [userId],
      },
      {
        sql: `SELECT date(created_at, '+330 minutes') d, COUNT(*) n FROM activity_log
               WHERE user_id = ? AND created_at >= datetime('now', '-30 days')
               GROUP BY d ORDER BY d`,
        args: [userId],
      },
    ],
    "read",
  );

  const row = profile.rows[0];
  if (!row) {
    res.status(404).json({ error: "Unknown user" });
    return;
  }

  res.json({
    profile: mapUserRow(row),
    recent: recent.rows.map((r) => ({
      action: String(r.action),
      chatType: String(r.chat_type),
      detail: r.detail ? String(r.detail) : null,
      at: String(r.created_at),
    })),
    daily: daily.rows.map((r) => ({
      day: String(r.d),
      count: Number(r.n),
    })),
  });
};

/** Mounts GET {base}/api/users and GET {base}/api/users/:id. */
export const registerUsersRoutes = (
  app: Express,
  base: string,
  requireAdmin: RequireAdmin,
): void => {
  // ---- students: searchable, sortable user table ----
  app.get(
    `${base}/api/users`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const q = String(req.query.q || "")
          .trim()
          .slice(0, 40);
        const sort = req.query.sort === "total" ? "total" : "recent";
        const limit = Math.min(
          Math.max(parseInt(String(req.query.limit)) || 200, 1),
          500,
        );

        // every keystroke lands here (debounced client-side) — 20s per query
        const data = await cached(`users:${q}:${sort}:${limit}`, 20_000, () =>
          queryUsers(q, sort, limit),
        );
        res.json(data);
      } catch (e) {
        logger.error("[admin] users query failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );

  // ---- one student: profile + recent activity + 30-day shape ----
  app.get(
    `${base}/api/users/:id`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const userId = Number(req.params.id);
        if (!Number.isInteger(userId) || userId <= 0) {
          res.status(400).json({ error: "Bad user id" });
          return;
        }
        await queryUserDetail(userId, res);
      } catch (e) {
        logger.error("[admin] user detail failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );
};
