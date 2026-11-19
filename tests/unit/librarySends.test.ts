import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The send window is armed atomically before it is counted, and a window
 * that lost its TTL (a crash between the old INCR and EXPIRE) is repaired,
 * so a reader can never be told "try again in 60 min" by a window that
 * never frees.
 */

const { store, ttls, redisSet, incr, expire, ttl } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  return {
    store,
    ttls,
    redisSet: vi.fn(
      async (
        key: string,
        value: string,
        options?: { NX?: boolean; EX?: number },
      ) => {
        if (options?.NX && store.has(key)) return null;
        store.set(key, value);
        if (options?.EX) ttls.set(key, options.EX);
        return "OK";
      },
    ),
    incr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) ?? "0") + 1;
      store.set(key, String(next));
      return next;
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      ttls.set(key, seconds);
      return 1;
    }),
    ttl: vi.fn(async (key: string) =>
      store.has(key) ? (ttls.get(key) ?? -1) : -2,
    ),
  };
});

vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => ({
    set: redisSet,
    incr,
    expire,
    ttl,
  })),
}));

const { chargeDocumentSend, SEND_LIMIT, SEND_WINDOW_SECONDS } =
  await import("../../src/services/library/sends.js");

const keyFor = (userId: string) => `lib:send:${userId}`;

describe("document send limiter", () => {
  beforeEach(() => {
    store.clear();
    ttls.clear();
    vi.clearAllMocks();
  });

  it("allows the budget and arms the window before counting", async () => {
    const userId = "u1";
    for (let i = 0; i < SEND_LIMIT; i += 1) {
      const charge = await chargeDocumentSend(userId);
      expect(charge).toEqual({ allowed: true, retryAfter: 0 });
    }

    // one atomic arm: a crash between the count and the timer cannot leave
    // a TTL-less key
    expect(redisSet).toHaveBeenCalledWith(keyFor(userId), "0", {
      NX: true,
      EX: SEND_WINDOW_SECONDS,
    });
    expect(incr).toHaveBeenCalledTimes(SEND_LIMIT);
    expect(ttls.get(keyFor(userId))).toBe(SEND_WINDOW_SECONDS);
  });

  it("denies the next send with the window's remaining time", async () => {
    const userId = "u2";
    for (let i = 0; i < SEND_LIMIT; i += 1) {
      await chargeDocumentSend(userId);
    }

    const charge = await chargeDocumentSend(userId);
    expect(charge.allowed).toBe(false);
    expect(charge.retryAfter).toBe(SEND_WINDOW_SECONDS);
  });

  it("repairs a window that lost its TTL instead of locking the reader out", async () => {
    const userId = "u3";
    const key = keyFor(userId);

    // a pre-arm key: over budget and no TTL, as a crash between the old
    // INCR and EXPIRE would leave it
    store.set(key, String(SEND_LIMIT + 1));
    ttls.delete(key);

    const charge = await chargeDocumentSend(userId);
    expect(charge.allowed).toBe(false);
    expect(charge.retryAfter).toBe(SEND_WINDOW_SECONDS);
    expect(expire).toHaveBeenCalledWith(key, SEND_WINDOW_SECONDS);
    expect(ttls.get(key)).toBe(SEND_WINDOW_SECONDS);
  });

  it("fails open when Redis is unavailable", async () => {
    const { getClient } =
      await import("../../src/services/redis/getRedisClient.js");
    vi.mocked(getClient).mockRejectedValueOnce(new Error("redis down"));

    const charge = await chargeDocumentSend("u4");
    expect(charge).toEqual({ allowed: true, retryAfter: 0 });
  });
});
