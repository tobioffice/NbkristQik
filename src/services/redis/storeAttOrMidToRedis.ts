import { getClient } from "./getRedisClient.js";
import { redisKeys } from "./keys.js";
import {
  StatRow,
  updateAttendanceStats,
  updateMidMarkStats,
} from "../../db/student_stats.model.js";
import { Attendance, Midmarks } from "../../types/index.js";
import { logger } from "../../config/logger.js";
import {
  parseAttendanceSection,
  parseMidmarksSection,
  SectionContext,
} from "../student.utils/parsers.js";

const CACHE_TTL_ATTENDANCE_S = 60 * 60;
const CACHE_TTL_MIDMARKS_S = 60 * 60 * 2;

interface SectionWrite<T> {
  roll: string;
  payload: T;
  value: number; // attendance % or mid average persisted to student_stats
}

/**
 * Writes one section's stats in one DB batch and one Redis fan-out.
 *
 * The leaderboard stat is the durable output: the batch is attempted
 * unconditionally and never gated on Redis. A Redis connect can take seconds
 * to fail, so it runs alongside the DB batch instead of first; every cache key
 * is written best-effort, so a cache outage cannot fail (or veto) the stats.
 */
const persistSectionWrites = async <T>(
  writes: SectionWrite<T>[],
  cacheKey: (roll: string) => string,
  ttlSeconds: number,
  writeStats: (rows: StatRow[]) => Promise<void>,
  yearSem: string,
) => {
  if (writes.length === 0) return;

  const statRows: StatRow[] = writes.map(({ roll, value }) => ({
    roll,
    value,
    yearSem,
  }));

  // One batch per section. A batch failure is handled inside the writer
  // (logged per roll, retried one by one); it never rejects this function.
  const dbWrite = writeStats(statRows).catch((e) => {
    logger.warn(
      `[leaderboard] stat batch write failed for ${statRows.length} row(s):`,
      e,
    );
  });

  const cacheWrite = (async () => {
    // A failure is expected when Redis is down and must not reject the batch.
    const redisClient = await getClient().catch((e) => {
      logger.warn(
        "[cache] Redis unavailable — student stats still written:",
        e,
      );
      return null;
    });

    if (!redisClient) return;

    // One fan-out over a single connected client; node-redis pipelines the
    // concurrently issued SETs instead of paying one round trip per await.
    await Promise.all(
      writes.map(({ roll, payload }) =>
        redisClient
          .set(cacheKey(roll), JSON.stringify(payload), { EX: ttlSeconds })
          .catch((e) => {
            logger.warn(`[cache] Redis write failed for ${roll}:`, e);
          }),
      ),
    );
  })();

  await Promise.all([dbWrite, cacheWrite]);
};

/**
 * Persists an already-parsed attendance section.
 *
 * The caller parses the report once for the requester, then hands the same map
 * here for the section-wide stats/cache write. No second cheerio.load.
 */
export const persistAttendanceSection = async (
  students: Map<string, Attendance>,
  context: SectionContext,
) => {
  const writes: SectionWrite<Attendance>[] = [...students.values()].map(
    (attendance) => ({
      roll: attendance.rollno.toUpperCase(),
      payload: attendance,
      value: attendance.percentage,
    }),
  );

  await persistSectionWrites(
    writes,
    redisKeys.attendance,
    CACHE_TTL_ATTENDANCE_S,
    updateAttendanceStats,
    context.yearSem,
  );

  logger.debug(
    `cached all student attendance for : ${context.yearSem}/${context.branch}/${context.section}`,
  );
};

/**
 * Caches a whole section's attendance in the background.
 *
 * The report is parsed once for the whole section (one cheerio.load) and the
 * section context comes from the caller's request — no per-row student
 * lookup. Stats and cache writes still fan out, see persistSectionWrites.
 */
export const storeAttendanceToRedis = async (
  doc: string,
  context: SectionContext,
) => {
  await persistAttendanceSection(parseAttendanceSection(doc, context), context);
};

export const persistMidmarksSection = async (
  students: Map<string, Midmarks>,
  context: SectionContext,
) => {
  const writes: SectionWrite<Midmarks>[] = [];
  for (const [roll, studentMidmarks] of students) {
    const zeroMarkSubjects = studentMidmarks.subjects.filter(
      (sub) => (sub.M1 || 0) === 0 && (sub.M2 || 0) === 0,
    ).length;

    let average =
      studentMidmarks.subjects.reduce((acc, sub) => {
        const m1 = sub.M1 || 0;
        const m2 = sub.M2 || 0;
        // If M2 is present, take average of M1 and M2. Otherwise, just use M1.
        const subjectScore = m2 > 0 ? (m1 + m2) / 2 : m1;
        return acc + subjectScore;
      }, 0) / (studentMidmarks.subjects.length - zeroMarkSubjects || 1);

    // Year 41 is marked out of 40 while the others are out of 30. The year
    // comes from the request context now, not a per-row student lookup.
    if (context.yearSem === "41") {
      average = (average / 40) * 30;
    }

    writes.push({
      roll: roll.toUpperCase(),
      payload: studentMidmarks,
      value: average,
    });
  }

  await persistSectionWrites(
    writes,
    redisKeys.midmarks,
    CACHE_TTL_MIDMARKS_S,
    updateMidMarkStats,
    context.yearSem,
  );

  logger.debug(
    `cached all student midmarks for : ${context.yearSem}/${context.branch}/${context.section}`,
  );
};

export const storeMidMarksToRedis = async (
  doc: string,
  context: SectionContext,
) => {
  await persistMidmarksSection(parseMidmarksSection(doc, context), context);
};
