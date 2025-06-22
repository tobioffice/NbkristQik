import { AcadamicTG } from "./utils/AcadamicTG";

export const createAcademicTG = (rollNumber: string) => {
    const academicTG = new AcadamicTG(rollNumber);
    return academicTG;
};

// Export helper methods
export const getAttendance = (rollNumber: string) => createAcademicTG(rollNumber).getAttendanceMessage();
export const getMidMarks = (rollNumber: string) => createAcademicTG(rollNumber).getMidmarksMessage();
