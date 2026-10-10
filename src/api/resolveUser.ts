import type { Request } from "express";
import { verifyInitData, type TgInitUser } from "../services/telegramAuth.js";
import { ENV } from "../config/environmentals.js";

/**
 * Resolve (and authenticate) the Telegram user behind an API request.
 *
 * In production the caller must prove it's the Telegram client it claims to
 * be: userId is only trusted when it comes signed inside Telegram WebApp
 * initData. Outside production a bare numeric userId query/body field is
 * accepted as a dev convenience.
 *
 * Reads req.query.initData first, then req.body (so POST JSON bodies work).
 * Returns { userId, user? } on success, { userId: "", error } on a presented-
 * but-invalid identity, or null when no identity was presented at all.
 * `user` carries the verified Telegram profile (id, first_name, username) so
 * callers can show or announce who is acting.
 */
export const resolveUserId = (
  req: Request,
): { userId: string; error?: string; user?: TgInitUser } | null => {
  const initData =
    (req.query.initData as string | undefined) ??
    (typeof req.body?.initData === "string" ? req.body.initData : undefined);

  // Authenticated Telegram initData is tiny; reject oversized input early.
  if (initData && initData.length > 4096) {
    return { userId: "", error: "Invalid Telegram signature" };
  }
  if (initData) {
    const user = verifyInitData(initData);
    if (!user) return { userId: "", error: "Invalid Telegram signature" };
    return { userId: String(user.id), user };
  }

  // Dev convenience: a browser outside Telegram may pass userId directly.
  if (ENV !== "production") {
    const raw =
      (req.query.userId as string | undefined) ??
      (typeof req.body?.userId === "string" ? req.body.userId : undefined);
    if (raw && /^\d{1,20}$/.test(raw)) return { userId: raw };
  }
  return null;
};
