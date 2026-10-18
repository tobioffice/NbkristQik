import { getStudent, findSimilarRolls } from "../../db/student.model.js";
import { Student } from "../../types/index.js";
import { getClient } from "./getRedisClient.js";
import { redisKeys } from "./keys.js";
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
  const key = redisKeys.student(rollnumber);

  // Redis is a cache, not a dependency: if it is down or corrupt, read the
  // database instead of failing the whole lookup.
  let redisClient: Awaited<ReturnType<typeof getClient>> | null = null;
  try {
    redisClient = await getClient();
    const cachedStudent = await redisClient.get(key);
    if (cachedStudent) return JSON.parse(cachedStudent) as Student;
  } catch (error) {
    logger.warn(
      "[redis] student cache unavailable, falling back to the database:",
      error instanceof Error ? error.message : error,
    );
    redisClient = null;
  }

  const student = await getStudent(rollnumber);
  if (!student) {
    // not in college records — suggest similar rolls
    const suggestions = await findSimilarRolls(rollnumber).catch(() => []);
    throw new StudentNotFoundError(rollnumber.toUpperCase(), suggestions);
  }

  if (redisClient) {
    try {
      await redisClient.set(key, JSON.stringify(student));
      await redisClient.expire(key, 60 * 60 * 24 * 7);
      logger.debug("cached student: ", rollnumber);
    } catch (error) {
      logger.debug(
        "[redis] student cache write failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return student;
};
