import {
  addBlockedKeyword,
  listBlockedKeywords,
  removeBlockedKeyword,
  type BlockedKeywordRow,
} from "../../db/chatModeration.model.js";
import { compileKeywordList, findKeywordHits } from "./matcher.js";
import { logger } from "../../config/logger.js";

/**
 * The live blocked-word list.
 *
 * The bot checks this on every group message, so the compiled list is cached
 * for 30 seconds; the panel's add and remove paths invalidate it at once. A
 * phrase is accepted as text, not regex, so a bad entry can never run the
 * matcher into a pathological case.
 */

export interface ActiveKeywords {
  rows: BlockedKeywordRow[];
  compiled: ReturnType<typeof compileKeywordList>;
}

/** A phrase the admin tried to add that cannot be stored. */
export class KeywordError extends Error {}

const MIN_PHRASE_LENGTH = 2;
const MAX_PHRASE_LENGTH = 60;
const CACHE_TTL_MS = 30_000;

let cache: { active: ActiveKeywords; at: number } | null = null;

/**
 * Trims a phrase to what will be stored: one line, collapsed spaces. Returns
 * null when the text is too short, too long or carries control characters.
 */
export const sanitizeKeyword = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const phrase = raw
    .normalize("NFKC")
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (phrase.length < MIN_PHRASE_LENGTH || phrase.length > MAX_PHRASE_LENGTH) {
    return null;
  }
  return phrase;
};

const activeFromRows = (rows: BlockedKeywordRow[]): ActiveKeywords => ({
  rows,
  compiled: compileKeywordList(rows.map((row) => row.phrase)),
});

/** The blocked words and their compiled form, cached briefly. */
export const getActiveKeywords = async (
  force = false,
): Promise<ActiveKeywords> => {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.active;
  }
  const active = activeFromRows(await listBlockedKeywords());
  cache = { active, at: Date.now() };
  return active;
};

/** Drops the cache; call after any write from this process. */
export const invalidateKeywordCache = (): void => {
  cache = null;
};

/** The blocked phrases in one message; empty when it is clean. */
export const matchBlockedWords = async (text: string): Promise<string[]> => {
  if (!text) return [];
  const { compiled } = await getActiveKeywords();
  return findKeywordHits(text, compiled);
};

/**
 * Adds one phrase. Throws `KeywordError` for text that cannot be a phrase, and
 * returns `created: false` when the list already has it.
 */
export const addKeyword = async (
  raw: unknown,
): Promise<{ created: boolean; active: ActiveKeywords }> => {
  const phrase = sanitizeKeyword(raw);
  if (!phrase) {
    throw new KeywordError(
      `Use 2 to ${MAX_PHRASE_LENGTH} characters on one line.`,
    );
  }

  const row = await addBlockedKeyword(phrase);
  // never log the phrase itself: it is explicit content by definition
  if (row) logger.info("[moderation] blocked word added");
  cache = null;
  return { created: Boolean(row), active: await getActiveKeywords(true) };
};

/** Removes one phrase; false when it was already gone. */
export const removeKeyword = async (
  id: number,
): Promise<{ removed: boolean; active: ActiveKeywords }> => {
  const removed = await removeBlockedKeyword(id);
  if (removed) logger.info(`[moderation] blocked word removed: #${id}`);
  cache = null;
  return { removed, active: await getActiveKeywords(true) };
};
