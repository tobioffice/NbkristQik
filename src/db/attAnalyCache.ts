import { turso } from "./db.js";
import { Attendance } from "../types/index.js";

export interface AttendanceAnalyCache {
  roll_no: string;
  attendance_data: Attendance; // JSON stringified data
  last_updated: string; // ISO date string
}

export const dropAttendanceCacheTable = async () => {
  await turso.execute({
    sql: `DROP TABLE IF EXISTS attendance_cache`,
    args: [],
  });
};

export const createTableIfNotExists = async () => {
  await turso.execute({
    sql: `
      CREATE TABLE IF NOT EXISTS attendance_cache (
        roll_no TEXT ,
        attendance_data TEXT NOT NULL,
        last_updated date NOT NULL
      )
    `,
    args: [],
  });
};

export const upsertAttendanceCache = async (
  roll_no: string,
  attendance_data: string,
  last_updated: string
) => {
  await turso.execute({
    sql: `
      INSERT INTO attendance_cache (roll_no, attendance_data, last_updated)
      VALUES (?, ?, ?)
    `,
    args: [roll_no, attendance_data, last_updated],
  });
};

export const getAttendanceCache = async (
  roll_no: string,
  last_updated: string
): Promise<AttendanceAnalyCache | null> => {
  const result = await turso.execute({
    sql: `
      SELECT * FROM attendance_cache
      WHERE roll_no = ? AND last_updated = ?
    `,
    args: [roll_no.toUpperCase(), last_updated],
  });

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    roll_no: row.roll_no as string,
    attendance_data: JSON.parse(row.attendance_data as string) as Attendance,
    last_updated: row.last_updated as string,
  };
};
