
//Interfaces
export interface IAcadamic {
    rollnumber: string;
    getAttendanceJSON(): Promise<Attendance>;
    getMidmarksJSON(): Promise<Midmarks>;
}

//Types
export type AttendanceBySubjects = {
    subject: string;
    attended: number;
    conducted: number;
    lastUpdated: string;
}

export type MidmarksBySubjects = {
    subject: string;
    M1: number | null;
    M2: number | null;
    avarage: number | null;
    type: string;
}


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

    subjects: AttendanceBySubjects[];
}

export type Midmarks = StudentBase & {
    subjects: MidmarksBySubjects[];
}

export type Student = {
    roll_no: string;
    name: string;
    section: string;
    branch: string;
    year: string;
}


