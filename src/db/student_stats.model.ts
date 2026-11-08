import { turso } from "./db.js";
import { logger } from "../config/logger.js";

// Initialize the table if it doesn't exist. New databases get the v2 columns
// directly; init.ts alters an existing v1 table (guarded by user_version).
export const initStatsTable = async () => {
  await turso.execute(`
      CREATE TABLE IF NOT EXISTS student_stats (
         roll_no TEXT PRIMARY KEY,
         attendance_percentage REAL,
         mid_marks_avg REAL,
         last_updated TEXT,
         attendance_updated_at TEXT,
         midmarks_updated_at TEXT,
         year_sem TEXT
      )
   `);
};

/** One attendance/mid-mark row for the section batch writers. */
export interface StatRow {
  roll: string;
  value: number;
  /** e.g. "32"; the semester the value belongs to. */
  yearSem: string;
}

// Every writer stamps the per-metric timestamp (and year_sem) alongside the
// legacy last_updated. last_updated stays for older readers; the leaderboard
// honesty work reads the per-metric columns.
const attendanceStatStatement = (
  roll: string,
  percentage: number,
  yearSem: string | null,
) => ({
  sql: `
       INSERT INTO student_stats
         (roll_no, attendance_percentage, attendance_updated_at, year_sem, last_updated)
       VALUES (?, ?, datetime('now'), ?, datetime('now'))
       ON CONFLICT(roll_no) DO UPDATE SET
       attendance_percentage = excluded.attendance_percentage,
       attendance_updated_at = excluded.attendance_updated_at,
       year_sem = COALESCE(excluded.year_sem, student_stats.year_sem),
       last_updated = excluded.last_updated
    `,
  args: [roll.toUpperCase(), percentage, yearSem],
});

const midMarkStatStatement = (
  roll: string,
  average: number,
  yearSem: string | null,
) => ({
  sql: `
       INSERT INTO student_stats
         (roll_no, mid_marks_avg, midmarks_updated_at, year_sem, last_updated)
       VALUES (?, ?, datetime('now'), ?, datetime('now'))
       ON CONFLICT(roll_no) DO UPDATE SET
       mid_marks_avg = excluded.mid_marks_avg,
       midmarks_updated_at = excluded.midmarks_updated_at,
       year_sem = COALESCE(excluded.year_sem, student_stats.year_sem),
       last_updated = excluded.last_updated
    `,
  args: [roll.toUpperCase(), average, yearSem],
});

export const updateAttendanceStat = async (
  rollno: string,
  percentage: number,
  yearSem?: string,
) => {
  // last_updated uses SQLite's datetime('now') format (UTC, no ms) to match
  // every other table in the schema — comparisons like datetime('now', ...)
  // stay consistent.
  await turso.execute(
    attendanceStatStatement(rollno, percentage, yearSem ?? null),
  );
};

export const updateMidMarkStat = async (
  rollno: string,
  average: number,
  yearSem?: string,
) => {
  // see updateAttendanceStat for the last_updated format rationale
  await turso.execute(midMarkStatStatement(rollno, average, yearSem ?? null));
};

/**
 * Writes one section's attendance stats in one write transaction.
 *
 * A batch is all-or-nothing: one malformed row would otherwise drop the whole
 * section silently. On failure, retry per row so the good rows still land and
 * every failed roll is logged by name.
 */
export const updateAttendanceStats = async (rows: StatRow[]): Promise<void> => {
  if (rows.length === 0) return;
  const statements = rows.map((row) =>
    attendanceStatStatement(row.roll, row.value, row.yearSem),
  );

  try {
    await turso.batch(statements, "write");
  } catch (error) {
    logger.warn(
      `[leaderboard] attendance stat batch failed (${rows.length} row(s)) — retrying one by one:`,
      error,
    );
    for (const row of rows) {
      try {
        await turso.execute(
          attendanceStatStatement(row.roll, row.value, row.yearSem),
        );
      } catch (rowError) {
        logger.warn(
          `[leaderboard] attendance stat write failed for ${row.roll}:`,
          rowError,
        );
      }
    }
  }
};

