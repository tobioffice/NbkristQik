//
// NO CHANGES REQUIRED
//
import { urls, headers as header } from "../../constants/index.js";
import { BRANCHES, BASE_URL } from "../../constants/index.js";

import {
   IAcademic,
   MidmarksBySubjects,
   AttendanceBySubjects,
   Attendance,
   Midmarks,
} from "../../types/index.js";

import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";
import * as cheerio from "cheerio";
import { getStudentCached } from "../redis/utils.js";
import {
   storeAttendanceToRedis,
   storeMidMarksToRedis,
} from "../redis/storeAttOrMidToRedis.js";
import { getClient } from "../redis/getRedisClient.js";
import {
   storeResponse,
   getResponse,
} from "../../db/fallback/response.model.js";

dotenv.config();

const indianDate = "27-03-2030"; //maxed date for attendance
const USERNAME = process.env.N_USERNAME || "";
const PASSWORD = process.env.N_PASSWORD || "";
const loginUrl = urls.login;

var cookie = "";

export class Academic implements IAcademic {
   constructor(public rollnumber: string) {}

   async getResponse(command: "mid" | "att"): Promise<string> {
      const url = command === "mid" ? urls.midmarks : urls.attendance;
      const student = await getStudentCached(this.rollnumber);

      let data;
      if (command === "mid") {
         data = {
            acadYear: "2025-26",
            yearSem: student.year.slice(0, 1) + "2",
            branch: student.branch,
            section: student.section,
            dateOfAttendance: indianDate,
            midsChosen: "mid1, mid2, mid3",
         };
      } else {
         data = {
            acadYear: "2025-26",
            yearSem: student.year.slice(0, 1) + "2",
            branch: student.branch,
            section: student.section,
            dateOfAttendance: indianDate,
         };
      }

      console.log(data);

      const heads = header(command);
      heads.Cookie = "PHPSESSID=" + cookie;
      try {
         const response = await axios.post(url, data, {
            headers: heads,
            timeout: 3000,
         });
         const res = response.data;
         if (
            res.includes(
               "<tr><td>User Name</td><td>:</td><td><input type=textbox name='username' id='username'"
            )
         ) {
            await this.renewPassword();

            if (await this.isCookiesValid()) {
               const res_temp = await this.getResponse(command);
               if (res_temp?.includes("Blocked")) {
                  throw new Error("Report is Blocked by the Admin");
               }
               return res_temp;
            }
         }
         storeResponse(
            student.year,
            student.branch,
            student.section,
            command,
            res
         );

         if (res.includes("Blocked")) {
            throw new Error("Report is Blocked by the Admin");
         }
         return res;
      } catch (error) {
         return await getResponse(
            student.year,
            student.branch,
            student.section,
            command
         );
      }
   }

   async isCookiesValid(): Promise<boolean> {
      const url = `${BASE_URL}/attendance`;

      const headers = header("att");
      headers.Cookie = `PHPSESSID=${cookie}`;

      const resp = await axios.get(url, { headers });

      if (resp.data.includes("function selectHour(obj)")) {
         return true;
      } else {
         console.warn("Cookies are invalid or response is unexpected.");
         return false;
      }
   }

   async renewPassword(): Promise<string> {
      const randomString = crypto.randomBytes(3).toString("hex");
      const sessionToken = `ggpmgfj8dssskkp2q2h6db${randomString}0`;
      const headers = header("att");
      headers.Cookie = `PHPSESSID=${sessionToken}`;
      headers.Referer = `${BASE_URL}/attendance/attendanceLogin.php`;

      const payload = `username=${USERNAME}&password=${PASSWORD}&captcha=`;

      await axios.post(loginUrl, payload, {
         headers,
         maxRedirects: 0,
         validateStatus: function (status) {
            return status >= 200 && status < 303;
         },
      });
      cookie = sessionToken;
      console.log("Password Renewed");
      return "Password Renewed";
   }

   async getAttendanceJSON(): Promise<Attendance> {
      const redisClient = await getClient();

      const cachedAttendance = await redisClient.get(
         `attendance:${this.rollnumber.toUpperCase()}`
      );
      const attendance = cachedAttendance
         ? (JSON.parse(cachedAttendance) as Attendance)
         : null;

      if (attendance) {
         console.log("got cached attendance: ");
         return attendance;
      }

      // Fetch fresh data
      const response = await this.getResponse("att");

      if (!response.includes(this.rollnumber.toUpperCase()))
         throw new Error("No attendance data found !");

      // console.log("Storing fresh attendance data...");

      storeAttendanceToRedis(response);

      return Academic.cleanAttDoc(response, this.rollnumber);
   }

