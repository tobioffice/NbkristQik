import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Scope resolution and coverage are about the *effective* filters and the
 * cache key, so this suite mocks the models and keeps a tiny in-memory Redis.
 * Two callers in different sections must never share a cached page.
 */
const state = vi.hoisted(() => ({
  registrations: {} as Record<string, string>,
  students: {} as Record<
    string,
    {
      roll_no: string;
      name: string;
      section: string;
      branch: string;
      year: string;
    }
  >,
  coverage: 40,
  cache: new Map<string, string>(),
  cacheSets: [] as { key: string; value: string }[],
}));

vi.mock("../../src/db/student_stats.model.js", () => ({
  getLeaderboard: vi.fn(async () => ({
    rows: [
      {
        roll_no: "23KB1A0599",
        name: "TEST",
        attendance_percentage: 90,
        mid_marks_avg: 24,
        rank: 1,
      },
    ],
    total: 10,
  })),
  getLeaderboardCoverage: vi.fn(async () => state.coverage),
  getStudentRank: vi.fn(async () => ({ rank: 1, total: 10, value: 90 })),
  getLeaderboardFacets: vi.fn(async () => ["A", "B"]),
  getLastSyncAt: vi.fn(async () => ({
    newest: "2026-11-08 10:00:00",
    oldest: "2026-11-01 10:00:00",
  })),
  getUptimeSummary: vi.fn(async () => []),
  getUptimeDailyBuckets: vi.fn(async () => []),
  recordHeartbeatAt: vi.fn(async () => undefined),
  recordHeartbeatsAt: vi.fn(async () => undefined),
}));

vi.mock("../../src/db/student.model.js", () => ({
  getTgUserRoll: vi.fn(async () => null),
  deleteTgUser: vi.fn(async () => undefined),
  getStudent: vi.fn(async () => null),
  findSimilarRolls: vi.fn(async () => []),
}));

vi.mock("../../src/db/registration.model.js", () => ({
  getRegistration: vi.fn(async (userId: string) => {
    const roll = state.registrations[userId];
    return roll
      ? {
          userId,
          roll_no: roll,
          display_name: null,
          registered_at: "2026-01-01 00:00:00",
          updated_at: "2026-01-01 00:00:00",
        }
      : null;
  }),
  getRegistrationByRoll: vi.fn(async () => null),
  upsertRegistration: vi.fn(async () => undefined),
  RollAlreadyRegisteredError: class RollAlreadyRegisteredError extends Error {},
}));

vi.mock("../../src/services/redis/utils.js", () => ({
  getStudentCached: vi.fn(async (roll: string) => {
    const student = state.students[roll];
    if (!student) throw new Error("not in college records");
    return student;
  }),
  StudentNotFoundError: class StudentNotFoundError extends Error {},
}));

vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => ({
    get: async (key: string) => state.cache.get(key) ?? null,
    set: async (key: string, value: string) => {
      state.cacheSets.push({ key, value });
      state.cache.set(key, value);
      return "OK";
    },
    expire: async () => 1,
    ping: async () => "PONG",
  })),
}));

vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: vi.fn(),
}));

const { app } = await import("../../src/api/server.js");
const { getLeaderboard, getLeaderboardCoverage } =
  await import("../../src/db/student_stats.model.js");

beforeEach(() => {
  state.registrations = {};
  state.students = {};
  state.coverage = 40;
  state.cache.clear();
  state.cacheSets.length = 0;
});

const leaderboard = (query: string) =>
  request(app).get(`/api/leaderboard?${query}`);

