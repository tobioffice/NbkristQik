import * as cheerio from "cheerio";
import { Academic } from "../student.utils/Academic.js";
import { getClient } from "./getRedisClient.js";
import { updateAttendanceStat, updateMidMarkStat } from "../../db/student_stats.model.js";

export const storeAttendanceToRedis = async (doc: string) => {
   const $ = cheerio.load(doc);
   const rollNoTrs = $("tr[id]");
   const rollNumbers = rollNoTrs.map((_, el) => $(el).attr("id")).get();

   const redisClient = await getClient();

   for (const rollnumber of rollNumbers) {
      const studentAttendance = await Academic.cleanAttDoc(doc, rollnumber);

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

   console.log(`cached all student attendance for : `, rollNumbers);
};

export const storeMidMarksToRedis = async (doc: string) => {
   const $ = cheerio.load(doc);
   const rollNoTrs = $("tr[id]");
   const rollNumbers = rollNoTrs.map((_, el) => $(el).attr("id")).get();

   const redisClient = await getClient();

   for (const rollnumber of rollNumbers) {
      const studentMidmarks = await Academic.cleanMidDoc(doc, rollnumber);

      await redisClient.set(
         `midmarks:${rollnumber.toUpperCase()}`,
         JSON.stringify(studentMidmarks)
      );
      await redisClient.expire(
         `midmarks:${rollnumber.toUpperCase()}`,
         60 * 60 * 2
      );

      const average = studentMidmarks.subjects.reduce((acc, sub) => acc + (((sub.M1 || 0) + (sub.M2 || 0)) / 2 || 0), 0) / studentMidmarks.subjects.length;

      await updateMidMarkStat(rollnumber.toUpperCase(), average);
      }

   console.log(`cached all student midmarks for : `, rollNumbers);
};
