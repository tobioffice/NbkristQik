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
 * bar. The app is served from our own host, which makes the cookie
 * first-party in the native clients; Telegram Web embeds the app in an
 * iframe, so the cookie is partitioned there (see the attributes below).
 *
 * The cookie is a bearer token, so it is short-lived and stored server side
 * where it can be dropped.
 */

export const LIBRARY_SESSION_COOKIE = "nbq_lib";
export const LIBRARY_SESSION_TTL_SECONDS = 12 * 60 * 60;

/** The attributes the session cookie is set with, and why they matter. */
export interface LibraryCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "none" | "lax";
  /** Partitioned (CHIPS): the token is stored under the embedding site. */
  partitioned: boolean;
  maxAge: number;
  path: string;
}

/**
 * The session cookie's attributes.
 *
 * The native clients show the mini app as a top-level page, where any
 * SameSite value is sent back. Telegram Web is different: it embeds the app
 * in an iframe on web.telegram.org, so every request from it is cross-site,
 * and a `Strict` cookie is stored and then never sent again — the shelf
 * answered 401 on a PC while the same account worked on the phone.
 * `SameSite=None` lets the token travel from that iframe, and `Partitioned`
 * keeps it under the embedding site, so browsers that block third-party
 * cookies still store and send it.
 *
 * `None` is only honoured on a `Secure` cookie, so local http development
 * keeps `Lax`; the deployed app is https and gets the relaxed pair.
 */
export const librarySessionCookieOptions = (
  secure: boolean,
  ttlSeconds = LIBRARY_SESSION_TTL_SECONDS,
): LibraryCookieOptions => ({
  httpOnly: true,
  secure,
  sameSite: secure ? "none" : "lax",
  partitioned: secure,
  maxAge: ttlSeconds * 1000,
  path: "/",
});

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
): string | undefined => readCookies(header, name)[0];

/**
 * Every value the header carries for one name.
 *
 * A browser can hold the same cookie twice: the old unpartitioned one and
 * the new `Partitioned` one live in different jars, and both ride the same
 * request. The first is not necessarily the live one, so callers that verify
 * a token must try each instead of trusting the first match.
 */
export const readCookies = (
  header: string | undefined,
  name: string,
): string[] => {
  if (!header) return [];
  const found: string[] = [];
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try {
      found.push(decodeURIComponent(rest.join("=")));
    } catch {
      // A malformed cookie is absent, not a 500 on every library route.
    }
  }
  return found;
};

/**
 * The first session carried by the request's cookie header, or null.
 *
 * Trying every `nbq_lib` value is what makes the change from `SameSite=Strict`
 * to `Partitioned` non-breaking: a jar that still holds the old cookie must
 * not shadow the new one just because it is listed first.
 */
export const readSessionFromCookies = async (
  header: string | undefined,
): Promise<{ token: string; session: LibrarySession } | null> => {
  for (const token of readCookies(header, LIBRARY_SESSION_COOKIE)) {
    const session = await readSession(token);
    if (session) return { token, session };
  }
  return null;
};
