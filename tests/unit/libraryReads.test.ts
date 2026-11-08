import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Read bookkeeping: one audit row per reader, document and page per hour,
 * while the burst counter still sees every delivery.
 */

const { store, redisSet, incrBy, recordLibraryRead } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const redisSet = vi.fn(
    async (
      key: string,
      value: string,
      options?: { NX?: boolean; EX?: number },
    ) => {
      if (options?.NX && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
  );
  const incrBy = vi.fn(async (key: string, weight: number) => {
    const next = Number(store.get(key) ?? "0") + weight;
    store.set(key, String(next));
    return next;
  });
  return {
    store,
    redisSet,
    incrBy,
    recordLibraryRead: vi.fn(async () => {}),
  };
});

vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => ({
    set: redisSet,
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    incrBy,
    expire: vi.fn(async () => 1),
  })),
}));

vi.mock("../../src/db/library.model.js", () => ({ recordLibraryRead }));

const { notePageRead, watchForBurst } =
  await import("../../src/services/library/reads.js");

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("library read dedupe", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it("writes one audit row for two reads of the same page in the hour", async () => {
    notePageRead("u1", "doc1", 1, "NBK-AAAA-BBBB-CCCC-DDDD");
    notePageRead("u1", "doc1", 1, "NBK-AAAA-BBBB-CCCC-DDDD");
    await settle();

    expect(recordLibraryRead).toHaveBeenCalledTimes(1);
    expect(recordLibraryRead).toHaveBeenCalledWith(
      "u1",
      "doc1",
      1,
      "NBK-AAAA-BBBB-CCCC-DDDD",
    );
  });

  it("keeps the first delivery claim for an hour", async () => {
    notePageRead("u1", "doc1", 1, "tok");
    await settle();

    expect(redisSet).toHaveBeenCalledWith("lib:read:u1:doc1:1", "1", {
      NX: true,
      EX: 3600,
    });
  });

  it("writes a separate row for each page and each reader", async () => {
    notePageRead("u1", "doc1", 1, "tok");
    notePageRead("u1", "doc1", 2, "tok");
    notePageRead("u2", "doc1", 1, "tok");
    await settle();

    expect(recordLibraryRead).toHaveBeenCalledTimes(3);
  });

  it("still records the read when Redis is down", async () => {
    redisSet.mockRejectedValueOnce(new Error("redis down"));

    notePageRead("u1", "doc1", 1, "tok");
    await settle();

    // duplicates are cheaper than a missing audit row
    expect(recordLibraryRead).toHaveBeenCalledTimes(1);
  });

  it("gives the claim back when the audit row cannot be written", async () => {
    recordLibraryRead.mockRejectedValueOnce(new Error("db down"));

    notePageRead("u1", "doc1", 1, "tok");
    await settle();
    expect(recordLibraryRead).toHaveBeenCalledTimes(1);

    // the failed claim must not suppress the row for the rest of the hour
    notePageRead("u1", "doc1", 1, "tok");
    await settle();
    expect(recordLibraryRead).toHaveBeenCalledTimes(2);
  });

  it("counts every delivery in the burst counter, deduped or not", async () => {
    notePageRead("u1", "doc1", 1, "tok");
    notePageRead("u1", "doc1", 1, "tok");
    await watchForBurst("u1");
    await watchForBurst("u1");
    await settle();

    expect(incrBy).toHaveBeenCalledTimes(2);
    expect(recordLibraryRead).toHaveBeenCalledTimes(1);
  });
});
