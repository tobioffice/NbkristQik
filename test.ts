import { AttendaceAnyl } from "./src/services/student.utils/AttendaceAnyl.js";
import { createTableIfNotExists } from "./src/db/attAnalyCache.js";

await createTableIfNotExists();
const student = new AttendaceAnyl("23KB1A05B1");

console.log(await student.getAnylData());
