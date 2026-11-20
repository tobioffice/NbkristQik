import { randomBytes } from "node:crypto";

/**
 * Short-lived storage for the rank card the phone drew.
 *
 * Telegram fetches `photo_url` and `shareToStory` media from its own servers,
 * so the card needs a public HTTPS URL; the upload is the only way to give it
 * one. A card is a snapshot, never an archive: it lives for thirty minutes,
 * one per account, and the URL is a random token that cannot be guessed or
 * listed.
 *
 * The production host runs one API process. Keeping the bytes in memory means
 * no files to sweep and no Redis round trip on the image path; a restart just
 * expires the cards early.
 */

const TTL_MS = 30 * 60 * 1000;
/** Keep the whole store well under the small host's memory budget. */
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_CARDS = 400;

export interface StoredRankCard {
  id: string;
  userId: string;
  bytes: Buffer;
  /** Absolute public URL Telegram fetches. */
  url: string;
  expiresAt: number;
}

const cards = new Map<string, StoredRankCard>();
const byUser = new Map<string, string>();

const purgeExpired = (now: number): void => {
  for (const [id, card] of cards) {
    if (card.expiresAt <= now) {
      cards.delete(id);
      if (byUser.get(card.userId) === id) byUser.delete(card.userId);
    }
  }
};

const totalBytes = (): number => {
  let total = 0;
  for (const card of cards.values()) total += card.bytes.length;
  return total;
};

/**
 * Store one card for a user, replacing any card they already had.
 * `baseUrl` is the request origin, e.g. `https://checker.tobioffice.online`.
 */
export const putRankCard = ({
  userId,
  bytes,
  baseUrl,
}: {
  userId: string;
  bytes: Buffer;
  baseUrl: string;
}): { id: string; url: string } => {
  const now = Date.now();
  purgeExpired(now);

  const previous = byUser.get(userId);
  if (previous) {
    cards.delete(previous);
    byUser.delete(userId);
  }

  // A token, not a sequence: the URL is public and must not be enumerable.
  const id = randomBytes(24).toString("base64url");
  const url = `${baseUrl.replace(/\/+$/, "")}/api/rank/card/${id}.jpg`;
  const card: StoredRankCard = {
    id,
    userId,
    bytes,
    url,
    expiresAt: now + TTL_MS,
  };

  cards.set(id, card);
  byUser.set(userId, id);

  // Oldest insertion first. One user cannot flood the store (their previous
  // card is replaced above), but a class can still fill it in a minute.
  while (cards.size > MAX_CARDS || totalBytes() > MAX_BYTES) {
    const oldest = cards.keys().next().value;
    if (oldest == null) break;
    const removed = cards.get(oldest);
    cards.delete(oldest);
    if (removed && byUser.get(removed.userId) === oldest) {
      byUser.delete(removed.userId);
    }
  }

  return { id, url };
};

/** A live card, or null when it expired or never existed. */
export const getRankCard = (id: string): StoredRankCard | null => {
  const card = cards.get(id);
  if (!card) return null;
  if (card.expiresAt <= Date.now()) {
    cards.delete(id);
    if (byUser.get(card.userId) === id) byUser.delete(card.userId);
    return null;
  }
  return card;
};

/** The caller's current card, if they uploaded one. */
export const getRankCardForUser = (userId: string): StoredRankCard | null => {
  const id = byUser.get(userId);
  return id ? getRankCard(id) : null;
};

/** Tests only: start each suite with an empty store. */
export const clearRankCardStore = (): void => {
  cards.clear();
  byUser.clear();
};
