import { AttendaceAnyl } from "./src/services/student.utils/Analytics/AttendaceAnyl.js";
import { createTableIfNotExists } from "./src/db/attAnalyCache.js";
import { closeClient } from "./src/services/redis/getRedisClient.js";

await createTableIfNotExists();
const student = new AttendaceAnyl("23KB1A05h8");

console.log(await student.getAnylData());
await closeClient();
