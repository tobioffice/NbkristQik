import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies BEFORE importing the modules that use them
// These mocks need to be defined without referencing any imports
vi.mock("../../src/services/redis/utils.js", () => ({
  getStudentCached: vi.fn().mockResolvedValue({
    roll_no: "21B81A05E9",
    name: "Test Student",
    section: "A",
    branch: "5",
    year: "32",
  }),
  StudentNotFoundError: class StudentNotFoundError extends Error {},
}));

vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    setEx: vi.fn(),
    expire: vi.fn(),
  }),
}));

vi.mock("../../src/services/redis/storeAttOrMidToRedis.js", () => ({
  storeAttendanceToRedis: vi.fn().mockResolvedValue(undefined),
  storeMidMarksToRedis: vi.fn().mockResolvedValue(undefined),
  persistAttendanceSection: vi.fn().mockResolvedValue(undefined),
  persistMidmarksSection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/db/fallback/response.model.js", () => ({
  storeResponse: vi.fn(),
  getResponseRecord: vi.fn().mockResolvedValue(null),
  getResponse: vi.fn().mockResolvedValue(null),
  buildResponseId: vi.fn(
    (year: string, branch: string, section: string, type: string) =>
      `${year}-${branch}-${section}-${type}`,
  ),
}));

vi.mock("axios", () => {
  class AxiosError extends Error {
    code?: string;
    response?: unknown;
    constructor(message: string, code?: string) {
      super(message);
      this.code = code;
      this.name = "AxiosError";
    }
  }
  return {
    default: {
      post: vi.fn(),
      get: vi.fn(),
    },
    AxiosError,
  };
});

// Now import the modules after mocks are set up
import {
  Academic,
  AcademicError,
  ServerDownError,
  BlockedReportError,
  NoDataFoundError,
  getAcadYearForDate,
} from "../../src/services/student.utils/Academic.js";
import {
  storeResponse,
  getResponseRecord,
} from "../../src/db/fallback/response.model.js";
import { getClient } from "../../src/services/redis/getRedisClient.js";
import {
  mockAttendance,
  mockMidmarks,
  mockAttendanceHTML,
  mockMidmarksHTML,
} from "../mocks/academic.mock.js";
import axios from "axios";

