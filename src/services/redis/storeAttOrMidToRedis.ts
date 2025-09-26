import * as cheerio from "cheerio";
import { Academic } from "../student.utils/Academic.js";
import { getClient } from "./getRedisClient.js";

export const storeAttendanceToRedis = async (doc: string) => {
  try {
    const $ = cheerio.load(doc);
    const rollNoTrs = $("tr[id]");
    const rollNumbers = rollNoTrs.map((_, el) => $(el).attr("id")).get();

    const redisClient = await getClient();

    for (const rollnumber of rollNumbers) {
      const studentAttendance = await Academic.cleanAttDoc(doc, rollnumber);
      await redisClient.json.set(
        `attendance:${rollnumber.toUpperCase()}`,
        "$",
        studentAttendance,
      );
      await redisClient.expire(`attendance:${rollnumber}`, 3600);
    }

    console.log(`cached all student attendance for : `, rollNumbers);
  } catch (error) {
    console.log("error Storing Attendance :", error);
  }
};

export const storeMidMarksToRedis = async (doc: string) => {
  try {
    const $ = cheerio.load(doc);
    const rollNoTrs = $("tr[id]");
    const rollNumbers = rollNoTrs.map((_, el) => $(el).attr("id")).get();

    const redisClient = await getClient();

    for (const rollnumber of rollNumbers) {
      const studentMidmarks = await Academic.cleanMidDoc(doc, rollnumber);
      await redisClient.json.set(
        `midmarks:${rollnumber.toUpperCase()}`,
        "$",
        studentMidmarks,
      );
      await redisClient.expire(`midmarks:${rollnumber}`, 60 * 60 * 2);
    }

    console.log(`cached all student midmarks for : `, rollNumbers);
  } catch (error) {
    console.log("error storing midmarks ", error);
  }
};