   static async cleanAttDoc(
      doc: string,
      rollnumber: string
   ): Promise<Attendance> {
      const { roll_no, branch, section, year } = await getStudentCached(
         rollnumber
      );

      const $ = cheerio.load(doc);
      const studentTr = $(`tr[id=${roll_no.toUpperCase()}]`);
      const percentage = studentTr.find("td[class=tdPercent]").text();
      const totalClassesAttended = percentage
         .split("(")[1]
         .trim()
         .replace(")", "");

      const trList = $(`tr`);
      const nameTr = trList.eq(1);
      const lastUpdatedTr = trList.eq(2);
      const conductedTr = trList.eq(3);

      const nameArray = nameTr
         .find("td")
         .map((_, el) => $(el).text())
         .get();
      const lastUpdatedArray = lastUpdatedTr
         .find("td")
         .map((_, el) => $(el).text())
         .get();
      const attendedArray = studentTr
         .find("td")
         .map((_, el) => $(el).text())
         .get();
      const conductedArray = conductedTr
         .find("td")
         .map((_, el) => $(el).text())
         .get();

      //cleaning the data start
      lastUpdatedArray.shift();
      conductedArray.shift();
      attendedArray.splice(0, 2);

      let deleted = 0;
      [...conductedArray].forEach((el, i) => {
         const updated = parseInt(el);
         if (updated === 0) {
            nameArray.splice(i - deleted, 1);
            lastUpdatedArray.splice(i - deleted, 1);
            conductedArray.splice(i - deleted, 1);
            attendedArray.splice(i - deleted, 1);
            deleted++;
         }
         if (nameArray[i] === "%AGE") {
            nameArray.splice(i);
            lastUpdatedArray.splice(i);
            conductedArray.splice(i);
            attendedArray.splice(i);
         }
      });

      lastUpdatedArray.forEach((el, i) => {
         lastUpdatedArray[i] = el.split("(")[0];
      });
      //cleaning the data end

      //formatting subjects objects
      const subjects: AttendanceBySubjects[] = [];

      nameArray.forEach((el, i) => {
         subjects.push({
            subject: el,
            attended: parseInt(attendedArray[i]),
            conducted: parseInt(conductedArray[i]),
            lastUpdated: lastUpdatedArray[i],
         });
      });

      //attendance object
      const attendance: Attendance = {
         rollno: roll_no,
         year_branch_section:
            year.slice(0, 1) + "_" + BRANCHES[parseInt(branch)] + "_" + section,
         percentage: parseFloat(percentage.split("(")[0].trim()),
         totalClasses: {
            attended: parseInt(totalClassesAttended.split("/")[0].trim()),
            conducted: parseInt(totalClassesAttended.split("/")[1].trim()),
         },
         subjects: subjects,
      };

      return attendance;
   }

   async getMidmarksJSON(): Promise<Midmarks> {
      const redisClient = await getClient();

      const cachedMidMarks = await redisClient.get(
         `midmarks:${this.rollnumber.toUpperCase()}`
      );
      const midMarks = cachedMidMarks
         ? (JSON.parse(cachedMidMarks) as Midmarks)
         : null;

      if (midMarks) {
         console.log("got cached midmarks");
         return midMarks;
      }

      const response = await this.getResponse("mid");

      if (!response.includes(this.rollnumber.toUpperCase()))
         throw new Error("No midmarks data found !");

      storeMidMarksToRedis(response);

      return await Academic.cleanMidDoc(response, this.rollnumber);
   }

   static async cleanMidDoc(
      doc: string,
      rollnumber: string
   ): Promise<Midmarks> {
      const { roll_no, year, section, branch } = await getStudentCached(
         rollnumber
      );

      const $ = cheerio.load(doc);

      const studentTr = $(`tr[id=${roll_no.toUpperCase()}]`)
         .find("td")
         .slice(2);
      const studentMarksList = studentTr.map((_, el) => $(el).text()).get();

      const nameTr = $(`tr`).eq(1);
      const tds = nameTr.find("td");

      //start separating subjects and labs
      const subjects: string[] = [];
      const labs: string[] = [];

      tds.each((_, element) => {
         const isSubject = $(element).find("a").length > 0;

         if (isSubject) {
            subjects.push($(element).find("a").text().trim());
         } else {
            labs.push($(element).text().trim());
         }
      });
      //end separating subjects and labs

      //start formatting midmarks objects into MidmarksBySubjects List
      const midmarksList: MidmarksBySubjects[] = [];

      [...subjects, ...labs].forEach((el, i) => {
         if (i < subjects.length) {
            const part1 = studentMarksList[i]?.split("/")[0];
            const part2 = studentMarksList[i]?.split("/")[1];

            midmarksList.push({
               subject: el,
               M1: parseInt(part1) || 0,
               M2: parseInt(part2?.split("(")[0]) || 0,
               average: parseInt(part2?.split("(")[1]?.split(")")[0]) || 0,
               type: subjects.includes(el) ? "Subject" : "Lab",
            });
         } else {
            midmarksList.push({
               subject: el,
               M1: parseInt(studentMarksList[i]),
               M2: 0,
               average: 0,
               type: subjects.includes(el) ? "Subject" : "Lab",
            });
         }
      });
      //end formatting midmarks objects into MidmarksBySubjects List

      //midmarks object
      const midmarks: Midmarks = {
         rollno: roll_no,
         year_branch_section:
            year.slice(0, 1) + "_" + BRANCHES[parseInt(branch)] + "_" + section,
         subjects: midmarksList,
      };

      return midmarks;
   }
}
