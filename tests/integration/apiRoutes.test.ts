import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";

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
  getLeaderboardCoverage: vi.fn(async () => 100),
  getStudentRank: vi.fn(async () => ({ rank: 3, total: 245, value: 95.5 })),
  getLeaderboardFacets: vi.fn(async () => ["A", "B"]),
  getLastSyncAt: vi.fn(async () => ({
    newest: "2026-10-25 10:00:00",
    oldest: "2026-10-20 10:00:00",
  })),
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
  recordHeartbeatAt: vi.fn(async () => undefined),
  recordHeartbeatsAt: vi.fn(async () => undefined),
}));

vi.mock("../../src/db/student.model.js", () => ({
  getTgUserRoll: vi.fn(async (userId: string) =>
    userId === "12345" ? "21B81A05E9" : null,
  ),
  deleteTgUser: vi.fn(async () => undefined),
  getStudent: vi.fn(async () => ({
    roll_no: "21B81A05E9",
    name: "JOHN",
    section: "A",
    branch: "5",
    year: "31",
  })),
  findSimilarRolls: vi.fn(async () => []),
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

// /api/me prefers registrations over tgusers; these suites exercise the
// lookup path, so keep the registration lookup empty.
vi.mock("../../src/db/registration.model.js", () => ({
  getRegistration: vi.fn(async () => null),
  getRegistrationByRoll: vi.fn(async () => null),
  upsertRegistration: vi.fn(async () => undefined),
  RollAlreadyRegisteredError: class RollAlreadyRegisteredError extends Error {},
}));

/**
 * Sign initData the way Telegram does, with the test bot token. The API
 * prefers the X-Telegram-Init-Data header; this helper proves that path.
 */
const signInitData = (userId: number): string => {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: "Test" }),
  });
  const dataCheckString = [...params.entries()]
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(process.env.TELEGRAM_BOT_TOKEN_DEV || "test_bot_token")
    .digest();
  const hash = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");
  params.set("hash", hash);
  return params.toString();
};

