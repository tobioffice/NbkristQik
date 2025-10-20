import { Academic } from "./Academic.js";
import * as cheerio from "cheerio";
import { Attendance } from "../../types/index.js";
import {
  upsertAttendanceCache,
  getAttendanceCache,
} from "../../db/attAnalyCache.js";

interface IAttendaceAnyl {
  rollbumber: string;
  getAnylData(): Promise<
    {
      rollbumber: string;
      attdate: string;
      attendace: Attendance;
    }[]
  >;
}

export class AttendaceAnyl implements IAttendaceAnyl {
  constructor(public rollbumber: string) {}

  getLast7Sunadays(): string[] {
    const sundays: string[] = [];
    const today = new Date();
    const dayOfWeek = today.getDay();
    const lastSunday = new Date(today);
    lastSunday.setDate(today.getDate() - dayOfWeek);
    for (let i = 0; i < 7; i++) {
      const sunday = new Date(lastSunday);
      sunday.setDate(lastSunday.getDate() - i * 7);
      const sundayDate = sunday.toISOString().split("T")[0];
      sundays.push(sundayDate.split("-").reverse().join("-"));
    }

    return sundays;
  }

  async getAttendaceForSpecificDate(date: string): Promise<Attendance | null> {
    const cachedAttendance = await getAttendanceCache(this.rollbumber, date);
    if (cachedAttendance) {
      return cachedAttendance.attendance_data;
    }

    const academic = new Academic(this.rollbumber, date);

    const responce = await academic.getResponse("att");

    if (!responce) throw new Error("Failed to fetch attendance data");

    const $ = cheerio.load(responce);
    const rollNoTrs = $("tr[id]");
    const rollNumbers = rollNoTrs.map((_, el) => $(el).attr("id")).get();

    let currentStudentAttendace = undefined;

    for (const rollnumber of rollNumbers) {
      const studentAttendace = await Academic.cleanAttDoc(responce, rollnumber);
      if (rollnumber.toUpperCase() === this.rollbumber.toUpperCase()) {
        currentStudentAttendace = studentAttendace;
      }
      await upsertAttendanceCache(
        rollnumber!,
        JSON.stringify(studentAttendace),
        date,
      );
    }
    return currentStudentAttendace || null;
  }

  async getAnylData(): Promise<
    {
      rollbumber: string;
      attdate: string;
      attendace: Attendance;
    }[]
  > {
    try {
      const sundays = this.getLast7Sunadays();
      const attendanceDataPromises = sundays.map(async (date) => {
        const attendance = await this.getAttendaceForSpecificDate(date);
        if (!attendance) return null;
        return {
          rollbumber: this.rollbumber,
          attdate: date,
          attendace: attendance,
        };
      });

      const results = await Promise.all(attendanceDataPromises);

      return results.filter((item) => item !== null) as {
        rollbumber: string;
        attdate: string;
        attendace: Attendance;
      }[];
    } catch (error) {
      console.error("Error in getAnylData:", error);
      return [];
    }
  }
}