/** Mid-mark counterpart of `updateAttendanceStats` (same retry policy). */
export const updateMidMarkStats = async (rows: StatRow[]): Promise<void> => {
  if (rows.length === 0) return;
  const statements = rows.map((row) =>
    midMarkStatStatement(row.roll, row.value, row.yearSem),
  );

  try {
    await turso.batch(statements, "write");
  } catch (error) {
    logger.warn(
      `[leaderboard] mid-mark stat batch failed (${rows.length} row(s)) — retrying one by one:`,
      error,
    );
    for (const row of rows) {
      try {
        await turso.execute(
          midMarkStatStatement(row.roll, row.value, row.yearSem),
        );
      } catch (rowError) {
        logger.warn(
          `[leaderboard] mid-mark stat write failed for ${row.roll}:`,
          rowError,
        );
      }
    }
  }
};

export interface LeaderboardFilters {
  year?: string;
  branch?: string;
  section?: string;
  search?: string;
}

export interface LeaderboardOptions {
  /**
   * Include student names. Public/anonymous callers pass false so the page
   * cannot harvest a name for every roll; the SQL then returns NULL names.
   * Defaults to true to keep internal callers (bot, warm cache) unchanged.
   */
  includeNames?: boolean;
  /**
   * Let the search filter match names as well as rolls. Defaults to
   * includeNames, so an anonymous search is a roll lookup only.
   */
  searchNames?: boolean;
}

interface LeaderboardWhere {
  whereClause: string;
  args: (string | number)[];
}

const buildLeaderboardWhere = (
  column: string,
  filters: LeaderboardFilters,
  searchNames: boolean,
): LeaderboardWhere => {
  const conditions: string[] = [
    `st.${column} IS NOT NULL`,
    // A row from an earlier semester must not keep ranking after the portal
    // switches. year_sem is written with every stat; the migration backfills
    // it from studentsnew. Rows still null are excluded (and logged at boot).
    `st.year_sem = s.year`,
  ];
  const args: (string | number)[] = [];

  if (filters.year) {
    // studentsnew.year is "11".."42" (year-semester). The UI filters by year
    // only, so match the leading digit: year 1 covers both 11 and 12.
    conditions.push(`SUBSTR(s.year, 1, 1) = ?`);
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
    const pattern = `%${filters.search.toUpperCase()}%`;
    if (searchNames) {
      // Match roll number or the SAME display name the row prints. If a
      // student set a pseudonym, searching their real name must not reveal
      // them; searching the pseudonym must find them.
      conditions.push(
        `(UPPER(st.roll_no) LIKE ? OR UPPER(${registrationAwareName()}) LIKE ?)`,
      );
      args.push(pattern, pattern);
    } else {
      // anonymous callers may search rolls only — names are not in the payload
      conditions.push(`UPPER(st.roll_no) LIKE ?`);
      args.push(pattern);
    }
  }

  return {
    whereClause:
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    args,
  };
};

// rank computed over the full filtered set, then paginated.
// NOTE: tiebreaker (roll_no) must NOT be inside the window ORDER BY —
// Turso computes RANK over the full composite, killing ties (see the
// ranking notes in the git history / docs). Tiebreak in the outer
// ORDER BY instead. COUNT(*) OVER() returns the filtered total alongside
// each row so the count and page come from a single round trip.
/*
 * GHOST ROWS — read this before touching the SQL.
 *
 * student_stats can contain scores for roll numbers that no longer exist in
 * studentsnew (student re-sectioned, typo'd roll, or roll wiped by a sync).
 * LEFT JOIN would list them with roll_no = NULL and no name — blank ghost
 * rows in the web leaderboard. Use an INNER JOIN so only students who exist
 * in the master table rank.
 */
