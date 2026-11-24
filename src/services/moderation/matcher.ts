/**
 * How a blocked phrase is matched against a chat message.
 *
 * A plain `includes()` would miss every evasion a student actually types
 * ("f.u.c.k", "fuckk", "s e x", "s3x") and would catch innocent words
 * ("chutney" for "chut", "Sussex" for "sex"). So the message is tokenised on
 * everything that is not a letter, number or combining mark, each token is
 * lowered, NFKC-normalised, leet letters are folded and runs of the same
 * letter collapse; then a blocked phrase matches only a whole token (or a
 * whole run of single-letter tokens, for "s e x").
 *
 * The one deliberate limit: entries are exact words, not stems. "sex" does not
 * match "sexting" unless "sexting" is also listed. Seeding the variants is the
 * price of never removing "chutney".
 */

/** Letters students substitute for: f0ck, s3x, $ex, @sshole. */
const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  $: "s",
  "@": "a",
};

/** One blocked phrase in the form matching compares against. */
export interface CompiledKeywords {
  /** Single-token phrases by normalised token. */
  single: Map<string, string>;
  /** Multi-word phrases, in normalised token order. */
  multi: { tokens: string[]; phrase: string }[];
}

/** Splits text into words; combining marks stay with their letter. */
export const tokenize = (text: string): string[] =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}\p{M}$@]+/u)
    .filter(Boolean);

/** Folds one token to the form blocked phrases are stored in. */
export const normalizeToken = (token: string): string =>
  token
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[013457$@]/g, (char) => LEET[char] ?? char)
    .replace(/(.)\1+/gu, "$1");

/** The normalised tokens of one blocked phrase. */
export const normalizePhrase = (phrase: string): string[] =>
  tokenize(phrase).map(normalizeToken).filter(Boolean);

/** Prepares the stored phrases for matching; cheap to keep until they change. */
export const compileKeywordList = (
  phrases: readonly string[],
): CompiledKeywords => {
  const single = new Map<string, string>();
  const multi: { tokens: string[]; phrase: string }[] = [];

  for (const phrase of phrases) {
    const tokens = normalizePhrase(phrase);
    if (tokens.length === 0) continue;
    if (tokens.length === 1) {
      if (!single.has(tokens[0])) single.set(tokens[0], phrase.trim());
      continue;
    }
    multi.push({ tokens, phrase: phrase.trim() });
  }

  return { single, multi };
};

/**
 * The blocked phrases found in `text`, in the words the admin listed. An
 * empty list means the message is clean.
 */
export const findKeywordHits = (
  text: string,
  keywords: CompiledKeywords,
): string[] => {
  if (!text) return [];
  const tokens = tokenize(text).map(normalizeToken);
  if (tokens.length === 0) return [];

  const hits = new Set<string>();

  for (const token of tokens) {
    const hit = keywords.single.get(token);
    if (hit) hits.add(hit);
  }

  for (const entry of keywords.multi) {
    const size = entry.tokens.length;
    for (let start = 0; start + size <= tokens.length; start++) {
      let matched = true;
      for (let offset = 0; offset < size; offset++) {
        if (tokens[start + offset] !== entry.tokens[offset]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        hits.add(entry.phrase);
        break;
      }
    }
  }

  // "s e x": a run of single letters that spells a blocked word. Runs are
  // rare in ordinary text, and only an exact match counts, so "i a m" is
  // safe.
  let run: string[] = [];
  const flushRun = () => {
    if (run.length >= 2 && run.length <= 24) {
      const hit = keywords.single.get(normalizeToken(run.join("")));
      if (hit) hits.add(hit);
    }
    run = [];
  };
  for (const token of tokens) {
    if (token.length === 1) run.push(token);
    else flushRun();
  }
  flushRun();

  return [...hits];
};
