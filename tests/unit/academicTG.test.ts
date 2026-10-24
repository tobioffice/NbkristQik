import { describe, it, expect, vi, beforeEach } from "vitest";
import { AcademicTG } from "../../src/services/student.utils/AcademicTG";
import { mockAttendance, mockMidmarks } from "../mocks/academic.mock";

describe("AcademicTG Module", () => {
  let academicTG: AcademicTG;
  const rollNumber = "21B81A05E9";

  beforeEach(() => {
    academicTG = new AcademicTG(rollNumber);
    vi.clearAllMocks();
  });

  describe("getAttendanceMessage", () => {
    it("should format attendance message with the compact summary", async () => {
      vi.spyOn(academicTG, "getAttendanceJSON").mockResolvedValue(
        mockAttendance,
      );

      const message = await academicTG.getAttendanceMessage();

      expect(message).toContain("21B81A05E9");
      expect(message).toContain("3_CSE_A");
      // The percentage is formatted as 85.50% not 85.5%
      expect(message).toContain("85.50%");
      expect(message).toContain("450/526");
      // the other half: the percentage is broken down per subject, so a
      // strong overall line cannot hide a weak subject
      expect(message).toContain("<pre>");
      expect(message).toContain("Data Stru..");
      expect(message).toContain("45/50");
      expect(message).toContain("│  90% │ 01-02");
    });

    it("should include progress bar in message", async () => {
      vi.spyOn(academicTG, "getAttendanceJSON").mockResolvedValue(
        mockAttendance,
      );

      const message = await academicTG.getAttendanceMessage();

      expect(message).toMatch(/[🟩🟨🟥⬜]/u);
    });

    it("should show one bar block per ten percent", async () => {
      vi.spyOn(academicTG, "getAttendanceJSON").mockResolvedValue(
        mockAttendance,
      );

      const message = await academicTG.getAttendanceMessage();

      // 85.5% -> 8 filled, 2 empty
      expect(message).toContain("🟩🟩🟩🟩🟩🟩🟩🟩⬜⬜");
    });

    it("should return error message on failure", async () => {
      vi.spyOn(academicTG, "getAttendanceJSON").mockRejectedValue(
        new Error("Server down"),
      );

      const message = await academicTG.getAttendanceMessage();

      expect(message).toContain("Error");
      expect(message).toContain("Couldn't fetch attendance");
    });

    it("should handle AcademicError specially", async () => {
      const { AcademicError } = await import(
        "../../src/services/student.utils/Academic"
      );
      vi.spyOn(academicTG, "getAttendanceJSON").mockRejectedValue(
        new AcademicError("Custom error", "TEST"),
      );

      const message = await academicTG.getAttendanceMessage();

      expect(message).toContain("Custom error");
    });
  });

  describe("getMidmarksMessage", () => {
    it("should format midmarks message with proper structure", async () => {
      vi.spyOn(academicTG, "getMidmarksJSON").mockResolvedValue(mockMidmarks);

      const message = await academicTG.getMidmarksMessage();

      expect(message).toContain("Mid marks for");
      expect(message).toContain("21B81A05E9");
      expect(message).toContain("3_CSE_A");
      expect(message).toContain("<pre>");
      expect(message).toContain("</pre>");
    });

    it("should format subjects with marks correctly (names are truncated to 11 chars)", async () => {
      vi.spyOn(academicTG, "getMidmarksJSON").mockResolvedValue(mockMidmarks);

      const message = await academicTG.getMidmarksMessage();

      // Subject names are truncated to 11 characters with ".." if longer
      expect(message).toContain("Data Stru..");
      expect(message).toContain("Operating..");
      // Type is also truncated to 4 characters
      expect(message).toContain("Su..");
      expect(message).toContain("Lab");
    });

    it("should display M1, M2, and average correctly", async () => {
      vi.spyOn(academicTG, "getMidmarksJSON").mockResolvedValue(mockMidmarks);

      const message = await academicTG.getMidmarksMessage();

      // Check for marks (they'll be in the pre block)
      expect(message).toContain("23");
      expect(message).toContain("25");
      expect(message).toContain("24");
    });

    it("should return error message on failure", async () => {
      vi.spyOn(academicTG, "getMidmarksJSON").mockRejectedValue(
        new Error("Server down"),
      );

      const message = await academicTG.getMidmarksMessage();

      expect(message).toContain("Error");
      expect(message).toContain("Couldn't fetch midmarks");
    });
  });

  describe("Message Formatting Helpers", () => {
    it("should generate correct progress bar for high percentage", async () => {
      // Test through actual message generation
      const highAttendance = { ...mockAttendance, percentage: 85 };
      vi.spyOn(academicTG, "getAttendanceJSON").mockResolvedValue(
        highAttendance,
      );

      const message = await academicTG.getAttendanceMessage();

      expect(message).toContain("🟩");
    });

    it("should generate correct progress bar for medium percentage", async () => {
      const mediumAttendance = { ...mockAttendance, percentage: 60 };
      vi.spyOn(academicTG, "getAttendanceJSON").mockResolvedValue(
        mediumAttendance,
      );

      const message = await academicTG.getAttendanceMessage();

      expect(message).toContain("🟨");
    });

    it("should generate correct progress bar for low percentage", async () => {
      const lowAttendance = { ...mockAttendance, percentage: 40 };
      vi.spyOn(academicTG, "getAttendanceJSON").mockResolvedValue(
        lowAttendance,
      );

      const message = await academicTG.getAttendanceMessage();

      expect(message).toContain("🟥");
    });

    it("should truncate long subject names in the bunk plan", async () => {
      const longNameAttendance = {
        ...mockAttendance,
        subjects: [
          {
            subject: "Very Long Subject Name That Needs Truncation",
            attended: 45,
            conducted: 50,
            lastUpdated: "01-02-2026",
          },
        ],
      };

      vi.spyOn(academicTG, "getAttendanceJSON").mockResolvedValue(
        longNameAttendance,
      );

      const message = await academicTG.getBunkPlanMessage();

      // Subject names are truncated to 8 characters with ".." if longer
      expect(message).toContain("Very L..");
    });
  });
});
