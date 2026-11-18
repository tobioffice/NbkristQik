import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  getOverviewTotals: vi.fn(),
  getUptimeSummary: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock("../../src/db/activityStats.model.js", () => ({
  getOverviewTotals: mocks.getOverviewTotals,
}));
vi.mock("../../src/db/student_stats.model.js", () => ({
  getUptimeSummary: mocks.getUptimeSummary,
}));
vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: mocks.getClient,
}));

type PublicStatsModule = typeof import("../../src/api/publicStats.js");

const totals = {
  users: 3534,
  activeToday: 1131,
  active7d: 2967,
  active30d: 3485,
  commands7d: 60571,
};

const summary = (component: string, pings: number, ups: number) => ({
  component,
  pings,
  ups,
  uptimePct: (ups / pings) * 100,
  lastPing: "2026-11-18 05:00:00",
  lastStatus: "up",
  avgLatencyMs: 12,
});

const cachedPayload = {
  generated_at: "2026-11-18T10:00:00+05:30",
  registered_users: 11,
  dau: 2,
  wau: 3,
  mau: 4,
  commands_7d: 5,
  uptime_90d: "98.0%",
  method: "cached payload",
};

let stats: PublicStatsModule;

const createApp = () => {
  const app = express();
  stats.registerPublicStatsRoutes(app);
  return app;
};

beforeEach(async () => {
  // Reset the module so its process-local fallback cache starts empty.
  vi.resetModules();
  mocks.getOverviewTotals.mockReset();
  mocks.getUptimeSummary.mockReset();
  mocks.getClient.mockReset();
  mocks.getOverviewTotals.mockResolvedValue(totals);
  mocks.getUptimeSummary.mockResolvedValue([summary("api", 100, 99)]);
  stats = await import("../../src/api/publicStats.js");
});

describe("buildPublicStats", () => {
  it("formats generated_at in IST with seconds precision", () => {
    expect(stats.formatIstTimestamp(new Date("2026-11-18T05:00:00.000Z"))).toBe(
      "2026-11-18T10:30:00+05:30",
    );
    expect(stats.formatIstTimestamp(new Date("2026-11-18T18:30:00.987Z"))).toBe(
      "2026-11-19T00:00:00+05:30",
    );
  });

  it("maps the shared totals into exactly the eight public fields", async () => {
    mocks.getUptimeSummary.mockResolvedValue([
      summary("api", 100, 100),
      summary("database", 50, 0),
    ]);

    const payload = await stats.buildPublicStats();

    expect(payload).toMatchObject({
      registered_users: 3534,
      dau: 1131,
      wau: 2967,
      mau: 3485,
      commands_7d: 60571,
      // pooled 100/150, not the 50% mean of the two component percentages
      uptime_90d: "66.7%",
    });
    expect(payload.generated_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/,
    );
    expect(payload.method).toContain("activity_log.user_id");
    expect(Object.keys(payload).sort()).toEqual([
      "commands_7d",
      "dau",
      "generated_at",
      "mau",
      "method",
      "registered_users",
      "uptime_90d",
      "wau",
    ]);
  });

  it("reports n/a when there are no uptime pings", async () => {
    mocks.getUptimeSummary.mockResolvedValue([]);

    const payload = await stats.buildPublicStats();

    expect(payload.uptime_90d).toBe("n/a");
  });
});

describe("GET /api/stats caching", () => {
  it("serves a Redis hit without touching the database", async () => {
    mocks.getClient.mockResolvedValue({
      get: vi.fn(async () => JSON.stringify(cachedPayload)),
      set: vi.fn(),
    });

    const res = await request(createApp()).get("/api/stats");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(cachedPayload);
    expect(res.headers["x-stats-cache"]).toBe("hit");
    expect(res.headers["cache-control"]).toBe(
      "public, max-age=300, stale-while-revalidate=60",
    );
    expect(mocks.getOverviewTotals).not.toHaveBeenCalled();
    expect(mocks.getUptimeSummary).not.toHaveBeenCalled();
  });

  it("builds and caches for 300 seconds on a Redis miss", async () => {
    const set = vi.fn(async () => "OK");
    mocks.getClient.mockResolvedValue({
      get: vi.fn(async () => null),
      set,
    });

    const res = await request(createApp()).get("/api/stats");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      registered_users: totals.users,
      dau: totals.activeToday,
      commands_7d: totals.commands7d,
      uptime_90d: "99.0%",
    });
    expect(res.headers["x-stats-cache"]).toBe("miss");
    expect(set).toHaveBeenCalledWith("stats:public", expect.any(String), {
      EX: 300,
    });
    expect(mocks.getOverviewTotals).toHaveBeenCalledTimes(1);
  });

  it("falls back to the process-local copy when Redis reads throw", async () => {
    mocks.getClient.mockRejectedValue(new Error("redis down"));
    const app = createApp();

    const first = await request(app).get("/api/stats");
    expect(first.status).toBe(200);
    expect(first.headers["x-stats-cache"]).toBe("miss");

    const second = await request(app).get("/api/stats");
    expect(second.status).toBe(200);
    expect(second.headers["x-stats-cache"]).toBe("hit");
    expect(second.body).toEqual(first.body);
    expect(mocks.getOverviewTotals).toHaveBeenCalledTimes(1);
  });

  it("keeps serving the local copy when Redis writes throw", async () => {
    mocks.getClient.mockResolvedValue({
      get: vi.fn(async () => null),
      set: vi.fn(async () => {
        throw new Error("redis write failed");
      }),
    });
    const app = createApp();

    await request(app).get("/api/stats");
    const second = await request(app).get("/api/stats");

    expect(second.status).toBe(200);
    expect(second.headers["x-stats-cache"]).toBe("hit");
    expect(mocks.getOverviewTotals).toHaveBeenCalledTimes(1);
  });

  it("answers a clean 500 when the build fails", async () => {
    mocks.getClient.mockResolvedValue({
      get: vi.fn(async () => null),
      set: vi.fn(),
    });
    mocks.getOverviewTotals.mockRejectedValue(new Error("database down"));

    const res = await request(createApp()).get("/api/stats");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: "Internal Server Error",
    });
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
