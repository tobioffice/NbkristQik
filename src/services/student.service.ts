import { AcademicTG } from "./student.utils/AcademicTG.js";
import type { LookupResult } from "./student.utils/errorMessages.js";

export const createAcademicTG = (
  rollNumber: string,
  barBackground?: string,
) => {
  const academicTG = new AcademicTG(rollNumber, barBackground);
  return academicTG;
};

// Export helper methods
export const getAttendance = (rollNumber: string) =>
  createAcademicTG(rollNumber).getAttendanceMessage();

export const getMidMarks = (rollNumber: string) =>
  createAcademicTG(rollNumber).getMidmarksMessage();

export const getBunkPlan = (rollNumber: string) =>
  createAcademicTG(rollNumber).getBunkPlanMessage();

// Bot cards: the text plus the buttons that belong with it (suggested rolls
// on "not found", for example). Text-only callers keep the helpers above.
export const getAttendanceCard = (
  rollNumber: string,
  barBackground?: string,
): Promise<LookupResult> =>
  createAcademicTG(rollNumber, barBackground).getAttendanceResult();

export const getMidMarksCard = (rollNumber: string): Promise<LookupResult> =>
  createAcademicTG(rollNumber).getMidmarksResult();

export const getBunkPlanCard = (rollNumber: string): Promise<LookupResult> =>
  createAcademicTG(rollNumber).getBunkPlanResult();
