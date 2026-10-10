import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { turso } from "../../db/db.js";
import { ENV } from "../../config/environmentals.js";
import { logger } from "../../config/logger.js";
import {
  SESSION_TTL_SECONDS,
  SESSION_COOKIE,
  safeEqual,
  parseCookies,
  tokenHash,
  tooManyAttempts,
  clearLoginAttempts,
  type RequireAdmin,
} from "./auth.js";

/** Mounts POST {base}/login and POST {base}/logout. */
export const registerLoginRoutes = (
  app: Express,
  base: string,
  password: string,
  requireAdmin: RequireAdmin,
): void => {
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

      clearLoginAttempts(ip);
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
};
