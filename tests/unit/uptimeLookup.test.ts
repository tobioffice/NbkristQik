import { beforeEach, describe, expect, it, vi } from "vitest";

// The probe must never be allowed to reach the college portal from a test
// run, and a down result must not try to send a real Telegram message.
const mocks = vi.hoisted(() => ({
  recordHeartbeat: vi.fn().mockResolvedValue(undefined),
  getFreshResponse: vi.fn(),
  getResponse: vi.fn(),
  getStudentCached: vi.fn(),
}));

vi.mock("../../src/config/environmentals.js", () => ({
  ENV: "test",
  PORT: "3001",
  ADMIN_ID: 0,
  CANARY_ROLL: "21B81A05E9",
  CANARY_ENABLED: true,
}));

vi.mock("../../src/db/student_stats.model.js", () => ({
  recordHeartbeat: mocks.recordHeartbeat,
  initUptimeTable: vi.fn(),
}));

vi.mock("../../src/services/student.utils/Academic.js", () => ({
  Academic: class {
    rollnumber: string;

    constructor(roll: string) {
      this.rollnumber = roll.toUpperCase().trim();
    }

    getFreshResponse(command: string) {
      return mocks.getFreshResponse(command);
    }

    getResponse(command: string) {
      return mocks.getResponse(command);
    }
  },
}));

vi.mock("../../src/services/redis/utils.js", () => ({
  getStudentCached: mocks.getStudentCached,
  StudentNotFoundError: class StudentNotFoundError extends Error {},
}));

import {
  buildComponentProbes,
  canaryProbeEnabled,
  probeLookup,
  recordProbeResult,
} from "../../src/services/uptime.js";
import { mockAttendanceHTML, mockStudent } from "../mocks/academic.mock.js";

describe("lookup canary probe", () => {
  beforeEach(() => {
    mocks.getStudentCached.mockResolvedValue(mockStudent);
    mocks.getFreshResponse.mockReset();
    mocks.getResponse.mockReset();
    mocks.recordHeartbeat.mockClear();
  });

  it("records lookup up for a healthy live answer", async () => {
    mocks.getFreshResponse.mockResolvedValue(mockAttendanceHTML);

    const result = await probeLookup();

    expect(result.component).toBe("lookup");
    expect(result.status).toBe("up");
    expect(result.latencyMs).toEqual(expect.any(Number));
    expect(mocks.getFreshResponse).toHaveBeenCalledWith("att");
    expect(mocks.getResponse).not.toHaveBeenCalled();

    await recordProbeResult(result);

    expect(mocks.recordHeartbeat).toHaveBeenCalledWith(
      "lookup",
      "up",
      expect.any(Number),
    );
  });

  it("records lookup down when the live portal request throws", async () => {
    mocks.getFreshResponse.mockRejectedValue(new Error("login failed"));

    const result = await probeLookup();

    expect(result).toMatchObject({
      component: "lookup",
      status: "down",
      latencyMs: null,
    });

    await recordProbeResult(result);

    expect(mocks.recordHeartbeat).toHaveBeenCalledWith("lookup", "down", null);
  });

  it("records lookup down when the report parses to no usable row", async () => {
    mocks.getFreshResponse.mockResolvedValue(
      "<html><body><table><tr><td>not a report</td></tr></table></body></html>",
    );

    const result = await probeLookup();

    expect(result.status).toBe("down");
  });

  it("does not let a saved fallback mask a portal failure", async () => {
    // getResponse is the fallback path: it would happily return this saved
    // copy. The canary must call getFreshResponse, which throws instead.
    mocks.getResponse.mockResolvedValue(mockAttendanceHTML);
    mocks.getFreshResponse.mockRejectedValue(new Error("portal down"));

    const result = await probeLookup();

    expect(result.status).toBe("down");
    expect(mocks.getFreshResponse).toHaveBeenCalledWith("att");
    expect(mocks.getResponse).not.toHaveBeenCalled();
  });

  it("is skipped when disabled, unconfigured, or under test", () => {
    // The module runs with ENV=test in this suite.
    expect(canaryProbeEnabled()).toBe(false);

    expect(canaryProbeEnabled("production", false, "21B81A05E9")).toBe(false);
    expect(canaryProbeEnabled("production", true, "")).toBe(false);
    expect(canaryProbeEnabled("production", true, "   ")).toBe(false);
    expect(canaryProbeEnabled("test", true, "21B81A05E9")).toBe(false);
    expect(canaryProbeEnabled("production", true, "21B81A05E9")).toBe(true);

    expect(buildComponentProbes(false)).not.toHaveProperty("lookup");
    expect(buildComponentProbes(true)).toHaveProperty("lookup");
  });
});
