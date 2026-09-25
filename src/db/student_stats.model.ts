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

  /*
   * RANKING — read this before touching the SQL.
   *
   * Bug history (Sep 2026): students with identical displayed scores
   * (e.g. 30.0 mid avg) got different ranks that reshuffled between
   * refreshes. Root causes, in order of discovery:
   *
   * 1. ROW_NUMBER() assigns a unique rank per row regardless of score
   *    ties. Fix: RANK() (competition ranking) — ties share a rank,
   *    next distinct score jumps (e.g. #1,#1,#1,#4).
   *
   * 2. Ranking on raw decimals while the UI displays rounded values
   *    (29.96 and 30.04 both render as "30.0" but ranked apart).
   *    Fix: rank on the same ROUND(score, N) the UI shows.
   *
   * 3. THE NON-OBVIOUS ONE: adding a tiebreaker INSIDE the window
   *    ORDER BY (`RANK() OVER (ORDER BY score DESC, roll_no ASC)`)
   *    makes Turso/libsql compute RANK over the full (score, roll_no)
   *    composite — every row becomes unique again, ties silently die.
   *    Verified by direct SQL tests on Turso: plain `RANK() OVER
   *    (ORDER BY ROUND(x,1) DESC)` ties correctly, but adding any
   *    secondary sort key inside the window collapses them to
   *    1,2,3,4... (works "correctly" in stock SQLite, breaks on Turso's
   *    engine — do not assume compatibility here).
   *    Fix: window ORDER BY contains ONLY the score; deterministic
   *    ordering within a tie is applied in the OUTER query's ORDER BY
   *    (`ORDER BY rank ASC, roll_no ASC`), which sorts display order
   *    without affecting the computed rank.
   *
   * Result: identical scores always share the same stable rank,
   * consistent between the leaderboard list and /api/me "You are #N".
   */

  // rank on the ROUNDED score that's actually displayed (2dp attendance, 1dp mid)
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
  // COUNT(*) OVER() returns the filtered total alongside each row so the
  // count and page come from a single round trip.
  const ranked = `
      SELECT s.roll_no, s.name, st.attendance_percentage, st.mid_marks_avg,
              RANK() OVER (ORDER BY ${scoreExpr} DESC) as rank,
              COUNT(*) OVER() as total
      FROM student_stats st
      LEFT JOIN studentsnew s ON st.roll_no = s.roll_no
      ${whereClause}
  `;

  const result = await turso.execute({
    sql: `
      SELECT roll_no, name, attendance_percentage, mid_marks_avg, rank, total
      FROM (${ranked})
      ORDER BY rank ASC, roll_no ASC
      LIMIT ? OFFSET ?
    `,
    args: [...args, limit, offset],
  });

  return {
    rows: result.rows.map(({ total: _total, ...row }) => row),
    total: Number(result.rows[0]?.total || 0),
  };
};

export const initLeaderboardIndexes = async () => {
  await turso.execute(`
    CREATE INDEX IF NOT EXISTS idx_studentsnew_filters
    ON studentsnew (year, branch, section)
  `);
};

/**
 * Global rank of a single student for a given sort (no filters).
 * Uses the same RANK() + rounded-score scheme as getLeaderboard above —
 * see the ranking notes there (esp: no tiebreaker inside the window
 * ORDER BY, Turso breaks ties otherwise).
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