describe("Academic Module", () => {
  let academic: Academic;
  const rollNumber = "21B81A05E9";

  beforeEach(async () => {
    academic = new Academic(rollNumber);
    vi.clearAllMocks();
    // clearAllMocks keeps implementations; reset the shared Redis read so a
    // cached-value test cannot leak into the next one.
    const redisClient = await getClient();
    vi.mocked(redisClient.get).mockResolvedValue(null);
  });

  describe("Constructor", () => {
    it("should normalize roll number to uppercase", () => {
      const lowercaseAcademic = new Academic("21b81a05e9");
      expect(lowercaseAcademic.rollnumber).toBe("21B81A05E9");
    });

    it("should trim whitespace from roll number", () => {
      const spacedAcademic = new Academic("  21B81A05E9  ");
      expect(spacedAcademic.rollnumber).toBe("21B81A05E9");
    });
  });

  describe("Error Classes", () => {
    it("should create AcademicError with code", () => {
      const error = new AcademicError("Test error", "TEST_CODE");
      expect(error.message).toBe("Test error");
      expect(error.code).toBe("TEST_CODE");
      expect(error.name).toBe("AcademicError");
    });

    it("should create ServerDownError", () => {
      const error = new ServerDownError();
      expect(error.message).toContain("College server");
      expect(error.code).toBe("SERVER_DOWN");
    });

    it("should create BlockedReportError", () => {
      const error = new BlockedReportError();
      expect(error.message).toContain("blocked");
      expect(error.code).toBe("REPORT_BLOCKED");
    });

    it("should create NoDataFoundError", () => {
      const error = new NoDataFoundError("attendance");
      expect(error.message).toContain("attendance");
      expect(error.code).toBe("NO_DATA");
    });
  });

  describe("Academic year", () => {
    it("should use the next calendar year for the odd semester", () => {
      expect(getAcadYearForDate(new Date("2026-09-25T00:00:00+05:30"))).toBe(
        "2026-27",
      );
      expect(getAcadYearForDate(new Date("2026-07-01T00:00:00+05:30"))).toBe(
        "2026-27",
      );
    });

    it("should use the previous calendar year for the even semester", () => {
      expect(getAcadYearForDate(new Date("2026-01-15T00:00:00+05:30"))).toBe(
        "2025-26",
      );
      expect(getAcadYearForDate(new Date("2026-06-30T23:59:59+05:30"))).toBe(
        "2025-26",
      );
    });

    it("should use Asia/Kolkata for the semester boundary", () => {
      expect(getAcadYearForDate(new Date("2026-06-30T20:00:00Z"))).toBe(
        "2026-27",
      );
    });
  });

  describe("getResponse", () => {
    it("should fetch attendance successfully", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: mockAttendanceHTML,
      });

      const response = await academic.getResponse("att");
      expect(response).toContain("21B81A05E9");
      expect(axios.post).toHaveBeenCalled();
    });

    it("should request the student’s active session and current academic year", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: mockAttendanceHTML,
      });

      await academic.getResponse("att");

      const payload = vi.mocked(axios.post).mock.calls[0][1] as Record<
        string,
        string
      >;
      expect(payload.yearSem).toBe("32");
      expect(payload.acadYear).toBe(getAcadYearForDate());
    });

    it("should fetch midmarks successfully", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: mockMidmarksHTML,
      });

      const response = await academic.getResponse("mid");
      expect(response).toContain("21B81A05E9");
      expect(axios.post).toHaveBeenCalled();
    });

    it("should throw BlockedReportError when report is blocked", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: "Blocked by Admin",
      });

      await expect(academic.getResponse("att")).rejects.toThrow(
        BlockedReportError,
      );
    });

    it("should renew session when login page is returned", async () => {
      vi.mocked(axios.post)
        .mockResolvedValueOnce({
          data: "<tr><td>User Name</td><td>:</td><td><input type=textbox name='username' id='username'",
        })
        .mockResolvedValueOnce({
          data: "session renewed",
        })
        .mockResolvedValueOnce({
          data: mockAttendanceHTML,
        });

      const response = await academic.getResponse("att");
      expect(response).toContain("21B81A05E9");
      expect(axios.post).toHaveBeenCalledTimes(3); // Login page + session renewal + data request
    });

    it("should throw ServerDownError on network failure with no cache", async () => {
      vi.mocked(axios.post).mockRejectedValue(new Error("Network error"));

      await expect(academic.getResponse("att")).rejects.toThrow(
        ServerDownError,
      );
    });

    it("shares one portal request across concurrent same-section lookups", async () => {
      vi.mocked(axios.post).mockImplementation(async () => {
        // hold the request open so the second caller joins the in-flight one
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { data: mockAttendanceHTML };
      });

      const other = new Academic(rollNumber);
      const [first, second] = await Promise.all([
        academic.getResponse("att"),
        other.getResponse("att"),
      ]);

      expect(first).toBe(second);
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it("does not keep a failed fetch in the single-flight map", async () => {
      vi.mocked(axios.post).mockRejectedValueOnce(new Error("boom"));
      await expect(academic.getResponse("att")).rejects.toThrow(
        ServerDownError,
      );

      vi.mocked(axios.post).mockResolvedValueOnce({ data: mockAttendanceHTML });
      await expect(academic.getResponse("att")).resolves.toContain(rollNumber);
      expect(axios.post).toHaveBeenCalledTimes(2);
    });
  });

  describe("parseAttendanceResponse", () => {
    it("should parse attendance HTML correctly", async () => {
      const result = await Academic.parseAttendanceResponse(
        mockAttendanceHTML,
        rollNumber,
      );

      expect(result.rollno).toBe("21B81A05E9");
      expect(result.percentage).toBe(85.5);
      expect(result.totalClasses.attended).toBe(450);
      expect(result.totalClasses.conducted).toBe(526);
      // a fixture that yields zero subjects would make the parser test
      // vacuous, so assert the actual subject table this time
      expect(result.subjects).toHaveLength(2);
      expect(result.subjects[0]).toMatchObject({
        subject: "Data Structures",
        attended: 45,
        conducted: 50,
      });
      expect(result.subjects[1]).toMatchObject({
        subject: "Operating Systems",
        attended: 40,
        conducted: 45,
      });
    });

    it("should throw NoDataFoundError when student not found", async () => {
      const emptyHTML = "<html><body><table></table></body></html>";

      await expect(
        Academic.parseAttendanceResponse(emptyHTML, rollNumber),
      ).rejects.toThrow(NoDataFoundError);
    });
  });

  describe("parseMidmarksResponse", () => {
    it("should parse midmarks HTML correctly", async () => {
      const result = await Academic.parseMidmarksResponse(
        mockMidmarksHTML,
        rollNumber,
      );

      expect(result.rollno).toBe("21B81A05E9");
      expect(result.year_branch_section).toBe("3_CSE_A");
      expect(result.subjects).toHaveLength(3);
      expect(result.subjects[0]).toMatchObject({
        subject: "Data Structures",
        M1: 23,
        M2: 25,
        average: 24,
        type: "Subject",
      });
      expect(result.subjects[1]).toMatchObject({
        subject: "Operating Systems",
        M1: 22,
        M2: 24,
        average: 23,
        type: "Subject",
      });
      expect(result.subjects[2]).toMatchObject({
        subject: "DS Lab",
        M1: 25,
        M2: 0,
        average: 0,
        type: "Lab",
      });
    });

    it("should throw NoDataFoundError when student not found", async () => {
      const emptyHTML = "<html><body><table></table></body></html>";

      await expect(
        Academic.parseMidmarksResponse(emptyHTML, rollNumber),
      ).rejects.toThrow(NoDataFoundError);
    });
  });

  describe("getAttendanceJSON", () => {
    it("should return cached attendance if available", async () => {
      const { getClient } =
        await import("../../src/services/redis/getRedisClient.js");
      const mockClient = await getClient();
      vi.mocked(mockClient.get).mockResolvedValue(
        JSON.stringify(mockAttendance),
      );

      const result = await academic.getAttendanceJSON();

      expect(result).toEqual(mockAttendance);
      expect(mockClient.get).toHaveBeenCalledWith("attendance:21B81A05E9");
      expect(academic.getDataNotice()).toContain("last hour");
    });

    it("should fetch fresh data when cache misses", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: mockAttendanceHTML,
      });

      const result = await academic.getAttendanceJSON();

      expect(result).toBeDefined();
      expect(result.rollno).toBe("21B81A05E9");
      // the raw response is cached only after the roll check and a parse
      await vi.waitFor(() => expect(storeResponse).toHaveBeenCalledTimes(1));
    });

    it("does not cache a response that contains the roll but no usable row", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: `<html><body><table><tr id="${rollNumber}"></tr></table></body></html>`,
      });

      const result = await academic.getAttendanceJSON();

      expect(result.percentage).toBe(0);
      expect(storeResponse).not.toHaveBeenCalled();
    });

    it("does not cache a response that is missing the roll", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: mockAttendanceHTML.split(rollNumber).join("21B81A05E8"),
      });

      await expect(academic.getAttendanceJSON()).rejects.toThrow(
        NoDataFoundError,
      );
      expect(storeResponse).not.toHaveBeenCalled();
    });

    it("reports the age of the last saved fallback copy", async () => {
      vi.mocked(axios.post).mockRejectedValue(new Error("Network error"));
      const updatedAt = new Date(Date.now() - 4 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
      vi.mocked(getResponseRecord).mockResolvedValueOnce({
        content: mockAttendanceHTML,
        updatedAt,
      });

      const result = await academic.getAttendanceJSON();

      expect(result.rollno).toBe("21B81A05E9");
      expect(academic.getDataNotice()).toContain("4 hours ago");
      expect(academic.getDataNotice()).toContain("last saved copy");
      // a fallback must not refresh its own timestamp
      expect(storeResponse).not.toHaveBeenCalled();
    });
  });

  describe("getMidmarksJSON", () => {
    it("should return cached midmarks if available", async () => {
      const { getClient } =
        await import("../../src/services/redis/getRedisClient.js");
      const mockClient = await getClient();
      vi.mocked(mockClient.get).mockResolvedValue(JSON.stringify(mockMidmarks));

      const result = await academic.getMidmarksJSON();

      expect(result).toEqual(mockMidmarks);
      expect(mockClient.get).toHaveBeenCalledWith("midmarks:21B81A05E9");
      // mid-mark cache TTL is two hours, not one
      expect(academic.getDataNotice()).toContain("last two hours");
    });

    it("should fetch fresh data when cache misses", async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: mockMidmarksHTML,
      });

      const result = await academic.getMidmarksJSON();

      expect(result).toBeDefined();
      expect(result.rollno).toBe("21B81A05E9");
    });
  });

  describe("isSessionValid", () => {
    it("should return false when no session cookie exists", async () => {
      const result = await academic.isSessionValid();
      expect(result).toBe(false);
    });

    it("should return true when session is valid", async () => {
      // First renew session to set cookie
      vi.mocked(axios.post).mockResolvedValue({ data: "success" });
      await academic.renewSession();

      vi.mocked(axios.get).mockResolvedValue({
        data: "function selectHour(obj)",
      });

      const result = await academic.isSessionValid();
      expect(result).toBe(true);
    });

    it("should return false when session is invalid", async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: "Login page",
      });

      const result = await academic.isSessionValid();
      expect(result).toBe(false);
    });
  });

  describe("renewSession", () => {
    it("should generate new session token", async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: "success" });

      await academic.renewSession();

      expect(axios.post).toHaveBeenCalled();
      const callArgs = vi.mocked(axios.post).mock.calls[0];
      expect(callArgs[2]?.headers?.Cookie).toMatch(
        /PHPSESSID=ggpmgfj8dssskkp2q2h6db/,
      );
    });

    it("shares one login across concurrent renewals", async () => {
      vi.mocked(axios.post).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { data: "success" };
      });

      await Promise.all([academic.renewSession(), academic.renewSession()]);

      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it("should throw InvalidCredentialsError on failure", async () => {
      vi.mocked(axios.post).mockRejectedValue(new Error("Auth failed"));

      await expect(academic.renewSession()).rejects.toThrow(
        "Invalid credentials",
      );
    });
  });
});
