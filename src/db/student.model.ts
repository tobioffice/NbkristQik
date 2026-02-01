import { turso } from "./db.js";
import { Student } from "../types/index.js";

export const getStudent = async (rollno: string) => {
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
};
