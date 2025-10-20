import { AttendaceAnyl } from "./src/services/student.utils/AttendaceAnyl.js";
import { createTableIfNotExists } from "./src/db/attAnalyCache.js";

await createTableIfNotExists();
const student = new AttendaceAnyl("24KB1A0502");

console.log(await student.getAnylData());
