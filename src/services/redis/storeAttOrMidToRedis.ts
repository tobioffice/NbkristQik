import * as cheerio from "cheerio";
import { Academic } from "../student.utils/Academic.js";
import { getClient } from "./getRedisClient.js";
import { updateAttendanceStat, updateMidMarkStat } from "../../db/student_stats.model.js";
import { getStudentCached } from "./utils.js";
import { Midmarks } from "../../types/index.js";

/**
 * Caches a whole section's attendance in the background.
 * Parsing + writes run in parallel (Promise.all) so a 60-student section
 * takes ~2 round-trip batches instead of ~120 serial ones.
 */
export const storeAttendanceToRedis = async (doc: string) => {
   const $ = cheerio.load(doc);
   const rollNumbers = $("tr[id]")
      .map((_, el) => $(el).attr("id"))
      .get();

   const redisClient = await getClient();

   const parsed = await Promise.all(
      rollNumbers.map((rollnumber) =>
         Academic.parseAttendanceResponse(doc, rollnumber).catch(() => null)
      )
   );

   const valid = parsed.filter(
      (s): s is NonNullable<typeof s> => s !== null
   );

   await Promise.all(
      valid.map((studentAttendance) => {
         const roll = studentAttendance.rollno.toUpperCase();
         return Promise.all([
            redisClient.set(`attendance:${roll}`, JSON.stringify(studentAttendance), { EX: 60 * 60 }),
            updateAttendanceStat(roll, studentAttendance.percentage).catch(() => {}),
         ]);
      })
   );

   console.log(`cached all student attendance for : `, rollNumbers);
};

export const storeMidMarksToRedis = async (doc: string) => {
   const $ = cheerio.load(doc);
   const rollNumbers = $("tr[id]")
      .map((_, el) => $(el).attr("id"))
      .get();

   const redisClient = await getClient();

   const parsed = await Promise.all(
      rollNumbers.map((rollnumber) =>
         Academic.parseMidmarksResponse(doc, rollnumber).catch(() => null)
      )
   );

   const valid: Array<{
      roll: string;
      studentMidmarks: Midmarks;
      average: number;
   }> = [];

   for (let i = 0; i < parsed.length; i++) {
      const studentMidmarks = parsed[i];
      if (!studentMidmarks) continue;
      const roll = rollNumbers[i].toUpperCase();
      const student = await getStudentCached(roll);
      if (!student) continue;

      const zeroMarkSubjects = studentMidmarks.subjects.filter(
         (sub) => (sub.M1 || 0) === 0 && (sub.M2 || 0) === 0
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

      valid.push({ roll, studentMidmarks, average });
   }

   await Promise.all(
      valid.map(({ roll, studentMidmarks, average }) =>
         Promise.all([
            redisClient.set(`midmarks:${roll}`, JSON.stringify(studentMidmarks), { EX: 60 * 60 * 2 }),
            updateMidMarkStat(roll, average).catch(() => {}),
         ])
      )
   );

   console.log(`cached all student midmarks for : `, rollNumbers);
};