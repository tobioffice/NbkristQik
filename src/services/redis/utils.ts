import { getStudent } from "../../db/student.model.js";
import { Student } from "../../types/index.js";
import { getClient } from "./getRedisClient.js";

export const getStudentCached = async (rollnumber: string) => {
  const redisClient = await getClient();

  let student = (await redisClient.json.get(
    `student:${rollnumber}`,
  )) as Student;

  if (!student) {
    student = await getStudent(rollnumber);
    if (student) {
      await redisClient.json.set(`student:${rollnumber}`, "$", student);
    }
  } else {
    console.log("got cashed student: ");
  }

  return student;
};
