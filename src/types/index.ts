//Interfaces
export interface IAcademic {
   rollnumber: string;
   getAttendanceJSON(): Promise<Attendance | null>;
   getMidmarksJSON(): Promise<Midmarks | null>;
}

//Types
export type AttendanceBySubject = {
   subject: string;
   attended: number;
   conducted: number;
   lastUpdated: string;
};

export type MidmarksBySubject = {
   subject: string;
   M1: number | null;
   M2: number | null;
   average: number | null;
   type: string;
};

//exporting types
export type StudentBase = {
   rollno: string;
   year_branch_section: string;
};

export type Attendance = StudentBase & {
   percentage: number;

   totalClasses: {
      attended: number;
      conducted: number;
   };

   subjects: AttendanceBySubject[];
};

export type Midmarks = StudentBase & {
   subjects: MidmarksBySubject[];
};

export type Student = {
   roll_no: string;
   name: string;
   section: string;
   branch: string;
   year: string;
};

export interface StudentStat {
   roll_no: string;
   attendance_percentage: number | null;
   mid_marks_avg: number | null;
   last_updated: string;
}