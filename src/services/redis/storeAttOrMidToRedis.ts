import { logger } from "../../utils/logger.js";
import * as cheerio from "cheerio";
import { Academic } from "../student.utils/Academic.js";
import { getClient } from "./getRedisClient.js";
import { updateAttendanceStat, updateMidMarkStat } from "../../db/student_stats.model.js";
import { getStudentCached } from "./utils.js";
import { logger } from "../../utils/logger.js";

export const storeAttendanceToRedis = async (doc: string) => {
   const $ = cheerio.load(doc);
   const rollNoTrs = $("tr[id]");
   const rollNumbers = rollNoTrs.map((_, el) => $(el).attr("id")).get();

   const redisClient = await getClient();

   for (const rollnumber of rollNumbers) {
      const studentAttendance = await Academic.parseAttendanceResponse(doc, rollnumber);

      await redisClient.set(
         `attendance:${rollnumber.toUpperCase()}`,
         JSON.stringify(studentAttendance)
      );
      await redisClient.expire(
         `attendance:${rollnumber.toUpperCase()}`,
         60 * 60
      );


       await updateAttendanceStat(rollnumber.toUpperCase(), studentAttendance.percentage);
    }

    logger.debug(`cached all student attendance for : `, rollNumbers);
 };

export const storeMidMarksToRedis = async (doc: string) => {
   const $ = cheerio.load(doc);
   const rollNoTrs = $("tr[id]");
   const rollNumbers = rollNoTrs.map((_, el) => $(el).attr("id")).get();

   const redisClient = await getClient();

   for (const rollnumber of rollNumbers) {
      const studentMidmarks = await Academic.parseMidmarksResponse(doc, rollnumber);
      const student = await getStudentCached(rollnumber.toUpperCase());
      if (!student) continue

      await redisClient.set(
         `midmarks:${rollnumber.toUpperCase()}`,
         JSON.stringify(studentMidmarks)
      );
      await redisClient.expire(
         `midmarks:${rollnumber.toUpperCase()}`,
         60 * 60 * 2
      );

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

       await updateMidMarkStat(rollnumber.toUpperCase(), average);
    }

    logger.debug(`cached all student midmarks for : `, rollNumbers);
 };
