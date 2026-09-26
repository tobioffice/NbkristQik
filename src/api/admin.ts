import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { turso } from "../db/db.js";
import {
  getUptimeSummary,
  getUptimeDailyBuckets,
} from "../db/student_stats.model.js";
import { ENV } from "../config/environmentals.js";
import { logger } from "../config/logger.js";
import { adminPanelHtml } from "./adminPanel.js";

const SESSION_TTL_SECONDS = 24 * 60 * 60;
const SESSION_COOKIE = "qik_admin";
const MAX_LOGIN_ATTEMPTS = 5; // per IP per window
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
};

const parseCookies = (header: string | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(
      part.slice(idx + 1).trim(),
    );
  }
  return out;
};

// only the HMAC of the token is stored, and it's keyed with the password,
// so changing ADMIN_PANEL_PASSWORD instantly invalidates every session —
// and the raw token never exists in the database
const tokenHash = (token: string, password: string) =>
  crypto.createHmac("sha256", password).update(token).digest("hex");

const tooManyAttempts = (ip: string): boolean => {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_LOGIN_ATTEMPTS;
};

// The panel polls; every request must not become a Turso query (read quota
// + a low-RAM server). Short-TTL in-memory cache sits in front of the
// read-heavy endpoints — staleness of a few seconds is fine here.
const responseCache = new Map<string, { at: number; payload: unknown }>();

const cached = async <T>(
  key: string,
  ttlMs: number,
  produce: () => Promise<T>,
): Promise<T> => {
  const hit = responseCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.payload as T;
  const value = await produce();
  responseCache.set(key, { at: Date.now(), payload: value });
  if (responseCache.size > 200) {
    const oldest = [...responseCache.entries()].sort(
      (a, b) => a[1].at - b[1].at,
    )[0];
    if (oldest) responseCache.delete(oldest[0]);
  }
  return value;
};

export const registerAdminRoutes = (app: Express): void => {
  const secretPath = process.env.ADMIN_PANEL_PATH?.replace(/^\/+|\/+$/g, "");
  const password = process.env.ADMIN_PANEL_PASSWORD;

  if (!secretPath || !password) {
    logger.info(
      "[admin] ADMIN_PANEL_PATH / ADMIN_PANEL_PASSWORD not set — admin panel disabled",
    );
    return;
  }
  const base = `/${secretPath}`;

  const requireAdmin = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (!token) {
        res.status(401).json({ error: "Not signed in" });
        return;
      }
      const hash = tokenHash(token, password);
      const session = await turso.execute({
        sql: `SELECT 1 FROM admin_sessions
              WHERE token_hash = ? AND expires_at > datetime('now')`,
        args: [hash],
      });
      if (session.rows.length === 0) {
        res.status(401).json({ error: "Session expired — sign in again" });
        return;
      }
      next();
    } catch (e) {
      logger.error("[admin] auth check failed:", e);
      res.status(500).json({ error: "Internal Server Error" });
    }
  };

  // ---- login / logout ----
  app.post(`${base}/login`, async (req: Request, res: Response) => {
    try {
      const ip = req.ip || "unknown";
      if (tooManyAttempts(ip)) {
        res.status(429).json({ error: "Too many attempts — try again later" });
        return;
      }
      const given =
        typeof req.body?.password === "string" ? req.body.password : "";
      if (!given || !safeEqual(given, password)) {
        res.status(401).json({ error: "Wrong password" });
        return;
      }

      loginAttempts.delete(ip);
      const token = crypto.randomBytes(32).toString("hex");
      await turso.execute({
        sql: `INSERT INTO admin_sessions (token_hash, expires_at)
              VALUES (?, datetime('now', '+${SESSION_TTL_SECONDS} seconds'))`,
        args: [tokenHash(token, password)],
      });
      res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: ENV === "production",
        maxAge: SESSION_TTL_SECONDS * 1000,
        path: base,
      });
      res.json({ ok: true });
    } catch (e) {
      logger.error("[admin] login failed:", e);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  app.post(
    `${base}/logout`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
        if (token) {
          await turso.execute({
            sql: `DELETE FROM admin_sessions WHERE token_hash = ?`,
            args: [tokenHash(token, password)],
          });
        }
        // opportunistic cleanup of expired sessions
        await turso.execute(
          `DELETE FROM admin_sessions WHERE expires_at < datetime('now')`,
        );
      } catch (e) {
        logger.warn("[admin] logout cleanup failed:", e);
      }
      res.clearCookie(SESSION_COOKIE, { path: base });
      res.json({ ok: true });
    },
  );

  // ---- panel shell (UI only — every data endpoint below requires auth) ----
  app.get(base, (_req: Request, res: Response) => {
    res.type("html").send(adminPanelHtml());
  });

  // ---- overview: totals, 30-day pulse, surface split, top actions ----
  // cached for 60s — the panel re-requests it on every visit
  app.get(
    `${base}/api/overview`,
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const data = await cached("overview", 60_000, async () => {
        const results = await turso.batch(
          [
            { sql: `SELECT COUNT(*) n FROM botusers`, args: [] },
            {
              sql: `SELECT COUNT(*) n FROM botusers WHERE last_seen >= datetime('now', '-1 day')`,
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
              sql: `SELECT date(created_at) d, COUNT(*) actions, COUNT(DISTINCT user_id) users,
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
              sql: `SELECT strftime('%H', created_at) h, COUNT(*) actions,
                           COUNT(DISTINCT user_id) users,
                           SUM(CASE WHEN action = 'daily_checkin' THEN 1 ELSE 0 END) checkins
                    FROM activity_log
                    WHERE created_at >= datetime('now', 'start of day')
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
        });

        res.json(data);
      } catch (e) {
        logger.error("[admin] overview failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );

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

        const where = q
          ? `WHERE u.username LIKE ? OR u.first_name LIKE ?
             OR CAST(u.user_id AS TEXT) LIKE ? OR COALESCE(t.rollNo, '') LIKE ?`
          : "";
        const like = `%${q}%`;
        const orderBy =
          sort === "total" ? "u.total_actions DESC" : "u.last_seen DESC";

        // every keystroke lands here (debounced client-side) — 20s per query
        const data = await cached(
          `users:${q}:${sort}:${limit}`,
          20_000,
          async () => {
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

            return {
              users: result.rows.map((r) => ({
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
              })),
            };
          },
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
              sql: `SELECT date(created_at) d, COUNT(*) n FROM activity_log
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
          profile: {
            userId,
            username: row.username ? String(row.username) : null,
            firstName: row.first_name ? String(row.first_name) : null,
            rollNo: row.rollNo ? String(row.rollNo) : null,
            firstSeen: String(row.first_seen),
            lastSeen: String(row.last_seen),
            privateActions: Number(row.private_actions),
            channelActions: Number(row.channel_actions),
            groupActions: Number(row.group_actions),
            totalActions: Number(row.total_actions),
          },
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
      } catch (e) {
        logger.error("[admin] user detail failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );

  // ---- live feed ----
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

  // ---- health: same data the public /api/status serves ----
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

  logger.info(`[admin] panel mounted at ${base}`);
};
