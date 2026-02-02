import { getStudent } from "../../db/student.model.js";
import { Student } from "../../types/index.js";
import { getClient } from "./getRedisClient.js";
import { logger } from "../../utils/logger.js";

export const getStudentCached = async (rollnumber: string) => {
   const redisClient = await getClient();

   const cachedStudent = await redisClient.get(`student:${rollnumber}`);
   let student = cachedStudent ? (JSON.parse(cachedStudent) as Student) : null;

   if (!student) {
      student = await getStudent(rollnumber);
      if (student) {
          await redisClient.set(
             `student:${rollnumber}`,
             JSON.stringify(student)
          );
          await redisClient.expire(`student:${rollnumber}`, 60 * 60 * 24 * 7);
          logger.debug("cached student: ", rollnumber);
       }
    } else {
       logger.debug("got cached student: ");
    }

   return student;
};
