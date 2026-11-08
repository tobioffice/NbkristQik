import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  NoDataFoundError,
  ServerDownError,
} from "../../src/services/student.utils/academicErrors.js";

const state = vi.hoisted(() => ({
  registration: null as string | null,
  studentMissing: false,
  notice: null as string | null,
  error: null as Error | null,
  student: {
    roll_no: "23KB1A0599",
    name: "TEST",
    section: "A",
    branch: "5",
    year: "31",
  },
  attendance: {
    rollno: "23KB1A0599",
    year_branch_section: "3-5-A",
    percentage: 88,
    totalClasses: { attended: 44, conducted: 50 },
    subjects: [
      {
        subject: "DBMS",
        attended: 44,
        conducted: 50,
        lastUpdated: "2026-11-07",
      },
    ],
  },
  midmarks: {
    rollno: "23KB1A0599",
    year_branch_section: "3-5-A",
    subjects: [
      { subject: "DBMS", M1: 20, M2: 22, average: 21, type: "theory" },
    ],
  },
  calls: [] as string[],
}));

vi.mock("../../src/db/registration.model.js", () => ({
  getRegistration: vi.fn(async (userId: string) =>
    state.registration
      ? {
          userId,
          roll_no: state.registration,
          display_name: null,
          registered_at: "2026-01-01 00:00:00",
          updated_at: "2026-01-01 00:00:00",
        }
      : null,
  ),
  getRegistrationByRoll: vi.fn(async () => null),
  upsertRegistration: vi.fn(async () => undefined),
  RollAlreadyRegisteredError: class RollAlreadyRegisteredError extends Error {},
}));

vi.mock("../../src/services/redis/utils.js", () => ({
  getStudentCached: vi.fn(async () => {
    if (state.studentMissing) {
      throw new StudentNotFoundError("23KB1A0599", []);
    }
    return state.student;
  }),
  StudentNotFoundError: class StudentNotFoundError extends Error {
    constructor(
      public rollnumber: string,
      public suggestions: string[],
    ) {
      super(`Student ${rollnumber} not found in college records`);
      this.name = "StudentNotFoundError";
    }
  },
}));

vi.mock("../../src/services/student.utils/Academic.js", () => ({
  Academic: class Academic {
    rollnumber: string;

    constructor(rollnumber: string) {
      this.rollnumber = rollnumber.toUpperCase().trim();
    }

    getDataNotice() {
      return state.notice;
    }

    async getAttendanceJSON() {
      state.calls.push("attendance");
      if (state.error) throw state.error;
      return state.attendance;
    }

    async getMidmarksJSON() {
      state.calls.push("midmarks");
      if (state.error) throw state.error;
      return state.midmarks;
    }
  },
}));

vi.mock("../../src/services/tracker.js", () => ({
  trackActivity: vi.fn(),
}));

const { app } = await import("../../src/api/server.js");
const { trackActivity } = await import("../../src/services/tracker.js");
const { StudentNotFoundError } =
  await import("../../src/services/redis/utils.js");

beforeEach(() => {
  state.registration = null;
  state.studentMissing = false;
  state.notice = null;
  state.error = null;
  state.calls.length = 0;
});

const academics = (query = "") => request(app).get(`/api/me/academics${query}`);

describe("GET /api/me/academics", () => {
  it("returns structured attendance for a registered caller", async () => {
    state.registration = "23KB1A0599";

    const res = await academics("?userId=101");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      registered: true,
      type: "attendance",
      rollNo: "23KB1A0599",
      data: state.attendance,
      freshness: { notice: null, source: "live" },
    });
    expect(res.headers["cache-control"]).toBe("private, max-age=60");
    expect(res.headers["vary"]).toContain("X-Telegram-Init-Data");
    expect(state.calls).toEqual(["attendance"]);
  });

  it("returns midmarks when asked", async () => {
    state.registration = "23KB1A0599";

    const res = await academics("?type=midmarks&userId=101");

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("midmarks");
    expect(res.body.data).toEqual(state.midmarks);
    expect(state.calls).toEqual(["midmarks"]);
    expect(vi.mocked(trackActivity)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "midmarks_webapp" }),
    );
  });

  it("tracks one explicit open per request", async () => {
    state.registration = "23KB1A0599";

    await academics("?userId=101");

    expect(vi.mocked(trackActivity)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(trackActivity)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 101,
        action: "attendance_webapp",
        detail: "23KB1A0599",
      }),
    );
  });

  it("answers unregistered callers without an error", async () => {
    const res = await academics("?userId=101");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, registered: false });
    expect(vi.mocked(trackActivity)).not.toHaveBeenCalled();
  });

  it("requires a verified identity", async () => {
    const res = await academics();

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ ok: false, registered: false });
  });

  it("rejects an unknown type", async () => {
    state.registration = "23KB1A0599";

    const res = await academics("?type=marks&userId=101");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type must be/);
  });

  it("labels a recent Redis copy as cached", async () => {
    state.registration = "23KB1A0599";
    state.notice =
      "Saved copy from the last hour; the college portal was not checked just now.";

    const res = await academics("?userId=101");

    expect(res.status).toBe(200);
    expect(res.body.freshness).toEqual({
      notice: state.notice,
      source: "cached",
    });
  });

  it("labels the saved section copy as fallback", async () => {
    state.registration = "23KB1A0599";
    state.notice =
      "The college portal could not be reached. This is the last saved copy from 4 hours ago; it may be out of date.";

    const res = await academics("?userId=101");

    expect(res.status).toBe(200);
    expect(res.body.freshness.source).toBe("fallback");
  });

  it("maps a portal failure to a stable error shape", async () => {
    state.registration = "23KB1A0599";
    state.error = new ServerDownError();

    const res = await academics("?userId=101");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      ok: false,
      registered: true,
      type: "attendance",
      rollNo: "23KB1A0599",
      error: "College server is not responding. Please try again later.",
      code: "SERVER_DOWN",
    });
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("maps missing data to 404", async () => {
    state.registration = "23KB1A0599";
    state.error = new NoDataFoundError("attendance");

    const res = await academics("?userId=101");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NO_DATA");
  });

  it("maps a registration whose roll left the college table to 404", async () => {
    state.registration = "23KB1A0599";
    state.studentMissing = true;

    const res = await academics("?userId=101");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      ok: false,
      registered: true,
      rollNo: "23KB1A0599",
      code: "NO_STUDENT",
    });
  });

  it("keeps the StudentNotFoundError identity stable", () => {
    // guards the instanceof path against the mocked class drifting
    expect(
      new StudentNotFoundError("23KB1A0599", []) instanceof
        StudentNotFoundError,
    ).toBe(true);
  });
});
