import * as cheerio from "cheerio";
import { Academic } from "../student.utils/Academic.js";
import { getClient } from "./getRedisClient.js";
import {
  updateAttendanceStat,
  updateMidMarkStat,
} from "../../db/student_stats.model.js";
import { getStudentCached } from "./utils.js";
import { Attendance, Midmarks } from "../../types/index.js";
import { logger } from "../../config/logger.js";

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

/** Writes each student's payload to Redis + their stat to Turso in parallel. */
const persistSectionWrites = async <T>(
  writes: SectionWrite<T>[],
  cachePrefix: string,
  ttlSeconds: number,
  writeStat: (roll: string, value: number) => Promise<void>,
) => {
  const redisClient = await getClient();
  await Promise.all(
    writes.map(({ roll, payload, value }) =>
      Promise.all([
        redisClient.set(`${cachePrefix}:${roll}`, JSON.stringify(payload), {
          EX: ttlSeconds,
        }),
        writeStat(roll, value).catch(() => {}),
      ]),
    ),
  );
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
    "attendance",
    60 * 60,
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

  const writes: SectionWrite<Midmarks>[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const studentMidmarks = parsed[i];
    if (!studentMidmarks) continue;
    const roll = rollNumbers[i].toUpperCase();
    let student;
    try {
      student = await getStudentCached(roll);
    } catch (e) {
      logger.warn(`[cache] skipping ${roll}: student lookup failed`, e);
      continue;
    }
    if (!student) continue;

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
    "midmarks",
    60 * 60 * 2,
    updateMidMarkStat,
  );

  logger.debug(`cached all student midmarks for : `, rollNumbers);
};