const rankedSubQuery = (
  scoreExpr: string,
  nameExpr: string,
  whereClause: string,
): string => `
      SELECT s.roll_no, ${nameExpr} AS name, st.attendance_percentage, st.mid_marks_avg,
              RANK() OVER (ORDER BY ${scoreExpr} DESC) as rank,
              COUNT(*) OVER() as total
      FROM student_stats st
      JOIN studentsnew s ON st.roll_no = s.roll_no
      ${whereClause}
  `;

/*
 * The name shown on the leaderboard.
 *
 * An explicit registration's display_name wins over the master-table name,
 * per roll. It must be a scalar subquery, not a JOIN: registrations can hold
 * more than one row for the same roll (before the unique index, or after a
 * manual fix), and a JOIN would duplicate every leaderboard row. ORDER BY
 * updated_at DESC makes the newest claim win deterministically.
 */
const registrationAwareName = (): string =>
  `COALESCE((SELECT r.display_name
             FROM registrations r
             WHERE r.roll_no = s.roll_no AND r.display_name IS NOT NULL
             ORDER BY r.updated_at DESC
             LIMIT 1), s.name)`;

// Page beyond the end: rows are empty so COUNT(*) OVER() is gone with them.
// Fall back to a plain COUNT so the UI keeps its "N students" banner.
const countFilteredTotal = async (
  whereClause: string,
  args: (string | number)[],
): Promise<number> => {
  const countResult = await turso.execute({
    sql: `
        SELECT COUNT(*) as total
        FROM student_stats st
        JOIN studentsnew s ON st.roll_no = s.roll_no
        ${whereClause}
      `,
    args,
  });
  return Number(countResult.rows[0]?.total || 0);
};

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
export const getLeaderboard = async (
  sortBy: "attendance" | "midmarks",
  limit: number,
  offset: number,
  filters: LeaderboardFilters = {},
  options: LeaderboardOptions = {},
) => {
  const column =
    sortBy === "attendance" ? "attendance_percentage" : "mid_marks_avg";

  const includeNames = options.includeNames ?? true;
  const searchNames = includeNames && (options.searchNames ?? true);

  // rank on the ROUNDED score that's actually displayed (2dp attendance, 1dp mid)
  const scoreExpr =
    sortBy === "attendance"
      ? "ROUND(st.attendance_percentage, 2)"
      : "ROUND(st.mid_marks_avg, 1)";

  const nameExpr = includeNames ? registrationAwareName() : "NULL";

  const { whereClause, args } = buildLeaderboardWhere(
    column,
    filters,
    searchNames,
  );

  const result = await turso.execute({
    sql: `
      SELECT roll_no, name, attendance_percentage, mid_marks_avg, rank, total
      FROM (${rankedSubQuery(scoreExpr, nameExpr, whereClause)})
      ORDER BY rank ASC, roll_no ASC
      LIMIT ? OFFSET ?
    `,
    args: [...args, limit, offset],
  });

  if (result.rows.length === 0) {
    return { rows: [], total: await countFilteredTotal(whereClause, args) };
  }

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
): Promise<{ rank: number; total: number; value: number | null } | null> => {
  const column =
    sortBy === "attendance" ? "attendance_percentage" : "mid_marks_avg";

  const scoreExpr =
    sortBy === "attendance"
      ? "ROUND(attendance_percentage, 2)"
      : "ROUND(mid_marks_avg, 1)";

  // Single round trip: rank + COUNT(*) OVER() over the same filtered set.
  // INNER JOIN studentsnew so ghost stats rows (student gone from the master
  // table) can't hand the caller a bogus rank.
  const result = await turso.execute({
    sql: `
      WITH ranked AS (
        SELECT st.roll_no,
               ${scoreExpr} as score,
               RANK() OVER (ORDER BY ${scoreExpr} DESC) as rank,
               COUNT(*) OVER() as total
        FROM student_stats st
        JOIN studentsnew s ON st.roll_no = s.roll_no
        WHERE ${column} IS NOT NULL
          AND st.year_sem = s.year
      )
      SELECT rank, total, score FROM ranked WHERE roll_no = ?
    `,
    args: [rollNo.toUpperCase()],
  });

  if (!result.rows[0]) return null;

  return {
    rank: Number(result.rows[0].rank),
    total: Number(result.rows[0].total || 0),
    // the same rounded figure the register prints, so the strip and the row
    // can never disagree
    value: result.rows[0].score == null ? null : Number(result.rows[0].score),
  };
};

