import { describe, it, expect, vi } from "vitest";
import request from "supertest";

vi.mock("../../src/db/student_stats.model.js", () => ({
  getLeaderboard: vi.fn(async () => ({
    rows: [
      {
        roll_no: "21B81A05E9",
        name: "JOHN",
        attendance_percentage: 95.5,
        mid_marks_avg: 18.75,
        rank: 1,
      },
    ],
    total: 1,
  })),
  getStudentRank: vi.fn(async () => ({ rank: 3, total: 245, value: 95.5 })),
  getLeaderboardFacets: vi.fn(async () => ["A", "B"]),
  getLastSyncAt: vi.fn(async () => "2026-10-25 10:00:00"),
  getUptimeSummary: vi.fn(async () => [
    {
      component: "api",
      pings: 10,
      ups: 10,
      uptimePct: 100,
      lastPing: new Date().toISOString().slice(0, 19).replace("T", " "),
      lastStatus: "up",
      avgLatencyMs: 12,
    },
  ]),
  getUptimeDailyBuckets: vi.fn(async () => [
    { day: "2026-10-08", pings: 10, ups: 10, avgLatencyMs: 12 },
  ]),
}));

vi.mock("../../src/db/student.model.js", () => ({
  getTgUserRoll: vi.fn(async (userId: string) =>
    userId === "12345" ? "21B81A05E9" : null,
  ),
}));

vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
  })),
}));

vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: vi.fn(),
}));

const { app } = await import("../../src/api/server.js");

describe("API contracts", () => {
  it("GET /api/leaderboard returns the paginated envelope", async () => {
    const res = await request(app).get(
      "/api/leaderboard?page=1&limit=20&sort=attendance",
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      page: 1,
      limit: 20,
      total: 1,
      updated_at: "2026-10-25 10:00:00",
      facets: { sections: ["A", "B"] },
    });
    expect(res.body.data[0]).toMatchObject({ roll_no: "21B81A05E9", rank: 1 });
  });

  it("GET /api/leaderboard leaves freshness off later pages", async () => {
    const res = await request(app).get(
      "/api/leaderboard?page=2&limit=20&sort=attendance",
    );

    expect(res.status).toBe(200);
    expect(res.body.updated_at).toBeNull();
    expect(res.body.facets).toBeNull();
  });

  it("GET /api/leaderboard rejects invalid query parameters", async () => {
    const res = await request(app).get("/api/leaderboard?page=0&limit=999");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.details).toBeDefined();
  });

  it("GET /api/me requires a verifiable identity in production", async () => {
    const res = await request(app).get("/api/me");

    expect(res.status).toBe(401);
    expect(res.body.found).toBe(false);
  });

  it("GET /api/me returns ranks for the dev userId shortcut (non-production)", async () => {
    const res = await request(app).get("/api/me?userId=12345");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      found: true,
      roll_no: "21B81A05E9",
      attendance: { rank: 3, total: 245, value: 95.5 },
      midmarks: { rank: 3, total: 245, value: 95.5 },
    });
  });

  it("GET /api/me reports found:false for an unmapped user", async () => {
    const res = await request(app).get("/api/me?userId=99999");

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
  });

  it("GET /health responds ok without rate limiting", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.uptime).toBe("number");
  });

  it("GET /api/status assembles components with current status", async () => {
    const res = await request(app).get("/api/status");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.components[0]).toMatchObject({
      component: "api",
      current: "up",
    });
  });
});
