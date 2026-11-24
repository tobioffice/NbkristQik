/**
 * Question selection for the league.
 *
 * The daily round holds a pool larger than one run. Normal play draws its own
 * subset from that pool, so two students do not sit the same paper. A duel
 * keeps the challenger's set but shuffles the opponent's order, so the same
 * questions cannot arrive in the same sequence.
 */

export type RandomSource = () => number;

const randInt = (random: RandomSource, max: number): number =>
  Math.min(max - 1, Math.floor(random() * max));

/** A shuffled copy of `ids`. */
export const shuffleIds = (
  ids: number[],
  random: RandomSource = Math.random,
): number[] => {
  const copy = [...ids];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapWith = randInt(random, index + 1);
    [copy[index], copy[swapWith]] = [copy[swapWith], copy[index]];
  }
  return copy;
};

/**
 * The same set as `original`, in a different order when it has two or more
 * questions. A one-question duel has no other order to offer.
 */
export const differentOrder = (
  ids: number[],
  original: number[],
  random: RandomSource = Math.random,
): number[] => {
  if (ids.length < 2) return [...ids];

  const shuffled = shuffleIds(ids, random);
  const sameOrder = shuffled.every((id, index) => id === original[index]);
  if (!sameOrder) return shuffled;

  // A rotation is still the same set and is guaranteed to differ.
  return [...shuffled.slice(1), shuffled[0]];
};

/** What a fresh run needs: the day's pool, the whole bank and what's been seen. */
export interface FreshRunInput {
  /** The day's shared pool; its unseen questions are the first choice. */
  pool: number[];
  /** Every active question id, used when the pool runs dry. */
  bank: number[];
  /** The player's already-seen questions, most recently seen first. */
  seen: number[];
  count: number;
  random?: RandomSource;
}

export interface FreshRun {
  ids: number[];
  /**
   * Questions reused only because the bank had no unseen question left.
   * Empty in normal play; the admin should grow the bank when it fires.
   */
  repeated: number[];
}

/**
 * A run that contains no question the player has seen before, while the bank
 * can still afford one.
 *
 * The day's pool is the preferred source, so the day still has a common
 * character. A player who has seen too much of it gets the shortfall from the
 * rest of the bank instead of a repeated question. Only when the whole bank
 * has no unseen question left does the run fall back to the questions seen
 * longest ago, which is the one place a repeat can appear.
 */
export const pickFreshQuestionIds = ({
  pool,
  bank,
  seen,
  count,
  random = Math.random,
}: FreshRunInput): FreshRun => {
  const wanted = Math.max(0, Math.floor(count));
  const seenSet = new Set(seen);
  const bankSet = new Set(bank);
  const poolSet = new Set(pool);
  const chosen: number[] = [];
  const chosenSet = new Set<number>();

  const take = (ids: number[]): void => {
    for (const id of shuffleIds(ids, random)) {
      if (chosen.length >= wanted) return;
      if (chosenSet.has(id)) continue;
      chosen.push(id);
      chosenSet.add(id);
    }
  };

  take(pool.filter((id) => !seenSet.has(id)));
  if (chosen.length < wanted) {
    take(bank.filter((id) => !seenSet.has(id) && !poolSet.has(id)));
  }

  const repeated: number[] = [];
  if (chosen.length < wanted) {
    // Nothing unseen is left anywhere: reuse the oldest seen questions.
    for (const id of [...seen].reverse()) {
      if (chosen.length >= wanted) break;
      if (chosenSet.has(id) || !bankSet.has(id)) continue;
      chosen.push(id);
      chosenSet.add(id);
      repeated.push(id);
    }
  }

  return { ids: chosen, repeated };
};
