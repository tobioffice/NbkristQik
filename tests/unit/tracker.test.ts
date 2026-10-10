import { describe, it, expect, beforeEach, vi } from "vitest";

const redisSet = vi.fn();
vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => ({ set: redisSet })),
}));

const tursoBatch = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/db/db.js", () => ({
  turso: { batch: (...args: unknown[]) => tursoBatch(...args) },
}));

const { trackActivity } = await import("../../src/services/tracker.js");

// trackActivity is fire-and-forget; give the microtask queue a tick
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("trackActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisSet.mockResolvedValue("OK");
    tursoBatch.mockResolvedValue(undefined);
  });

  it("always writes the activity_log row and the profile when the NX gate wins", async () => {
    trackActivity({
      userId: 42,
      username: "alice",
      firstName: "Alice",
      chatType: "private",
      action: "command:start",
    });
    await flush();

    expect(tursoBatch).toHaveBeenCalledTimes(1);
    const [statements] = tursoBatch.mock.calls[0] as [Array<{ sql: string }>];
    expect(statements).toHaveLength(2);
    expect(statements[0].sql).toContain("INSERT INTO botusers");
    expect(statements[1].sql).toContain("INSERT INTO activity_log");
    expect(redisSet).toHaveBeenCalledWith("track:p:42", "1", {
      EX: 60,
      NX: true,
    });
  });

  it("skips the profile upsert when the NX gate is held", async () => {
    redisSet.mockResolvedValue(null); // SET NX lost — another writer owns it
    trackActivity({
      userId: 42,
      chatType: "group",
      action: "attendance",
    });
    await flush();

    const [statements] = tursoBatch.mock.calls[0] as [Array<{ sql: string }>];
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toContain("INSERT INTO activity_log");
  });

  it("normalizes supergroup to group before storage", async () => {
    trackActivity({ userId: 7, chatType: "supergroup", action: "midmarks" });
    await flush();

    const [statements] = tursoBatch.mock.calls[0] as [
      Array<{ sql: string; args: unknown[] }>,
    ];
    expect(statements[1].args[1]).toBe("group");
  });

  it("never rejects when the database write fails", async () => {
    tursoBatch.mockRejectedValue(new Error("db down"));

    expect(() =>
      trackActivity({ userId: 1, chatType: "private", action: "x" }),
    ).not.toThrow();
    await flush();
  });
});
