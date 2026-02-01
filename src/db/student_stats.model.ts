import { turso } from "./db.js";

// Initialize the table if it doesn't exist
export const initStatsTable = async () => {
  await turso.execute(`
      CREATE TABLE IF NOT EXISTS student_stats (
         roll_no TEXT PRIMARY KEY,
         attendance_percentage REAL,
         mid_marks_avg REAL,
         last_updated TEXT
      )
   `);
};

export const updateAttendanceStat = async (
  rollno: string,
  percentage: number,
) => {
  const now = new Date().toISOString();
  // Upsert logic: Insert or Update only attendance
  await turso.execute({
    sql: `
         INSERT INTO student_stats (roll_no, attendance_percentage, last_updated)
         VALUES (?, ?, ?)
         ON CONFLICT(roll_no) DO UPDATE SET
         attendance_percentage = excluded.attendance_percentage,
         last_updated = excluded.last_updated
      `,
    args: [rollno.toUpperCase(), percentage, now],
  });
};

export const updateMidMarkStat = async (rollno: string, average: number) => {
  const now = new Date().toISOString();
  // Upsert logic: Insert or Update only mid marks
  await turso.execute({
    sql: `
         INSERT INTO student_stats (roll_no, mid_marks_avg, last_updated)
         VALUES (?, ?, ?)
         ON CONFLICT(roll_no) DO UPDATE SET
         mid_marks_avg = excluded.mid_marks_avg,
         last_updated = excluded.last_updated
      `,
    args: [rollno.toUpperCase(), average, now],
  });
};

export const getLeaderboard = async (
  sortBy: "attendance" | "midmarks",
  limit: number,
  offset: number,
  filters: {
    year?: string;
    branch?: string;
    section?: string;
  } = {},
) => {
  const column =
    sortBy === "attendance" ? "attendance_percentage" : "mid_marks_avg";

  const conditions: string[] = [`st.${column} IS NOT NULL`];
  const args: any[] = [];

  if (filters.year) {
    conditions.push(`s.year = ?`);
    args.push(filters.year);
  }

  if (filters.branch) {
    conditions.push(`s.branch = ?`);
    args.push(filters.branch);
  }

  if (filters.section && filters.section !== "all") {
    // Assuming front-end sends "all" for no filter, but good to handle explicit logic
    conditions.push(`s.section = ?`);
    args.push(filters.section);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // We need to add limit and offset to args at the end
  args.push(limit, offset);

  const result = await turso.execute({
    sql: `
         SELECT s.roll_no, s.name, st.attendance_percentage, st.mid_marks_avg
         FROM student_stats st
         LEFT JOIN studentsnew s ON st.roll_no = s.roll_no
         ${whereClause}
         ORDER BY st.${column} DESC
         LIMIT ? OFFSET ?
      `,
    args: args,
  });

  return result.rows;
};
