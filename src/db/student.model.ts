import { turso } from "./db.js";
import { Student } from "../types/index.js";

export const getStudent = async (rollno: string) => {
  rollno = rollno.toUpperCase();

  const studentSet = await turso.execute({
    sql: `SELECT * FROM studentsnew WHERE roll_no = ?`,
    args: [rollno],
  });

  if (!studentSet.rows[0]) {
    return null;
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

/**
 * Finds similar roll numbers in DB for "did you mean" suggestions.
 * Matches: same branch+entry-year with nearby sequence numbers, or prefix matches.
 */
export const findSimilarRolls = async (rollno: string, limit = 3): Promise<string[]> => {
  rollno = rollno.toUpperCase();

  // try prefix (first 8 chars = year+branch code) with wildcard suffix
  const prefix = rollno.slice(0, 8);
  const result = await turso.execute({
    sql: `SELECT roll_no FROM studentsnew WHERE roll_no LIKE ? AND roll_no != ? LIMIT ?`,
    args: [`${prefix}%`, rollno, limit * 4],
  });

  const candidates = result.rows.map((r) => String(r.roll_no));
  if (candidates.length === 0) return [];

  // rank by numeric distance on the trailing sequence
  const seq = parseInt(rollno.slice(8), 36);
  const scored = candidates
    .map((c) => {
      const cSeq = parseInt(c.slice(8), 36);
      const dist = isNaN(seq) || isNaN(cSeq) ? 999 : Math.abs(cSeq - seq);
      return { c, dist };
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit)
    .map((x) => x.c);

  return scored;
};