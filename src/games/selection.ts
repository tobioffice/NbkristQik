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

/** `count` IDs from `ids`, in a fresh random order, without repeats. */
export const pickQuestionIds = (
  ids: number[],
  count: number,
  random: RandomSource = Math.random,
): number[] => {
  const wanted = Math.max(0, Math.min(Math.floor(count), ids.length));
  return shuffleIds(ids, random).slice(0, wanted);
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
