import { describe, it, expect, vi } from "vitest";
import request from "supertest";

vi.mock("../../src/db/student_stats.model.js", () => ({
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

const { app } = await import("../../src/api/server.js");

describe("API contracts", () => {
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
