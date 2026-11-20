import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRankCardStore,
  getRankCard,
  getRankCardForUser,
  putRankCard,
} from "../../src/services/rankCardStore.js";

const jpeg = (size = 16): Buffer => {
  const bytes = Buffer.alloc(size, 0);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  return bytes;
};

beforeEach(() => {
  clearRankCardStore();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rank card store", () => {
  it("stores a card under an unguessable URL", () => {
    const card = putRankCard({
      userId: "42",
      bytes: jpeg(),
      baseUrl: "https://checker.test/",
    });

    expect(card.id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(card.url).toBe(`https://checker.test/api/rank/card/${card.id}.jpg`);
    expect(getRankCard(card.id)?.bytes.length).toBe(16);
    expect(getRankCardForUser("42")?.id).toBe(card.id);
  });

  it("replaces the caller's previous card instead of piling up", () => {
    const first = putRankCard({
      userId: "42",
      bytes: jpeg(),
      baseUrl: "https://checker.test",
    });
    const second = putRankCard({
      userId: "42",
      bytes: jpeg(32),
      baseUrl: "https://checker.test",
    });

    expect(second.id).not.toBe(first.id);
    expect(getRankCard(first.id)).toBeNull();
    expect(getRankCard(second.id)?.bytes.length).toBe(32);
    expect(getRankCardForUser("42")?.id).toBe(second.id);
  });

  it("expires a card after thirty minutes", () => {
    const card = putRankCard({
      userId: "42",
      bytes: jpeg(),
      baseUrl: "https://checker.test",
    });

    vi.setSystemTime(new Date("2026-11-20T10:29:00Z"));
    expect(getRankCard(card.id)).not.toBeNull();

    vi.setSystemTime(new Date("2026-11-20T10:31:00Z"));
    expect(getRankCard(card.id)).toBeNull();
    expect(getRankCardForUser("42")).toBeNull();
  });

  it("does not hand one token to a different id", () => {
    const card = putRankCard({
      userId: "42",
      bytes: jpeg(),
      baseUrl: "https://checker.test",
    });

    expect(getRankCard(`${card.id}x`)).toBeNull();
  });
});