const { app } = await import("../../src/api/server.js");
const { getLeaderboard, getStudentRank } =
  await import("../../src/db/student_stats.model.js");

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
      freshness: {
        newest: "2026-10-25 10:00:00",
        oldest: "2026-10-20 10:00:00",
      },
      facets: { sections: ["A", "B"] },
      // anonymous callers default to the whole college: no section scope
      scope: null,
      coverage: { ranked: 1, known: 100 },
    });
    expect(res.body.data[0]).toMatchObject({ roll_no: "21B81A05E9", rank: 1 });
    expect(res.headers["vary"]).toContain("X-Telegram-Init-Data");
    expect(res.headers["cache-control"]).toBe("public, max-age=30");
  });

  it("GET /api/leaderboard leaves freshness off later pages", async () => {
    const res = await request(app).get(
      "/api/leaderboard?page=2&limit=20&sort=attendance",
    );

    expect(res.status).toBe(200);
    expect(res.body.updated_at).toBeNull();
    expect(res.body.freshness).toBeNull();
    expect(res.body.facets).toBeNull();
    expect(res.body.coverage).toBeNull();
  });

  it("GET /api/leaderboard maps a legacy year-semester code to its year digit", async () => {
    await request(app).get("/api/leaderboard?page=1&limit=20&year=12");

    expect(vi.mocked(getLeaderboard)).toHaveBeenLastCalledWith(
      "attendance",
      20,
      0,
      expect.objectContaining({ year: "1" }),
      expect.any(Object),
    );
  });

  it("GET /api/leaderboard rejects invalid query parameters", async () => {
    const res = await request(app).get("/api/leaderboard?page=0&limit=999");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.details).toBeDefined();
  });

  it("GET /api/leaderboard hides names and name search from anonymous callers", async () => {
    const res = await request(app).get(
      "/api/leaderboard?page=1&limit=20&search=jo",
    );

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=30");
    // a search is not a coverage view
    expect(res.body.coverage).toBeNull();
    // the model mock returns a name; the anonymous response must not
    expect(res.body.data[0].name).toBeNull();
    expect(vi.mocked(getLeaderboard)).toHaveBeenLastCalledWith(
      "attendance",
      20,
      0,
      expect.objectContaining({ search: "jo" }),
      { includeNames: false, searchNames: false },
    );
  });

  it("GET /api/leaderboard serves names to a verified Telegram identity", async () => {
    const res = await request(app)
      .get("/api/leaderboard?page=1&limit=20")
      .set("X-Telegram-Init-Data", signInitData(12345));

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, max-age=30");
    expect(res.body.data[0].name).toBe("JOHN");
    expect(vi.mocked(getLeaderboard)).toHaveBeenLastCalledWith(
      "attendance",
      20,
      0,
      expect.any(Object),
      { includeNames: true, searchNames: true },
    );
  });

  it("GET /api/leaderboard rejects presented-but-invalid initData", async () => {
    const res = await request(app)
      .get("/api/leaderboard")
      .set("X-Telegram-Init-Data", "not-a-signature");

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("GET /api/config defaults to closed/no-admin and is not cached", async () => {
    const res = await request(app).get("/api/config");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ libraryOpen: false, admin: false });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("GET /api/config reflects library access and the admin preview", async () => {
    const previous = process.env.LIBRARY_ACCESS;
    process.env.LIBRARY_ACCESS = "admin";
    try {
      const res = await request(app).get("/api/config?userId=123456789");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ libraryOpen: true, admin: true });
      expect(res.headers["cache-control"]).toBe("no-store");
    } finally {
      if (previous === undefined) delete process.env.LIBRARY_ACCESS;
      else process.env.LIBRARY_ACCESS = previous;
    }
  });

  it("GET /api/config rejects presented-but-invalid initData", async () => {
    const res = await request(app)
      .get("/api/config")
      .set("X-Telegram-Init-Data", "not-a-signature");

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ libraryOpen: false, admin: false });
  });

  it("GET /api/me requires a verifiable identity in production", async () => {
    const res = await request(app).get("/api/me");

    expect(res.status).toBe(401);
    expect(res.body.found).toBe(false);
  });

  it("GET /api/me returns lastLookup but not identity for a lookup-only user", async () => {
    const res = await request(app).get("/api/me?userId=12345");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ found: false, lastLookup: "21B81A05E9" });
    // identity is registration; never run rank queries for a lookup-only user
    expect(vi.mocked(getStudentRank)).not.toHaveBeenCalled();
  });

  it("GET /api/me is private and never stored", async () => {
    const res = await request(app).get("/api/me?userId=12345");

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("GET /api/me accepts X-Telegram-Init-Data and prefers it over query userId", async () => {
    const res = await request(app)
      .get("/api/me?userId=99999")
      .set("X-Telegram-Init-Data", signInitData(12345));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ found: false, lastLookup: "21B81A05E9" });
  });

  it("GET /api/me rejects presented-but-invalid initData", async () => {
    const res = await request(app)
      .get("/api/me")
      .set("X-Telegram-Init-Data", "not-a-signature");

    expect(res.status).toBe(401);
    expect(res.body.found).toBe(false);
  });

  it("GET /api/me reports found:false for an unmapped user", async () => {
    const res = await request(app).get("/api/me?userId=99999");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ found: false, lastLookup: null });
  });

  it("DELETE /api/me/last-lookup requires a verified identity", async () => {
    const res = await request(app).delete("/api/me/last-lookup");

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it("DELETE /api/me/last-lookup clears the caller's last lookup", async () => {
    const { deleteTgUser } = await import("../../src/db/student.model.js");

    const res = await request(app).delete("/api/me/last-lookup?userId=12345");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(vi.mocked(deleteTgUser)).toHaveBeenCalledWith("12345");
  });

  it("GET /api/myreports and /api/thread are never stored", async () => {
    const reports = await request(app).get("/api/myreports");
    expect(reports.status).toBe(401);
    expect(reports.headers["cache-control"]).toBe("private, no-store");

    const thread = await request(app).get("/api/thread/1");
    expect(thread.status).toBe(401);
    expect(thread.headers["cache-control"]).toBe("private, no-store");
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

  it("GET /internal/health refuses requests without the monitor secret", async () => {
    const res = await request(app).get("/internal/health");

    expect(res.status).toBe(401);
  });

  it("POST /internal/uptime refuses a bad bearer token", async () => {
    const res = await request(app)
      .post("/internal/uptime")
      .set("Authorization", "Bearer not-the-secret")
      .send({ rows: [] });

    expect(res.status).toBe(401);
  });

  it("POST /internal/uptime validates rows after the secret", async () => {
    const res = await request(app)
      .post("/internal/uptime")
      .set("Authorization", `Bearer ${process.env.UPTIME_INGEST_SECRET ?? ""}`)
      .send({
        rows: [
          {
            component: "api",
            status: "up",
            latencyMs: 1,
            at: "not-a-timestamp",
          },
        ],
      });

    expect(res.status).toBe(400);
  });
});
