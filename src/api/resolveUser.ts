import type { Request } from "express";
import { verifyInitData, type TgInitUser } from "../services/telegramAuth.js";
import { allowDevIdentity } from "../config/environmentals.js";

/** Telegram's own initData is a few hundred bytes; reject anything absurd. */
const MAX_INIT_DATA_LENGTH = 4096;

/** What the request proved about the caller, if anything. */
export type Identity =
  | { status: "anonymous" }
  | { status: "invalid"; error: string }
  | { status: "authenticated"; userId: string; user?: TgInitUser };

const invalid = (): Identity => ({
  status: "invalid",
  error: "Invalid Telegram signature",
});

const readHeaderInitData = (req: Request): string | undefined => {
  const value =
    typeof req.get === "function" ? req.get("X-Telegram-Init-Data") : undefined;
  return typeof value === "string" && value.trim() ? value : undefined;
};

/**
 * Reads the first initData source that is present, in trust order:
 *   1. the `X-Telegram-Init-Data` header (preferred for API clients)
 *   2. the `initData` query parameter (legacy)
 *   3. `initData` in a JSON body (legacy POST shape)
 *
 * Only the first *present* source is used: a bad header must not be ignored
 * just because a valid query string is also attached.
 */
const readInitData = (req: Request): string | undefined =>
  readHeaderInitData(req) ??
  (typeof req.query?.initData === "string" ? req.query.initData : undefined) ??
  (typeof req.body?.initData === "string" ? req.body.initData : undefined);

const readDevUserId = (req: Request): string | undefined => {
  const raw =
    (typeof req.query?.userId === "string" ? req.query.userId : undefined) ??
    (typeof req.body?.userId === "string" ? req.body.userId : undefined);
  return raw && /^\d{1,20}$/.test(raw) ? raw : undefined;
};

/**
 * Resolve the caller's identity, distinguishing "nobody presented anything"
 * (anonymous) from "something was presented but it was bad" (invalid).
 *
 * Authenticated Telegram initData is the only trusted identity in
 * production. The bare numeric userId shortcut exists only when the dev gate
 * is explicitly open (ALLOW_DEV_IDENTITY=1) or under ENV=test — never because
 * ENV merely happens to be "development".
 */
export const resolveOptionalIdentity = (req: Request): Identity => {
  const initData = readInitData(req);

  if (initData) {
    if (initData.length > MAX_INIT_DATA_LENGTH) return invalid();
    const user = verifyInitData(initData);
    if (!user) return invalid();
    return { status: "authenticated", userId: String(user.id), user };
  }

  if (allowDevIdentity()) {
    const userId = readDevUserId(req);
    if (userId) return { status: "authenticated", userId };
  }

  return { status: "anonymous" };
};

/**
 * Resolve (and authenticate) the Telegram user behind an API request.
 *
 * Returns { userId, user? } on success, { userId: "", error } when an
 * identity was presented but could not be verified, or null when no identity
 * was presented at all. Existing callers rely on this shape; new identity-
 * aware public routes should use `resolveOptionalIdentity` instead, which
 * makes the anonymous case explicit.
 */
export const resolveUserId = (
  req: Request,
): { userId: string; error?: string; user?: TgInitUser } | null => {
  const identity = resolveOptionalIdentity(req);
  if (identity.status === "anonymous") return null;
  if (identity.status === "invalid") {
    return { userId: "", error: identity.error };
  }
  return { userId: identity.userId, user: identity.user };
};
