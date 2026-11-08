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
/** A browser opened by a one-time link is a shorter, shared-machine session. */
export const LIBRARY_PC_SESSION_TTL_SECONDS = 60 * 60;

/**
 * A one-shot link that signs a browser on a PC in. The bot mints it in the
 * chat, so it is short-lived: it exists to cross from Telegram to a desktop
 * browser and is spent on the first exchange.
 */
export const LIBRARY_PC_TOKEN_TTL_SECONDS = 5 * 60;

export type LibrarySessionKind = "telegram" | "pc";

export interface LibrarySession {
  userId: string;
  createdAt: number;
  kind?: LibrarySessionKind;
}

export interface CreateSessionOptions {
  kind?: LibrarySessionKind;
  ttlSeconds?: number;
}

/** Mints a session for a verified Telegram user or a PC link. */
export const createSession = async (
  userId: string,
  options: CreateSessionOptions = {},
): Promise<string> => {
  const token = crypto.randomBytes(32).toString("base64url");
  const ttlSeconds = options.ttlSeconds ?? LIBRARY_SESSION_TTL_SECONDS;
  const session: LibrarySession = {
    userId,
    createdAt: Date.now(),
    kind: options.kind ?? "telegram",
  };

  try {
    const client = await getClient();
    await client.set(redisKeys.librarySession(token), JSON.stringify(session), {
      EX: ttlSeconds,
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

/**
 * Mints a one-shot PC login token for a verified Telegram user.
 *
 * The token travels in a URL the bot sends in the private chat. It maps to the
 * user id server side, so the link itself carries no identity and goes stale
 * in five minutes.
 */
export const createPcLoginToken = async (userId: string): Promise<string> => {
  const token = crypto.randomBytes(32).toString("base64url");
  const client = await getClient();
  await client.set(redisKeys.libraryPcLogin(token), userId, {
    EX: LIBRARY_PC_TOKEN_TTL_SECONDS,
  });
  return token;
};

/**
 * Spends a PC login token and returns the user it was minted for. A second
 * exchange returns null: getDel reads and removes the key atomically, so two
 * browsers cannot spend the same link.
 */
export const consumePcLoginToken = async (
  token: string,
): Promise<string | null> => {
  if (!token) return null;
  try {
    const client = await getClient();
    return await client.getDel(redisKeys.libraryPcLogin(token));
  } catch (e) {
    logger.warn("[library] PC login token read failed:", e);
    return null;
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
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        // A malformed cookie is absent, not a 500 on every library route.
        return undefined;
      }
    }
  }
  return undefined;
};
