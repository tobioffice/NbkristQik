/** "1 unit" / "3 units": the one piece of grammar the shelf needs. */
export const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? "" : "s"}`;
