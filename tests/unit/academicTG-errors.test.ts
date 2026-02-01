import { describe, it, expect, vi, beforeEach } from "vitest";
import { AcademicTG } from "../../src/services/student.utils/AcademicTG.js";
import { AcademicError } from "../../src/services/student.utils/Academic.js";
import type { Attendance, Midmarks } from "../../src/types/index.js";

describe("AcademicTG - Error Handling", () => {
   let academicTG: AcademicTG;

   beforeEach(() => {
      // AcademicTG constructor only takes rollnumber (1 argument)
      academicTG = new AcademicTG("21B81A05E9");
      vi.clearAllMocks();
   });

   describe("getAttendanceMessage - Error Scenarios", () => {
      it("should handle AcademicError and show its message", async () => {
         vi.spyOn(academicTG, "getAttendanceJSON").mockRejectedValue(
            new AcademicError("Server not responding", "SERVER_DOWN")
         );

         const result = await academicTG.getAttendanceMessage();

         expect(result).toContain("⚠️");
         expect(result).toContain("Error");
         expect(result).toContain("Server not responding");
      });

      it("should handle generic errors with fallback message", async () => {
         vi.spyOn(academicTG, "getAttendanceJSON").mockRejectedValue(
            new Error("Network timeout")
         );

         const result = await academicTG.getAttendanceMessage();

         expect(result).toContain("⚠️");
         expect(result).toContain("Error");
         expect(result).toContain("Unable to fetch attendance");
      });

      it("should log errors to console", async () => {
         const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => { });
         const testError = new Error("Test error");

         vi.spyOn(academicTG, "getAttendanceJSON").mockRejectedValue(testError);

         await academicTG.getAttendanceMessage();

         expect(consoleErrorSpy).toHaveBeenCalledWith(
            "[AcademicTG] Attendance error:",
            testError
         );

         consoleErrorSpy.mockRestore();
      });
   });

   describe("getMidmarksMessage - Error Scenarios", () => {
      it("should handle AcademicError for midmarks", async () => {
         vi.spyOn(academicTG, "getMidmarksJSON").mockRejectedValue(
            new AcademicError("Server unavailable", "SERVER_DOWN")
         );

         const result = await academicTG.getMidmarksMessage();

         expect(result).toContain("⚠️");
         expect(result).toContain("Error");
         expect(result).toContain("Server unavailable");
      });

      it("should handle generic errors with fallback message for midmarks", async () => {
         vi.spyOn(academicTG, "getMidmarksJSON").mockRejectedValue(
            new Error("Network error")
         );

         const result = await academicTG.getMidmarksMessage();

         expect(result).toContain("⚠️");
         expect(result).toContain("Error");
         expect(result).toContain("Unable to fetch midmarks");
      });
   });

   describe("Successful Response Formatting", () => {
      it("should format attendance message correctly", async () => {
         const mockAttendance: Attendance = {
            rollno: "21B81A05E9",
            year_branch_section: "3_CSE_A",
            percentage: 85.5,
            totalClasses: { attended: 85, conducted: 100 },
            subjects: [
               {
                  subject: "Data Structures",
                  attended: 20,
                  conducted: 25,
                  lastUpdated: "25-01-2026",
               },
            ],
         };

         vi.spyOn(academicTG, "getAttendanceJSON").mockResolvedValue(mockAttendance);

         const result = await academicTG.getAttendanceMessage();

         expect(result).toContain("21B81A05E9");
         expect(result).toContain("3_CSE_A");
         expect(result).toContain("85.50%");
      });

      it("should format midmarks message correctly", async () => {
         const mockMidmarks: Midmarks = {
            rollno: "21B81A05E9",
            year_branch_section: "3_CSE_A",
            subjects: [
               {
                  subject: "Data Structures",
                  type: "Subject",
                  M1: 18,
                  M2: 20,
                  average: 19,
               },
            ],
         };

         vi.spyOn(academicTG, "getMidmarksJSON").mockResolvedValue(mockMidmarks);

         const result = await academicTG.getMidmarksMessage();

         expect(result).toContain("📊 Mid Marks Report");
         expect(result).toContain("21B81A05E9");
         expect(result).toContain("3_CSE_A");
      });
   });

   describe("Edge Cases", () => {
      it("should handle error with undefined message", async () => {
         vi.spyOn(academicTG, "getAttendanceJSON").mockRejectedValue({});

         const result = await academicTG.getAttendanceMessage();

         expect(result).toContain("Unable to fetch attendance");
         expect(result).toBeDefined();
      });

      it("should handle error with null", async () => {
         vi.spyOn(academicTG, "getAttendanceJSON").mockRejectedValue(null);

         const result = await academicTG.getAttendanceMessage();

         expect(result).toContain("Unable to fetch attendance");
         expect(result).toBeDefined();
      });
   });
});
