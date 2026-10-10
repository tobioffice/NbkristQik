import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { turso } from "../../db/db.js";
import { logger } from "../../config/logger.js";

export const SESSION_TTL_SECONDS = 24 * 60 * 60;
export const SESSION_COOKIE = "qik_admin";
const MAX_LOGIN_ATTEMPTS = 5; // per IP per window
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

// keep the attacker-facing map bounded — sweep expired entries once it grows
const pruneLoginAttempts = (now: number) => {
  if (loginAttempts.size <= 1000) return;
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.resetAt) loginAttempts.delete(ip);
  }
};

export const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
};

export const parseCookies = (
  header: string | undefined,
): Record<string, string> => {
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
export const tokenHash = (token: string, password: string): string =>
  crypto.createHmac("sha256", password).update(token).digest("hex");

export const tooManyAttempts = (ip: string): boolean => {
  const now = Date.now();
  pruneLoginAttempts(now);
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_LOGIN_ATTEMPTS;
};

export const clearLoginAttempts = (ip: string): void => {
  loginAttempts.delete(ip);
};

export type RequireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

/** Express middleware factory: rejects requests without a valid session. */
export const createRequireAdmin =
  (password: string): RequireAdmin =>
  async (req, res, next): Promise<void> => {
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
