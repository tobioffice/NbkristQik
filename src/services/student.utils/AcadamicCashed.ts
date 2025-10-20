import { Attendance, Midmarks } from "../../types/index.js";
import { Academic } from "./Academic.js";
import { getClient } from "../redis/getRedisClient.js";

export class AcademicCashed extends Academic {
  async getAttendanceJSONCashed() {
    const redisClient = await getClient();

    const cachedAttendance = await redisClient.get(
      `attendance:${this.rollnumber.toUpperCase()}`,
    );
    const attendance = cachedAttendance
      ? (JSON.parse(cachedAttendance) as Attendance)
      : null;

    if (attendance) {
      console.log("got cached attendance: ");
      return attendance;
    }
    return await this.getAttendanceJSON();
  }

  async getMidmarksJSONCashed() {
    const redisClient = await getClient();

    const cachedMidMarks = await redisClient.get(
      `midmarks:${this.rollnumber.toUpperCase()}`,
    );
    const midMarks = cachedMidMarks
      ? (JSON.parse(cachedMidMarks) as Midmarks)
      : null;

    if (midMarks) {
      console.log("got cached midmarks");
      // console.log(midMarks);
      return midMarks;
    }

    return await this.getMidmarksJSON();
  }
}
