import crypto from "crypto";
import { LIBRARY_WATERMARK_SECRET } from "../../config/environmentals.js";

/**
 * Download links the Telegram client can fetch by itself.
 *
 * `WebApp.downloadFile` (Bot API 8.0) hands a URL to the client, and the
 * client's downloader has no cookie jar: the session cookie belongs to the
 * webview. So a download carries its own proof instead — an HMAC over the
 * reader and the document, good for a few minutes.
 *
 * The link is not a session: it names one document for one reader, it cannot
 * read a page, and it dies quickly enough that a pasted URL is not a way in.
 */

/** Long enough to reach the client's downloader, short enough to be useless later. */
export const DOWNLOAD_TOKEN_TTL_MS = 5 * 60 * 1000;

/** Same secret as the watermark: a download is attributable to the same reader. */
const secret = (): string => LIBRARY_WATERMARK_SECRET;

const signature = (
  key: string,
  userId: string,
  documentId: string,
  expires: number,
): string =>
  crypto
    .createHmac("sha256", key)
    .update(`library-download:${userId}:${documentId}:${expires}`)
    .digest("base64url");

const sameSignature = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

/** A link token for one reader and one document, or null with no secret. */
export const mintDownloadToken = (
  userId: string,
  documentId: string,
  now = Date.now(),
): string | null => {
  const key = secret();
  if (!key) return null;
  const expires = now + DOWNLOAD_TOKEN_TTL_MS;
  const payload = Buffer.from(`${userId}:${expires}`, "utf8").toString(
    "base64url",
  );
  return `${payload}.${signature(key, userId, documentId, expires)}`;
};

/**
 * The reader a token was minted for, or null if it is expired, forged, or was
 * minted for another document.
 */
export const verifyDownloadToken = (
  token: string | undefined,
  documentId: string,
  now = Date.now(),
): string | null => {
  const key = secret();
  if (!key || !token) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const provided = token.slice(dot + 1);

  let decoded: string;
  try {
    decoded = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const split = decoded.lastIndexOf(":");
  if (split <= 0) return null;
  const userId = decoded.slice(0, split);
  const expires = Number(decoded.slice(split + 1));

  if (!userId || !Number.isFinite(expires) || expires <= now) return null;
  if (!sameSignature(provided, signature(key, userId, documentId, expires))) {
    return null;
  }
  return userId;
};
