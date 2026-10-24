import crypto from "crypto";
import { getClient } from "../redis/getRedisClient.js";
import { redisKeys } from "../redis/keys.js";
import { logger } from "../../config/logger.js";

/**
 * Library web app sessions.
 *
 * The student opens the mini app inside Telegram, and Telegram hands the
 * client a signed `initData` blob. The client swaps that blob for a session
 * cookie, and every later call carries only the cookie. That keeps the signed
 * blob out of URLs, out of access logs and out of screenshots of the address
 * bar; the cookie is first-party because the app is served from our own host.
 *
 * The cookie is a bearer token, so it is short-lived and stored server side
 * where it can be dropped.
 */

export const LIBRARY_SESSION_COOKIE = "nbq_lib";
export const LIBRARY_SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface LibrarySession {
  userId: string;
  createdAt: number;
}

/** Mints a session for a verified Telegram user. */
export const createSession = async (userId: string): Promise<string> => {
  const token = crypto.randomBytes(32).toString("base64url");
  const session: LibrarySession = { userId, createdAt: Date.now() };

  try {
    const client = await getClient();
    await client.set(redisKeys.librarySession(token), JSON.stringify(session), {
      EX: LIBRARY_SESSION_TTL_SECONDS,
    });
  } catch (e) {
    logger.error("[library] could not start a session:", e);
    throw e;
  }
  return token;
};

/** Reads a session token. Returns null for an unknown or expired token. */
export const readSession = async (
  token: string | undefined,
): Promise<LibrarySession | null> => {
  if (!token) return null;
  try {
    const client = await getClient();
    const raw = await client.get(redisKeys.librarySession(token));
    if (!raw) return null;
    const session = JSON.parse(raw) as LibrarySession;
    return session?.userId ? session : null;
  } catch (e) {
    logger.warn("[library] session read failed:", e);
    return null;
  }
};

/** Ends a session. */
export const dropSession = async (token: string): Promise<void> => {
  try {
    const client = await getClient();
    await client.del(redisKeys.librarySession(token));
  } catch (e) {
    logger.warn("[library] session drop failed:", e);
  }
};

/** Reads one cookie out of a request's Cookie header. */
export const readCookie = (
  header: string | undefined,
  name: string,
): string | undefined => {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
};
