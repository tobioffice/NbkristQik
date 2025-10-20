import { turso } from "./db.js";
import { Student } from "../types/index.js";

export const getStudent = async (rollno: string) => {
  try {
    rollno = rollno.toUpperCase();

    const studentSet = await turso.execute({
      sql: `SELECT * FROM studentsnew WHERE roll_no = ?`,
      args: [rollno],
    });

    if (!studentSet.rows[0]) {
      throw new Error("Student not found");
    }

    const temp = studentSet.rows[0];

    const student = {
      roll_no: temp.roll_no,
      name: temp.name,
      section: temp.section,
      branch: temp.branch,
      year: temp.year,
    } as Student;

    return student;
  } catch (error) {
    console.error("Error fetching student:", error);
    throw error;
  }
};

export const getStudentsWithSameClass = async (student: Student) => {
  try {
    const studentSet = await turso.execute({
      sql: `SELECT roll_no FROM studentsnew WHERE year = ? AND branch = ? AND section = ?`,
      args: [student.year, student.branch, student.section],
    });

    const rollNumbers: string[] = studentSet.rows.map(
      (row) => row.roll_no as string,
    );

    return rollNumbers;
  } catch (error) {
    console.error("Error fetching students with same class:", error);
    throw error;
  }
};
