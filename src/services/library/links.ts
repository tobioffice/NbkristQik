import crypto from "crypto";
import { getClient } from "../redis/getRedisClient.js";
import { redisKeys } from "../redis/keys.js";
import { logger } from "../../config/logger.js";
import type { LibrarySessionKind } from "./session.js";

/**
 * A link to one stamped PDF, for the platform's own viewer.
 *
 * The PDF action hands the file to the phone or the system browser
 * (`WebApp.openLink`), whose native viewer zooms smoothly without a viewer we
 * ship. That browser has its own cookie jar, so the library session cookie is
 * not there. This link stands in for it: an opaque random token in Redis,
 * bound to one reader and one document, good for an hour.
 *
 * It is not a session. It opens nothing but this document, the bytes it
 * serves are stamped for the reader who minted it, and it expires on its own.
 * The token is in the address bar and in access logs, so it stays
 * short-lived; journal queries stay keyword/count-only.
 *
 * A token is reused while it lives: tapping PDF twice does not invalidate the
 * copy the first tap opened, and a viewer that asks for byte ranges keeps
 * working. The `current` key is the handle that lets a later mint find it.
 */

/** How long a viewer link lives. A PDF opens in seconds; an hour is slack. */
export const PDF_LINK_TTL_SECONDS = 60 * 60;

export interface DocumentLink {
  userId: string;
  docId: string;
  kind: LibrarySessionKind;
}

const linkKey = (token: string): string => redisKeys.libraryPdfLink(token);
const currentKey = (userId: string, docId: string): string =>
  redisKeys.libraryPdfLinkFor(userId, docId);

/**
 * Mints a viewer link, or returns the live one for this reader and document.
 *
 * A race between two taps can leave a second token alive until it expires,
 * which is harmless: both are bound to the same reader and document, and the
 * reader who holds them may read it anyway.
 */
export const createDocumentLink = async (
  userId: string,
  docId: string,
  kind: LibrarySessionKind,
): Promise<string> => {
  const client = await getClient();

  // reuse the live link, but only when its payload is still there: a partial
  // write must not hand out a token that opens nothing
  const current = await client.get(currentKey(userId, docId));
  if (current && (await client.get(linkKey(current)))) return current;

  const token = crypto.randomBytes(32).toString("base64url");
  const link: DocumentLink = { userId, docId, kind };

  await client.set(linkKey(token), JSON.stringify(link), {
    EX: PDF_LINK_TTL_SECONDS,
  });
  await client.set(currentKey(userId, docId), token, {
    EX: PDF_LINK_TTL_SECONDS,
  });

  return token;
};

/**
 * Reads a viewer link. Null for an unknown, expired or malformed token, and
 * for a link that names a different document than the request.
 */
export const readDocumentLink = async (
  token: string,
  docId: string,
): Promise<DocumentLink | null> => {
  if (!token) return null;

  let raw: string | null;
  try {
    const client = await getClient();
    raw = await client.get(linkKey(token));
  } catch (e) {
    logger.warn("[library] PDF link read failed:", e);
    return null;
  }
  if (!raw) return null;

  try {
    const link = JSON.parse(raw) as Partial<DocumentLink>;
    if (typeof link.userId !== "string" || !link.userId) return null;
    if (link.docId !== docId) return null;
    return {
      userId: link.userId,
      docId,
      kind: link.kind === "pc" ? "pc" : "telegram",
    };
  } catch {
    // a corrupt value is an absent link, not a 500
    return null;
  }
};
