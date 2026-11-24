import { describe, expect, it } from "vitest";
import {
  differentOrder,
  pickFreshQuestionIds,
  shuffleIds,
} from "../../src/games/selection.js";

const pool = Array.from({ length: 30 }, (_, index) => index + 1);
const bank = Array.from({ length: 100 }, (_, index) => index + 1);

describe("question selection", () => {
  it("draws the requested count without repeats from the day's pool", () => {
    const { ids, repeated } = pickFreshQuestionIds({
      pool,
      bank,
      seen: [],
      count: 10,
      random: () => 0.42,
    });

    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    expect(ids.every((id) => pool.includes(id))).toBe(true);
    expect(repeated).toEqual([]);
  });

  it("can draw a different set for a different shuffle", () => {
    const first = pickFreshQuestionIds({
      pool,
      bank,
      seen: [],
      count: 10,
      random: () => 0,
    });
    const second = pickFreshQuestionIds({
      pool,
      bank,
      seen: [],
      count: 10,
      random: () => 0.999,
    });

    expect(first.ids).not.toEqual(second.ids);
  });

  it("never draws a question the player has already seen", () => {
    const seen = Array.from({ length: 20 }, (_, index) => index + 1);
    const { ids, repeated } = pickFreshQuestionIds({
      pool,
      bank,
      seen,
      count: 10,
    });

    // the pool still holds ten unseen questions (21..30), so no fill is needed
    expect(ids).toHaveLength(10);
    expect(ids.some((id) => seen.includes(id))).toBe(false);
    expect(ids.every((id) => id > 20 && id <= 30)).toBe(true);
    expect(repeated).toEqual([]);
  });

  it("fills a shortfall from the rest of the bank", () => {
    // only five of today's pool are unseen, so five come from the bank
    const seen = Array.from({ length: 25 }, (_, index) => index + 1);
    const { ids, repeated } = pickFreshQuestionIds({
      pool,
      bank,
      seen,
      count: 10,
      random: () => 0.42,
    });

    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    expect(ids.some((id) => seen.includes(id))).toBe(false);
    expect(ids.filter((id) => pool.includes(id))).toHaveLength(5);
    expect(ids.filter((id) => !pool.includes(id))).toHaveLength(5);
    expect(repeated).toEqual([]);
  });

  it("reuses the questions seen longest ago only when the bank is exhausted", () => {
    // newest first: question 1 was seen longest ago
    const seen = [...bank].reverse();
    const { ids, repeated } = pickFreshQuestionIds({
      pool,
      bank,
      seen,
      count: 10,
    });

    expect(ids).toHaveLength(10);
    expect(repeated).toHaveLength(10);
    expect(new Set(ids)).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  });

  it("returns fewer than requested when the bank cannot fill the run", () => {
    const { ids } = pickFreshQuestionIds({
      pool: [],
      bank: [1, 2, 3],
      seen: [],
      count: 10,
    });

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("shuffles a copy without changing the input", () => {
    const source = [...pool];
    const shuffled = shuffleIds(source, () => 0);

    expect(source).toEqual(pool);
    expect(shuffled).not.toEqual(source);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(pool);
  });

  it("keeps a duel's set but never its order", () => {
    const opponent = differentOrder(pool, pool, () => 0.999);

    expect([...opponent].sort((a, b) => a - b)).toEqual(pool);
    expect(opponent).not.toEqual(pool);
  });

  it("leaves a one-question set alone", () => {
    expect(differentOrder([7], [7], () => 0.5)).toEqual([7]);
  });
});