/**
 * The sections that actually exist for the chosen year/branch, so the filter
 * offers live options instead of a hard-coded A-J.
 */
export const getLeaderboardFacets = async (
  filters: Pick<LeaderboardFilters, "year" | "branch">,
): Promise<string[]> => {
  const conditions: string[] = ["section IS NOT NULL", "TRIM(section) <> ''"];
  const args: string[] = [];

  if (filters.year) {
    // same leading-digit rule as buildLeaderboardWhere: 1 covers 11 and 12
    conditions.push("SUBSTR(year, 1, 1) = ?");
    args.push(filters.year);
  }
  if (filters.branch) {
    conditions.push("branch = ?");
    args.push(filters.branch);
  }

  const result = await turso.execute({
    sql: `SELECT DISTINCT section FROM studentsnew WHERE ${conditions.join(" AND ")} ORDER BY section ASC`,
    args,
  });

  return result.rows.map((row) => String(row.section));
};

/**
 * How many students the directory knows for the same filters the ranked
 * leaderboard uses. `ranked` counts students with a current-semester stat;
 * `known` counts the master table, so the UI can print "412 of 1,240 known
 * students" instead of implying the register is the whole college.
 *
 * Search is deliberately not accepted here: a search is not a coverage view,
 * and the caller returns `coverage: null` when one is present.
 */
