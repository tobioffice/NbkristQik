import { AttendaceAnyl } from "./AttendaceAnyl.js";
import { Attendance } from "../../../types/index.js";
import { getClient } from "../../redis/getRedisClient.js";

export class AttendaceAnylCached extends AttendaceAnyl {
  async getAnylDataCashed(): Promise<
    {
      rollbumber: string;
      attdate: string;
      attendace: Attendance;
    }[]
  > {
    const redisClient = await getClient();
    const cacheKey = `attendance_analysis:${this.rollbumber}`;

    const cachedData = await redisClient.get(cacheKey);
    // console.log(cachedData);

    if (cachedData) {
      return JSON.parse(cachedData);
    }

    const anylData = await this.getAnylData();

    await redisClient.set(cacheKey, JSON.stringify(anylData), {
      EX: 86400, // Cache for 1 day
    });

    return anylData;
  }
}
