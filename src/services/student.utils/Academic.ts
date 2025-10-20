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
  Student,
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
import {
  getResponse,
  storeResponse,
} from "../../db/fallback/response.model.js";

dotenv.config();

const USERNAME = process.env.N_USERNAME || "";
const PASSWORD = process.env.N_PASSWORD || "";
const loginUrl = urls.login;

var cookie = "";

export class Academic implements IAcademic {
  public student: Student | null = null;

  constructor(
    public rollnumber: string,
    public indianDate: string = "01-01-2030",
  ) {}

  async getCachedStudent() {
    if (this.student) return this.student;
    const student = await getStudentCached(this.rollnumber);
    this.student = student;
    return student;
  }

  async getResponse(command: "mid" | "att"): Promise<string | null> {
    const url = command === "mid" ? urls.midmarks : urls.attendance;
    const student = this.student || (await this.getCachedStudent());

    let data;
    if (command === "mid") {
      data = {
        acadYear: "2025-26",
        yearSem: student.year,
        branch: student.branch,
        section: student.section,
        dateOfAttendance: this.indianDate,
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
        dateOfAttendance: this.indianDate,
      };
    }

    const heads = header(command);
    heads.Cookie = "PHPSESSID=" + cookie;

    try {
      const response = await axios.post(url, data, {
        headers: heads,
        timeout: 3000,
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
        return null;
      }

      this.indianDate === "27-03-2030" &&
        storeResponse(
          student.year,
          student.branch,
          student.section,
          command,
          res,
        );
      return res;
    } catch {
      return await getResponse(
        student.year,
        student.branch,
        student.section,
        command,
      );
    }
  }

  async isCookiesValid(): Promise<boolean> {
    try {
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
      headers.Referer = `${BASE_URL}/attendance/attendanceLogin.php`;

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

  async getAttendanceJSON(): Promise<Attendance | null> {
    try {
      // Fetch fresh data
      const response = await this.getResponse("att");

      if (!response) return null;

      console.log("Storing fresh attendance data...");
      if (!response.includes(this.rollnumber.toUpperCase())) return null;

      storeAttendanceToRedis(response);

      //using cheerio to get targeted data
      return Academic.cleanAttDoc(response, this.rollnumber);
    } catch (error) {
      console.log("Error in getAttendanceJSON:", error);
      return null;
    }
  }

  static async cleanAttDoc(
    doc: string,
    rollnumber: string,
  ): Promise<Attendance> {
    const { roll_no, branch, section, year } =
      await getStudentCached(rollnumber);

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

  async getMidmarksJSON(): Promise<Midmarks | null> {
    try {
      const response = await this.getResponse("mid");

      if (!response) return null;
      if (!response.includes(this.rollnumber.toUpperCase())) return null;

      storeMidMarksToRedis(response);

      return await Academic.cleanMidDoc(response, this.rollnumber);
    } catch (error) {
      console.error("Error in getMidmarksJSON:", error);
      return null;
    }
  }

  static async cleanMidDoc(doc: string, rollnumber: string): Promise<Midmarks> {
    const { roll_no, year, section, branch } =
      await getStudentCached(rollnumber);

    const $ = cheerio.load(doc);

    const studentTr = $(`tr[id=${roll_no.toUpperCase()}]`).find("td").slice(2);
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
      rollno: roll_no,
      year_branch_section:
        year.slice(0, 1) + "_" + BRANCHES[parseInt(branch)] + "_" + section,
      subjects: midmarksList,
    };

    return midmarks;
  }
}
