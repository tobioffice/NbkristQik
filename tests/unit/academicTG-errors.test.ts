import { describe, it, expect, vi, beforeEach } from "vitest";
import { AcademicTG } from "../../src/services/student.utils/AcademicTG.js";
import { ServerDownError, NoDataFoundError, BlockedReportError, AcademicError } from "../../src/services/student.utils/Academic.js";
import type { Attendance, Midmarks } from "../../src/types/index.js";

describe("AcademicTG - Error Handling", () => {
   let academicTG: AcademicTG;

   beforeEach(() => {
      academicTG = new AcademicTG("21B81A05E9", "password123");
      vi.clearAllMocks();
   });

   describe("getAttendanceMessage - Error Scenarios", () => {
      it("should handle ServerDownError with retry guidance", async () => {
         vi.spyOn(academicTG, "getAttendanceJSON").mockRejectedValue(
            new ServerDownError("Server not responding")
         );

         const result = await academicTG.getAttendanceMessage();

         expect(result).toContain("⚠️");
         expect(result).toContain("College Server Temporarily Down");
         expect(result).toContain("Server not responding");
         expect(result).toContain("Wait 5-10 minutes");
         expect(result).toContain("💡");
      });

      it("should handle NoDataFoundError with roll number validation", async () => {
         vi.spyOn(academicTG, "getAttendanceJSON").mockRejectedValue(
            new NoDataFoundError("No data found for roll number")
         );

         const result = await academicTG.getAttendanceMessage();

         expect(result).toContain("❌");
         expect(result).toContain("No Attendance Data Found");
         expect(result).toContain("21B81A05E9");
         expect(result).toContain("Roll number is correct");
         expect(result).toContain("Data is available on portal");
      });

      it("should handle BlockedReportError with admin contact info", async () => {
         vi.spyOn(academicTG, "getAttendanceJSON").mockRejectedValue(
            new BlockedReportError("Report access blocked by admin")
         );

         const result = await academicTG.getAttendanceMessage();

         expect(result).toContain("🚫");
         expect(result).toContain("Report Access Blocked");
         expect(result).toContain("administrator has temporarily blocked");
         expect(result).toContain("Contact your class coordinator");
      });

      it("should handle generic AcademicError", async () => {
         vi.spyOn(academicTG, "getAttendanceJSON").mockRejectedValue(
            new AcademicError("Invalid credentials")
         );

         const result = await academicTG.getAttendanceMessage();

         expect(result).toContain("⚠️");
         expect(result).toContain("Error Fetching Attendance");
         expect(result).toContain("Invalid credentials");
         expect(result).toContain("Send your roll number again");
      });

      it("should handle unknown errors gracefully", async () => {
         vi.spyOn(academicTG, "getAttendanceJSON").mockRejectedValue(
            new Error("Network timeout")
         );

         const result = await academicTG.getAttendanceMessage();

         expect(result).toContain("⚠️");
         expect(result).toContain("Unexpected Error");
         expect(result).toContain("Unable to fetch attendance");
         expect(result).toContain("Try again in a few minutes");
         expect(result).toContain("/report");
      });

      it("should include IST timestamp in error messages", async () => {
         vi.spyOn(academicTG, "getAttendanceJSON").mockRejectedValue(
            new ServerDownError("Server down")
         );

         const result = await academicTG.getAttendanceMessage();

         expect(result).toContain("⏰");
         expect(result).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
      });
   });

   describe("getMidmarksMessage - Error Scenarios", () => {
      it("should handle ServerDownError for midmarks", async () => {
         vi.spyOn(academicTG, "getMidmarksJSON").mockRejectedValue(
            new ServerDownError("Server unavailable")
         );

         const result = await academicTG.getMidmarksMessage();

         expect(result).toContain("College Server Temporarily Down");
         expect(result).toContain("Server not responding");
      });

      it("should handle NoDataFoundError for midmarks", async () => {
         vi.spyOn(academicTG, "getMidmarksJSON").mockRejectedValue(
            new NoDataFoundError("No midmarks data")
         );

         const result = await academicTG.getMidmarksMessage();

         expect(result).toContain("No Mid-Marks Data Found");
         expect(result).toContain("21B81A05E9");
      });

      it("should handle BlockedReportError for midmarks", async () => {
         vi.spyOn(academicTG, "getMidmarksJSON").mockRejectedValue(
            new BlockedReportError("Blocked by admin")
         );

         const result = await academicTG.getMidmarksMessage();

         expect(result).toContain("Report Access Blocked");
      });
   });

   describe("Successful Response Enhancements", () => {
      it("should add helpful tip to attendance message", async () => {
         const mockAttendance: Attendance = {
            rollno: "21B81A05E9",
            year_branch_section: "III-CSE-A",
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

         expect(result).toContain("💡 Tip: Maintain 75%+ for good attendance");
      });

      it("should add helpful tip to midmarks message", async () => {
         const mockMidmarks: Midmarks = {
            rollno: "21B81A05E9",
            year_branch_section: "III-CSE-A",
            subjects: [
               {
                  subject: "Data Structures",
                  type: "TH",
                  M1: 18,
                  M2: 20,
                  average: 19,
               },
            ],
         };

         vi.spyOn(academicTG, "getMidmarksJSON").mockResolvedValue(mockMidmarks);

         const result = await academicTG.getMidmarksMessage();

         expect(result).toContain("💡 Tip: Focus on subjects with low averages");
      });
   });

   describe("Error Message Components", () => {
      it("should include emoji indicators in all error types", async () => {
         const errorTypes = [
            new ServerDownError("test"),
            new NoDataFoundError("test"),
            new BlockedReportError("test"),
            new AcademicError("test"),
         ];

         for (const error of errorTypes) {
            vi.spyOn(academicTG, "getAttendanceJSON").mockRejectedValue(error);
            const result = await academicTG.getAttendanceMessage();

            // Should contain at least one emoji indicator
            expect(result).toMatch(/[⚠️❌🚫💡🔄⏰📦]/);
         }
      });

      it("should provide actionable steps in error messages", async () => {
         vi.spyOn(academicTG, "getAttendanceJSON").mockRejectedValue(
            new ServerDownError("test")
         );

         const result = await academicTG.getAttendanceMessage();

         expect(result).toContain("What you can do:");
         expect(result).toContain("•");
      });

      it("should log errors to console", async () => {
         const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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

   describe("Edge Cases", () => {
      it("should handle error with undefined message", async () => {
         vi.spyOn(academicTG, "getAttendanceJSON").mockRejectedValue({});

         const result = await academicTG.getAttendanceMessage();

         expect(result).toContain("Unexpected Error");
         expect(result).toBeDefined();
      });

      it("should handle error with null", async () => {
         vi.spyOn(academicTG, "getAttendanceJSON").mockRejectedValue(null);

         const result = await academicTG.getAttendanceMessage();

         expect(result).toContain("Unexpected Error");
         expect(result).toBeDefined();
      });

      it("should include roll number in NoDataFoundError messages", async () => {
         const customAcademic = new AcademicTG("22B91A1234", "pass");
         vi.spyOn(customAcademic, "getAttendanceJSON").mockRejectedValue(
            new NoDataFoundError("No data")
         );

         const result = await customAcademic.getAttendanceMessage();

         expect(result).toContain("22B91A1234");
      });
   });
});
