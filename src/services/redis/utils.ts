import { getStudent, findSimilarRolls } from "../../db/student.model.js";
import { Student } from "../../types/index.js";
import { getClient } from "./getRedisClient.js";
import { logger } from "../../config/logger.js";

export class StudentNotFoundError extends Error {
  constructor(
    public rollnumber: string,
    public suggestions: string[],
  ) {
    super(`Student ${rollnumber} not found in college records`);
    this.name = "StudentNotFoundError";
  }
}

export const getStudentCached = async (
  rollnumber: string,
): Promise<Student> => {
  const redisClient = await getClient();

  const cachedStudent = await redisClient.get(`student:${rollnumber}`);
  let student = cachedStudent ? (JSON.parse(cachedStudent) as Student) : null;

  if (!student) {
    student = await getStudent(rollnumber);
    if (student) {
      await redisClient.set(`student:${rollnumber}`, JSON.stringify(student));
      await redisClient.expire(`student:${rollnumber}`, 60 * 60 * 24 * 7);
      logger.debug("cached student: ", rollnumber);
    } else {
      // not in college records — suggest similar rolls
      const suggestions = await findSimilarRolls(rollnumber).catch(() => []);
      throw new StudentNotFoundError(rollnumber.toUpperCase(), suggestions);
    }
  }

  return student;
};
