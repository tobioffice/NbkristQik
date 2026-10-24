import { describe, it, expect, vi, beforeEach } from "vitest";

const redisGet = vi.fn();
vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => ({ get: redisGet })),
}));
vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: vi.fn(),
}));

const { secondsUntilMidnightIST, isDailyUnlocked, getCheckInLink } =
  await import("../../src/bot/dailyCheckIn.js");

describe("secondsUntilMidnightIST", () => {
  it("returns the seconds from a UTC morning to the next IST midnight", () => {
    // 2026-10-08 00:00 UTC = 05:30 IST -> 18.5h until IST midnight
    const now = new Date("2026-10-08T00:00:00Z");

    expect(secondsUntilMidnightIST(now)).toBe(18.5 * 60 * 60);
  });

  it("rolls over after IST midnight", () => {
    // 2026-10-08 19:00 UTC = 00:30 IST next day -> ~24h until the following midnight
    const now = new Date("2026-10-08T19:00:00Z");

    expect(secondsUntilMidnightIST(now)).toBe(23.5 * 60 * 60);
  });

  it("never returns less than the 60s floor", () => {
    // 2026-10-08 18:29:30 UTC = 23:59:30 IST -> 30s to midnight, floored to 60
    const now = new Date("2026-10-08T18:29:30Z");

    expect(secondsUntilMidnightIST(now)).toBe(60);
  });
});

describe("isDailyUnlocked", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is dormant (unlocked) when no check-in post exists", async () => {
    redisGet.mockResolvedValue(null); // no checkin:post:msgId

    await expect(isDailyUnlocked(1)).resolves.toBe(true);
  });

  it("requires the per-user unlock key once a post exists", async () => {
    redisGet.mockImplementation(async (key: string) =>
      key === "checkin:post:msgId" ? "123" : null,
    );

    await expect(isDailyUnlocked(1)).resolves.toBe(false);
  });

  it("unlocks with the per-user key set", async () => {
    redisGet.mockImplementation(async (key: string) =>
      key === "checkin:post:msgId"
        ? "123"
        : key === "dailyUnlocked:1"
          ? "1"
          : null,
    );

    await expect(isDailyUnlocked(1)).resolves.toBe(true);
  });

  it("fails open when Redis is unavailable", async () => {
    redisGet.mockRejectedValue(new Error("redis down"));

    await expect(isDailyUnlocked(1)).resolves.toBe(true);
  });
});

describe("getCheckInLink", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deep-links to the pinned post when known", async () => {
    redisGet.mockResolvedValue("456");

    await expect(getCheckInLink()).resolves.toBe(
      "https://t.me/test_channel/456",
    );
  });

  it("falls back to the channel root without a message id", async () => {
    redisGet.mockResolvedValue(null);

    await expect(getCheckInLink()).resolves.toBe("https://t.me/test_channel");
  });
});
