//
// NO CHANGES REQUIRED
//
import { getStudent } from "../../db/student.model";
import { storeResponse, getResponse } from "../../db/fallback/responses.model";
import { urls, headers as header } from "../../constants/index";
import { BRANCHES } from "../../constants";
import {
  IAcademic,
  MidmarksBySubjects,
  AttendanceBySubjects,
  Attendance,
  Midmarks,
} from "../../types";

import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";
import * as cheerio from "cheerio";

dotenv.config();

const indianDate = "27-03-2030"; //maxed date for attendance
const USERNAME = process.env.N_USERNAME || "";
const PASSWORD = process.env.N_PASSWORD || "";
const loginUrl = urls.login;

var cookie = "";

export class Academic implements IAcademic {
  constructor(public rollnumber: string) {}

  async getResponse(command: string): Promise<string> {
    const url = command === "mid" ? urls.midmarks : urls.attendance;
    const student = await getStudent(this.rollnumber);

    let data;
    if (command === "mid") {
      data = {
        acadYear: "2025-26",
        yearSem: student.year,
        branch: student.branch,
        section: student.section,
        dateOfAttendance: indianDate,
        midsChosen: "mid1, mid2, mid3",
        hidProjectsType: "",
        typeOfProj: "",
        txtScaleMarksTo: "",
      };
    } else {
      data = {
        acadYear: "2025-26",
        yearSem: student.year,
        branch: student.branch,
        section: student.section,
        dateOfAttendance: indianDate,
      };
    }

    const heads = header(command);
    heads.Cookie = "PHPSESSID=" + cookie;

    try {
      const response = await axios.post(url, data, {
        headers: heads,
        timeout: 5000,
      });
      const res = response.data; // Assuming response data is a string
      if (
        res.includes(
          "<tr><td>User Name</td><td>:</td><td><input type=textbox name='username' id='username'",
        )
      ) {
        await this.renewPassword();

        if (await this.isCookiesValid()) {
          return this.getResponse(command);
        }
        return "Network Error";
      }
      return res;
    } catch (error) {
      console.error("Error fetching response:", error);
      return "Network Error";
    }
  }

  async isCookiesValid(): Promise<boolean> {
    try {
      const url = "http://103.203.175.90:94/attendance";

      const headers = header("att");
      headers.Cookie = `PHPSESSID=${cookie}`;

      const resp = await axios.get(url, { headers });

      if (resp.data.includes("function selectHour(obj)")) {
        return true;
      } else {
        console.warn("Cookies are invalid or response is unexpected.");
        return false;
      }
    } catch (error) {
      console.error("Error validating cookies:", error);
      return false;
    }
  }

  async renewPassword(): Promise<string> {
    try {
      const randomString = crypto.randomBytes(3).toString("hex");
      const sessionToken = `ggpmgfj8dssskkp2q2h6db${randomString}0`;
      const headers = header("att");
      headers.Cookie = `PHPSESSID=${sessionToken}`;
      headers.Referer =
        "http://103.203.175.90:94/attendance/attendanceLogin.php";

      const payload = `username=${USERNAME}&password=${PASSWORD}&captcha=`;

      try {
        await axios.post(loginUrl, payload, {
          headers,
          maxRedirects: 0,
          validateStatus: function (status) {
            return status >= 200 && status < 303;
          },
        });
      } catch (error) {
        console.log("Error during login request:", error);
        console.error("Error updating token:");
      }
      cookie = sessionToken;
      console.log("Password Renewed");
      return "Password Renewed";
    } catch (error) {
      console.error("Error in renewPassword:", error);
      return "Error occurred";
    }
  }

  async getAttendanceJSON(): Promise<Attendance | string> {
    try {
      //student details
      const student = await getStudent(this.rollnumber);

      let response = await this.getResponse("att");
      if (response === "Network Error") {
        const content = await getResponse(
          student.year,
          student.branch,
          student.section,
          "att",
        );
        if (!content) return response;
        response = content;
      } else {
        await storeResponse(
          student.year,
          student.branch,
          student.section,
          "att",
          response,
        );
      }

      if (!response.includes(this.rollnumber.toUpperCase()))
        return "Student Not Found";

      //using cheerio to get targeted data
      const $ = cheerio.load(response);
      const studentTr = $(`tr[id=${this.rollnumber.toUpperCase()}]`);
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
        rollno: this.rollnumber,
        year_branch_section:
          student.year.slice(0, 1) +
          "_" +
          BRANCHES[parseInt(student.branch)] +
          "_" +
          student.section,
        percentage: parseFloat(percentage.split("(")[0].trim()),
        totalClasses: {
          attended: parseInt(totalClassesAttended.split("/")[0].trim()),
          conducted: parseInt(totalClassesAttended.split("/")[1].trim()),
        },
        subjects: subjects,
      };

      return attendance;
    } catch (error) {
      console.log("Error in getAttendanceJSON:", error);
      return "Something went wrong";
    }
  }

  async getMidmarksJSON(): Promise<Midmarks | string> {
    try {
      //student details
      const student = await getStudent(this.rollnumber);

      //using cheerio to get targeted data
      let response = await this.getResponse("mid");
      if (response === "Network Error") {
        const content = await getResponse(
          student.year,
          student.branch,
          student.section,
          "mid",
        );
        if (!content) return response;
        response = content;
      } else {
        await storeResponse(
          student.year,
          student.branch,
          student.section,
          "mid",
          response,
        );
      }

      const $ = cheerio.load(response);

      const studentTr = $(`tr[id=${this.rollnumber.toUpperCase()}]`)
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
        try {
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
        } catch (e) {
          console.error("Error parsing midmarks:", e);
          midmarksList.push({
            subject: el,
            M1: 0,
            M2: 0,
            average: 0,
            type: subjects.includes(el) ? "Subject" : "Lab",
          });
        }
      });
      //end formatting midmarks objects into MidmarksBySubjects List

      //midmarks object
      const midmarks: Midmarks = {
        rollno: this.rollnumber,
        year_branch_section:
          student.year.slice(0, 1) +
          "_" +
          BRANCHES[parseInt(student.branch)] +
          "_" +
          student.section,
        subjects: midmarksList,
      };

      return midmarks;
    } catch (error) {
      console.error("Error in getMidmarksJSON:", error);
      return {
        rollno: "Not Found",
        year_branch_section: "",
        subjects: [],
      } as Midmarks;
    }
  }
}