describe("leaderboard scope", () => {
  it("resolves each scope=me caller's own section", async () => {
    state.registrations["101"] = "23KB1A0599";
    state.students["23KB1A0599"] = {
      roll_no: "23KB1A0599",
      name: "A",
      section: "A",
      branch: "5",
      year: "31",
    };
    state.registrations["102"] = "23KB1A0600";
    state.students["23KB1A0600"] = {
      roll_no: "23KB1A0600",
      name: "B",
      section: "B",
      branch: "5",
      year: "31",
    };

    const first = await leaderboard("scope=me&limit=20&userId=101");
    expect(first.status).toBe(200);
    expect(first.body.scope).toEqual({ year: "3", branch: "5", section: "A" });
    expect(first.body.coverage).toEqual({ ranked: 10, known: 40 });
    expect(vi.mocked(getLeaderboard)).toHaveBeenLastCalledWith(
      "attendance",
      20,
      0,
      expect.objectContaining({ year: "3", branch: "5", section: "A" }),
      { includeNames: true, searchNames: true },
    );

    const second = await leaderboard("scope=me&limit=20&userId=102");
    expect(second.status).toBe(200);
    expect(second.body.scope).toEqual({ year: "3", branch: "5", section: "B" });

    // two sections, two cache entries — never one shared page
    expect(state.cacheSets).toHaveLength(2);
    const [aKey, bKey] = state.cacheSets.map((entry) => entry.key);
    expect(aKey).not.toBe(bKey);
    expect(aKey).toContain("names:me:3:5:A:");
    expect(bKey).toContain("names:me:3:5:B:");
  });

  it("lets an explicit filter override the caller's section", async () => {
    state.registrations["101"] = "23KB1A0599";
    state.students["23KB1A0599"] = {
      roll_no: "23KB1A0599",
      name: "A",
      section: "A",
      branch: "5",
      year: "31",
    };

    const res = await leaderboard("scope=me&branch=9&limit=20&userId=101");

    expect(res.status).toBe(200);
    expect(vi.mocked(getLeaderboard)).toHaveBeenLastCalledWith(
      "attendance",
      20,
      0,
      expect.objectContaining({
        branch: "9",
        year: undefined,
        section: undefined,
      }),
      expect.any(Object),
    );
    expect(res.body.scope).toEqual({ year: null, branch: "9", section: null });
  });

  it("treats an explicit all value as an override too", async () => {
    state.registrations["101"] = "23KB1A0599";
    state.students["23KB1A0599"] = {
      roll_no: "23KB1A0599",
      name: "A",
      section: "A",
      branch: "5",
      year: "31",
    };

    const res = await leaderboard("scope=me&section=all&limit=20&userId=101");

    expect(res.status).toBe(200);
    expect(vi.mocked(getLeaderboard)).toHaveBeenLastCalledWith(
      "attendance",
      20,
      0,
      expect.objectContaining({
        branch: undefined,
        year: undefined,
        section: undefined,
      }),
      expect.any(Object),
    );
    expect(res.body.scope).toBeNull();
  });

  it("applies only explicit filters for scope=all", async () => {
    state.registrations["101"] = "23KB1A0599";
    state.students["23KB1A0599"] = {
      roll_no: "23KB1A0599",
      name: "A",
      section: "A",
      branch: "5",
      year: "31",
    };

    const res = await leaderboard("scope=all&year=2&limit=20&userId=101");

    expect(res.status).toBe(200);
    expect(vi.mocked(getLeaderboard)).toHaveBeenLastCalledWith(
      "attendance",
      20,
      0,
      expect.objectContaining({ year: "2", branch: undefined }),
      expect.any(Object),
    );
    expect(res.body.scope).toEqual({ year: "2", branch: null, section: null });
  });

  it("falls back to the whole college for an unregistered caller", async () => {
    const res = await leaderboard("scope=me&limit=20&userId=999");

    expect(res.status).toBe(200);
    expect(vi.mocked(getLeaderboard)).toHaveBeenLastCalledWith(
      "attendance",
      20,
      0,
      expect.objectContaining({
        year: undefined,
        branch: undefined,
        section: undefined,
      }),
      expect.any(Object),
    );
    expect(res.body.scope).toBeNull();
    expect(res.body.coverage).toEqual({ ranked: 10, known: 40 });
  });

  it("keeps an anonymous page in the shared all-college cache mode", async () => {
    const res = await leaderboard("limit=20");

    expect(res.status).toBe(200);
    expect(res.body.scope).toBeNull();
    expect(state.cacheSets[0].key).toContain("anon:all:-:");
  });

  it("returns no coverage for a search", async () => {
    state.registrations["101"] = "23KB1A0599";
    state.students["23KB1A0599"] = {
      roll_no: "23KB1A0599",
      name: "A",
      section: "A",
      branch: "5",
      year: "31",
    };

    const res = await leaderboard("scope=me&search=test&limit=20&userId=101");

    expect(res.status).toBe(200);
    expect(res.body.coverage).toBeNull();
    expect(vi.mocked(getLeaderboardCoverage)).not.toHaveBeenCalled();
  });

  it("keeps coverage off later pages", async () => {
    state.registrations["101"] = "23KB1A0599";
    state.students["23KB1A0599"] = {
      roll_no: "23KB1A0599",
      name: "A",
      section: "A",
      branch: "5",
      year: "31",
    };

    const res = await leaderboard("scope=me&page=2&limit=20&userId=101");

    expect(res.status).toBe(200);
    expect(res.body.coverage).toBeNull();
    expect(res.body.freshness).toBeNull();
  });

  it("reports a zero known count rather than dropping coverage", async () => {
    state.coverage = 0;
    state.registrations["101"] = "23KB1A0599";
    state.students["23KB1A0599"] = {
      roll_no: "23KB1A0599",
      name: "A",
      section: "A",
      branch: "5",
      year: "31",
    };

    const res = await leaderboard("scope=me&limit=20&userId=101");

    expect(res.status).toBe(200);
    expect(res.body.coverage).toEqual({ ranked: 10, known: 0 });
  });

  it("rejects an invalid scope value", async () => {
    const res = await leaderboard("scope=everyone");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
