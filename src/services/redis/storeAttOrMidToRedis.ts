import * as cheerio from "cheerio";
import { Academic } from "../student.utils/Academic.js";
import { getClient } from "./getRedisClient.js";
import { redisKeys } from "./keys.js";
import {
  updateAttendanceStat,
  updateMidMarkStat,
} from "../../db/student_stats.model.js";
import { getStudentCached } from "./utils.js";
import { Attendance, Midmarks } from "../../types/index.js";
import { logger } from "../../config/logger.js";

const CACHE_TTL_ATTENDANCE_S = 60 * 60;
const CACHE_TTL_MIDMARKS_S = 60 * 60 * 2;

const extractRollNumbers = (doc: string): string[] => {
  const $ = cheerio.load(doc);
  return $("tr[id]")
    .map((_, el) => $(el).attr("id"))
    .get();
};

interface SectionWrite<T> {
  roll: string;
  payload: T;
  value: number; // attendance % or mid average persisted to student_stats
}

/**
 * Writes each student's stat to the database and their payload to Redis.
 *
 * The leaderboard stat is the durable output: it is written unconditionally,
 * each row in its own logged try/catch, and never gated on Redis. A Redis
 * connect can take seconds to fail, so it is started at the same time as the
 * DB writes instead of being awaited first; every cache key is written
 * best-effort, so a cache outage cannot fail (or veto) the batch.
 */
const persistSectionWrites = async <T>(
  writes: SectionWrite<T>[],
  cacheKey: (roll: string) => string,
  ttlSeconds: number,
  writeStat: (roll: string, value: number) => Promise<void>,
) => {
  // DB first and independently — one failure is logged with its roll and the
  // rest of the section still lands.
  const dbWrites = Promise.all(
    writes.map(({ roll, value }) =>
      writeStat(roll, value).catch((e) => {
        logger.warn(`[leaderboard] stat write failed for ${roll}:`, e);
      }),
    ),
  );

  // Connect alongside the DB writes. A failure is expected when Redis is down
  // and must not reject the batch.
  const redisClient = await getClient().catch((e) => {
    logger.warn("[cache] Redis unavailable — student stats still written:", e);
    return null;
  });

  if (redisClient) {
    await Promise.all(
      writes.map(({ roll, payload }) =>
        redisClient
          .set(cacheKey(roll), JSON.stringify(payload), { EX: ttlSeconds })
          .catch((e) => {
            logger.warn(`[cache] Redis write failed for ${roll}:`, e);
          }),
      ),
    );
  }

  await dbWrites;
};

/**
 * Caches a whole section's attendance in the background.
 * Parsing + writes run in parallel (Promise.all) so a 60-student section
 * takes ~2 round-trip batches instead of ~120 serial ones.
 */
export const storeAttendanceToRedis = async (doc: string) => {
  const rollNumbers = extractRollNumbers(doc);

  const parsed = await Promise.all(
    rollNumbers.map((rollnumber) =>
      Academic.parseAttendanceResponse(doc, rollnumber).catch(() => null),
    ),
  );

  const writes: SectionWrite<Attendance>[] = parsed
    .filter((s): s is Attendance => s !== null)
    .map((attendance) => ({
      roll: attendance.rollno.toUpperCase(),
      payload: attendance,
      value: attendance.percentage,
    }));

  await persistSectionWrites(
    writes,
    redisKeys.attendance,
    CACHE_TTL_ATTENDANCE_S,
    updateAttendanceStat,
  );

  logger.debug(`cached all student attendance for : `, rollNumbers);
};

export const storeMidMarksToRedis = async (doc: string) => {
  const rollNumbers = extractRollNumbers(doc);

  const parsed = await Promise.all(
    rollNumbers.map((rollnumber) =>
      Academic.parseMidmarksResponse(doc, rollnumber).catch(() => null),
    ),
  );

  // student lookups in parallel — same fan-out pattern as the parsing above
  const students = await Promise.all(
    rollNumbers.map((roll) =>
      getStudentCached(roll.toUpperCase()).catch((e) => {
        logger.warn(`[cache] skipping ${roll}: student lookup failed`, e);
        return null;
      }),
    ),
  );

  const writes: SectionWrite<Midmarks>[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const studentMidmarks = parsed[i];
    const student = students[i];
    if (!studentMidmarks || !student) continue;
    const roll = rollNumbers[i].toUpperCase();

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

    if (student.year === "41") {
      average = (average / 40) * 30;
    }

    writes.push({ roll, payload: studentMidmarks, value: average });
  }

  await persistSectionWrites(
    writes,
    redisKeys.midmarks,
    CACHE_TTL_MIDMARKS_S,
    updateMidMarkStat,
  );

  logger.debug(`cached all student midmarks for : `, rollNumbers);
};
