import { describe, expect, it } from "vitest";
import {
  differentOrder,
  pickQuestionIds,
  shuffleIds,
} from "../../src/games/selection.js";

const pool = Array.from({ length: 30 }, (_, index) => index + 1);

describe("question selection", () => {
  it("draws the requested count without repeats", () => {
    const picked = pickQuestionIds(pool, 10, () => 0.42);

    expect(picked).toHaveLength(10);
    expect(new Set(picked).size).toBe(10);
    expect(picked.every((id) => pool.includes(id))).toBe(true);
  });

  it("can draw a different set for a different shuffle", () => {
    const first = pickQuestionIds(pool, 10, () => 0);
    const second = pickQuestionIds(pool, 10, () => 0.999);

    expect(first).not.toEqual(second);
  });

  it("returns fewer than ten when the pool is short", () => {
    const picked = pickQuestionIds(pool.slice(0, 4), 10, () => 0.42);

    expect(picked).toHaveLength(4);
    expect(new Set(picked).size).toBe(4);
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
