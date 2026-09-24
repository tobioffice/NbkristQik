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
    search?: string;
  } = {},
) => {
  const column =
    sortBy === "attendance" ? "attendance_percentage" : "mid_marks_avg";

  // rank on the ROUNDED score that's actually displayed (2dp attendance, 1dp mid)
  // + deterministic roll_no tiebreaker → ties share rank, stable order
  const scoreExpr =
    sortBy === "attendance"
      ? "ROUND(st.attendance_percentage, 2)"
      : "ROUND(st.mid_marks_avg, 1)";

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
    conditions.push(`s.section = ?`);
    args.push(filters.section);
  }

  if (filters.search) {
    // match roll number (case-insensitive) or name
    conditions.push(
      `(UPPER(st.roll_no) LIKE ? OR UPPER(COALESCE(s.name, '')) LIKE ?)`,
    );
    const pattern = `%${filters.search.toUpperCase()}%`;
    args.push(pattern, pattern);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // rank computed over the full filtered set, then paginated.
  // NOTE: tiebreaker (roll_no) must NOT be inside the window ORDER BY —
  // Turso computes RANK over the full composite, killing ties.
  // Tiebreak in the outer ORDER BY instead.
  const ranked = `
      SELECT s.roll_no, s.name, st.attendance_percentage, st.mid_marks_avg,
             RANK() OVER (ORDER BY ${scoreExpr} DESC) as rank
      FROM student_stats st
      LEFT JOIN studentsnew s ON st.roll_no = s.roll_no
      ${whereClause}
  `;

  // total count for the same filters (for "your rank" context)
  const countResult = await turso.execute({
    sql: `
      SELECT COUNT(*) as total
      FROM student_stats st
      LEFT JOIN studentsnew s ON st.roll_no = s.roll_no
      ${whereClause}
    `,
    args: args,
  });

  const args2 = [...args, limit, offset];

  const result = await turso.execute({
    sql: `
      SELECT roll_no, name, attendance_percentage, mid_marks_avg, rank
      FROM (${ranked})
      ORDER BY rank ASC, roll_no ASC
      LIMIT ? OFFSET ?
    `,
    args: args2,
  });

  return {
    rows: result.rows,
    total: Number(countResult.rows[0]?.total || 0),
  };
};

/**
 * Global rank of a single student for a given sort (no filters).
 * ROW_NUMBER() over the whole table for that metric.
 */
export const getStudentRank = async (
  rollNo: string,
  sortBy: "attendance" | "midmarks",
): Promise<{ rank: number; total: number } | null> => {
  const column =
    sortBy === "attendance" ? "attendance_percentage" : "mid_marks_avg";

  const scoreExpr =
    sortBy === "attendance"
      ? "ROUND(attendance_percentage, 2)"
      : "ROUND(mid_marks_avg, 1)";

  const result = await turso.execute({
    sql: `
      WITH ranked AS (
        SELECT roll_no,
               RANK() OVER (ORDER BY ${scoreExpr} DESC) as rank
        FROM student_stats
        WHERE ${column} IS NOT NULL
      )
      SELECT rank FROM ranked WHERE roll_no = ?
    `,
    args: [rollNo.toUpperCase()],
  });

  if (!result.rows[0]) return null;

  const totalResult = await turso.execute({
    sql: `SELECT COUNT(*) as total FROM student_stats WHERE ${column} IS NOT NULL`,
  });

  return {
    rank: Number(result.rows[0].rank),
    total: Number(totalResult.rows[0]?.total || 0),
  };
};

/**
 * Uptime heartbeat recorder — one row per ping per component.
 * Pruned to last 95 days by the caller.
 */
export const recordHeartbeat = async (
  component: string,
  status: "up" | "down",
  latencyMs: number | null,
) => {
  await turso.execute({
    sql: `INSERT INTO uptime_log (component, status, latency_ms) VALUES (?, ?, ?)`,
    args: [component, status, latencyMs],
  });
};

export const initUptimeTable = async () => {
  await turso.execute(`
      CREATE TABLE IF NOT EXISTS uptime_log (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         component TEXT NOT NULL,
         status TEXT NOT NULL,
         latency_ms INTEGER,
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
   `);
  // index for fast aggregation
  await turso.execute(`
      CREATE INDEX IF NOT EXISTS idx_uptime_component_time
      ON uptime_log (component, created_at);
   `);
};

/**
 * 90-day uptime summary: % up, incidents, current status per component.
 */
export const getUptimeSummary = async () => {
  const result = await turso.execute(`
      SELECT component,
             COUNT(*) as pings,
             SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as ups,
             MAX(created_at) as last_ping,
             AVG(CASE WHEN status = 'up' THEN latency_ms END) as avg_latency
      FROM uptime_log
      WHERE created_at >= datetime('now', '-90 days')
      GROUP BY component
      ORDER BY component
  `);

  return result.rows.map((r) => ({
    component: String(r.component),
    pings: Number(r.pings),
    ups: Number(r.ups),
    uptimePct: (Number(r.ups) / Number(r.pings)) * 100,
    lastPing: String(r.last_ping),
    avgLatencyMs: r.avg_latency != null ? Math.round(Number(r.avg_latency)) : null,
  }));
};

/**
 * Daily uptime buckets for status bars (last N days, one entry per day).
 */
export const getUptimeDailyBuckets = async (
  component: string,
  days: number = 90,
) => {
  const result = await turso.execute({
    sql: `
      SELECT date(created_at) as day,
             COUNT(*) as pings,
             SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as ups,
             AVG(CASE WHEN status = 'up' THEN latency_ms END) as avg_latency
      FROM uptime_log
      WHERE component = ? AND created_at >= datetime('now', '-${days} days')
      GROUP BY day
      ORDER BY day
    `,
    args: [component],
  });

  return result.rows.map((r) => ({
    day: String(r.day),
    pings: Number(r.pings),
    ups: Number(r.ups),
    avgLatencyMs: r.avg_latency != null ? Math.round(Number(r.avg_latency)) : null,
  }));
};