export const getLeaderboardCoverage = async (
  filters: Pick<LeaderboardFilters, "year" | "branch" | "section">,
): Promise<number> => {
  const conditions: string[] = [];
  const args: string[] = [];

  if (filters.year) {
    // same leading-digit rule as buildLeaderboardWhere: 1 covers 11 and 12
    conditions.push("SUBSTR(year, 1, 1) = ?");
    args.push(filters.year);
  }
  if (filters.branch) {
    conditions.push("branch = ?");
    args.push(filters.branch);
  }
  if (filters.section && filters.section !== "all") {
    conditions.push("section = ?");
    args.push(filters.section);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await turso.execute({
    sql: `SELECT COUNT(*) as total FROM studentsnew ${where}`,
    args,
  });

  return Number(result.rows[0]?.total || 0);
};

/**
 * When the attendance or mid-mark numbers were last written (UTC, SQLite
 * datetime format).
 *
 * Each metric has its own timestamp: a lookup that refreshes attendance says
 * nothing about the mid-marks, so MAX over one shared `last_updated` made the
 * whole register look fresh. A register that fills as students look themselves
 * up also has a range, not one timestamp, so both ends are returned.
 */
export const getLastSyncAt = async (
  sortBy: "attendance" | "midmarks" = "attendance",
): Promise<{ newest: string | null; oldest: string | null }> => {
  const column =
    sortBy === "midmarks" ? "midmarks_updated_at" : "attendance_updated_at";

  const result = await turso.execute(
    `SELECT MAX(st.${column}) AS newest, MIN(st.${column}) AS oldest
     FROM student_stats st
     JOIN studentsnew s ON st.roll_no = s.roll_no
     WHERE st.year_sem = s.year
       AND st.${column} IS NOT NULL`,
  );

  const newest = result.rows[0]?.newest;
  const oldest = result.rows[0]?.oldest;
  return {
    newest: newest == null ? null : String(newest),
    oldest: oldest == null ? null : String(oldest),
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
  // Millisecond precision keeps two probes in the same wall-clock second
  // distinct under the (component, created_at) unique key; the old 5-minute
  // probe never needed it, but a restart or a manual probe can collide.
  await turso.execute({
    sql: `INSERT OR IGNORE INTO uptime_log (component, status, latency_ms, created_at)
          VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    args: [component, status, latencyMs],
  });
};

/**
 * Records a heartbeat captured by the external monitor, with the timestamp
 * from the moment of the probe. Retries after an outage replay old rows, so
 * the same (component, created_at) is only inserted once.
 */
export const recordHeartbeatAt = async (
  component: string,
  status: "up" | "down",
  latencyMs: number | null,
  at: string,
) => {
  await turso.execute({
    sql: `INSERT OR IGNORE INTO uptime_log
            (component, status, latency_ms, created_at)
          VALUES (?, ?, ?, ?)`,
    args: [component, status, latencyMs, at],
  });
};

/**
 * Replays a batch of monitor rows in one write transaction. Each row is
 * idempotent by the (component, created_at) unique key, so a spool flush can
 * be retried safely and no longer costs one round trip per row.
 */
export const recordHeartbeatsAt = async (
  rows: {
    component: string;
    status: "up" | "down";
    latencyMs: number | null;
    at: string;
  }[],
): Promise<void> => {
  if (rows.length === 0) return;
  await turso.batch(
    rows.map((row) => ({
      sql: `INSERT OR IGNORE INTO uptime_log
              (component, status, latency_ms, created_at)
            VALUES (?, ?, ?, ?)`,
      args: [row.component, row.status, row.latencyMs, row.at],
    })),
    "write",
  );
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
  // the database probe used to be recorded as "turso" (cloud era); fold
  // those rows into "database" so the status page keeps one row + history
  await turso.execute(
    `UPDATE uptime_log SET component = 'database' WHERE component = 'turso'`,
  );
  // One heartbeat per component per timestamp. Older check-then-insert rows
  // can contain duplicates; keep the first and add the unique backstop so a
  // replay is idempotent by construction, not by a race-prone query.
  await turso.execute(`
    DELETE FROM uptime_log
    WHERE id NOT IN (
      SELECT MIN(id) FROM uptime_log GROUP BY component, created_at
    )
  `);
  await turso.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_uptime_component_at
    ON uptime_log (component, created_at)
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
             (SELECT u2.status FROM uptime_log u2
               WHERE u2.component = uptime_log.component
               ORDER BY u2.created_at DESC, u2.id DESC
               LIMIT 1) as last_status,
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
    lastStatus: String(r.last_status),
    avgLatencyMs:
      r.avg_latency != null ? Math.round(Number(r.avg_latency)) : null,
  }));
};

/**
 * Daily uptime buckets for status bars (last N days, one entry per day).
 */
export const getUptimeDailyBuckets = async (
  component: string,
  days: number = 90,
) => {
  // clamp to a plain integer — it's interpolated into a datetime() modifier
  const safeDays = Math.max(1, Math.min(365, Math.floor(Number(days) || 90)));
  const result = await turso.execute({
    sql: `
      SELECT date(created_at, '+330 minutes') as day,
              COUNT(*) as pings,
              SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as ups,
              AVG(CASE WHEN status = 'up' THEN latency_ms END) as avg_latency
      FROM uptime_log
      WHERE component = ? AND created_at >= datetime('now', '-${safeDays} days')
      GROUP BY day
      ORDER BY day
    `,
    args: [component],
  });

  return result.rows.map((r) => ({
    day: String(r.day),
    pings: Number(r.pings),
    ups: Number(r.ups),
    avgLatencyMs:
      r.avg_latency != null ? Math.round(Number(r.avg_latency)) : null,
  }));
};
