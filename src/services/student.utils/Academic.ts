//
// Academic Module - Improved version
//
import { urls, headers as header } from "../../constants/index.js";
import { BRANCHES, BASE_URL } from "../../constants/index.js";
import { N_USERNAME, N_PASSWORD } from "../../config/environmentals.js";
import { logger } from "../../utils/logger.js";

import {
   IAcademic,
   MidmarksBySubject,
   AttendanceBySubject,
   Attendance,
   Midmarks,
} from "../../types/index.js";

import axios, { AxiosError } from "axios";
import crypto from "crypto";
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

// Constants
const INDIAN_DATE = "27-03-2030"; // Max date for attendance
const LOGIN_URL = urls.login;
const REQUEST_TIMEOUT = 5000; // Increased timeout for reliability
const MAX_RETRY_ATTEMPTS = 2;

// Session cookie storage
let sessionCookie = "";

// Custom error classes for better error handling
export class AcademicError extends Error {
   constructor(message: string, public code: string) {
      super(message);
      this.name = "AcademicError";
   }
}

export class ServerDownError extends AcademicError {
   constructor() {
      super("College server is not responding. Please try again later.", "SERVER_DOWN");
   }
}

export class BlockedReportError extends AcademicError {
   constructor() {
      super("Report is blocked by the Admin.", "REPORT_BLOCKED");
   }
}

export class NoDataFoundError extends AcademicError {
   constructor(type: "attendance" | "midmarks") {
      super(`No ${type} data found for this roll number.`, "NO_DATA");
   }
}

export class InvalidCredentialsError extends AcademicError {
   constructor() {
      super("Invalid credentials. Please contact admin.", "INVALID_CREDENTIALS");
   }
}

export class Academic implements IAcademic {
   constructor(public rollnumber: string) {
      // Normalize roll number to uppercase
      this.rollnumber = rollnumber.toUpperCase().trim();
   }

   /**
    * Fetches response from college server with retry logic
    */
   async getResponse(command: "mid" | "att", retryCount = 0): Promise<string> {
      const url = command === "mid" ? urls.midmarks : urls.attendance;

      try {
         const student = await getStudentCached(this.rollnumber);
         const requestData = this.buildRequestData(command, student);
         const headers = this.buildHeaders(command);

         logger.debug(`Fetching ${command} data`, { rollNumber: this.rollnumber, command });

         const response = await axios.post(url, requestData, {
            headers,
            timeout: REQUEST_TIMEOUT,
         });

         const responseData = response.data;

         // Check if session expired (login page returned)
         if (this.isLoginPage(responseData)) {
            logger.info("Session expired, renewing...");
            await this.renewSession();

            if (retryCount < MAX_RETRY_ATTEMPTS) {
               return this.getResponse(command, retryCount + 1);
            }
            throw new InvalidCredentialsError();
         }

         // Check if report is blocked
         if (this.isReportBlocked(responseData)) {
            throw new BlockedReportError();
         }

         // Cache the successful response
         await this.cacheResponse(student, command, responseData);

         return responseData;
      } catch (error) {
         return this.handleRequestError(error, command);
      }
   }

   /**
    * Builds request data based on command type
    */
   private buildRequestData(command: "mid" | "att", student: any): Record<string, string> {
      const baseData = {
         acadYear: "2025-26",
         branch: student.branch,
         section: student.section,
         dateOfAttendance: INDIAN_DATE,
      };

      if (command === "mid") {
         return {
            ...baseData,
            yearSem: student.year,
            midsChosen: "mid1, mid2, mid3",
         };
      }

      return {
         ...baseData,
         yearSem: student.year.slice(0, 1) + "2",
      };
   }

   /**
    * Builds request headers with session cookie
    */
   private buildHeaders(command: "mid" | "att"): Record<string, string> {
      const headers = header(command);
      headers.Cookie = `PHPSESSID=${sessionCookie}`;
      return headers;
   }

   /**
    * Checks if response is login page (session expired)
    */
   private isLoginPage(response: string): boolean {
      return response.includes(
         "<tr><td>User Name</td><td>:</td><td><input type=textbox name='username' id='username'"
      );
   }

   /**
    * Checks if report is blocked by admin
    */
   private isReportBlocked(response: string): boolean {
      return response.includes("Blocked");
   }

   /**
    * Caches successful response for fallback
    */
   private async cacheResponse(student: any, command: "mid" | "att", response: string): Promise<void> {
      try {
         await storeResponse(
            student.year,
            student.branch,
            student.section,
            command,
            response
         );
      } catch (error) {
         logger.error("Failed to cache response", error);
      }
   }

   /**
    * Handles request errors with fallback to cached data
    */
   private async handleRequestError(error: unknown, command: "mid" | "att"): Promise<string> {
      // Re-throw custom errors
      if (error instanceof AcademicError) {
         throw error;
      }

      const isNetworkError = error instanceof AxiosError &&
         (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT" || !error.response);

      if (isNetworkError) {
         logger.warn("Network error, attempting fallback...");
      } else {
         logger.error("Request error", error);
      }

      // Try to get cached response
      try {
         const student = await getStudentCached(this.rollnumber);
         const cachedResponse = await getResponse(
            student.year,
            student.branch,
            student.section,
            command
         );

         if (cachedResponse) {
            logger.debug("Using cached response");
            return cachedResponse;
         }
      } catch (fallbackError) {
         logger.error("Fallback failed", fallbackError);
      }

      throw new ServerDownError();
   }

   /**
    * Validates if current session cookie is still valid
    */
   async isSessionValid(): Promise<boolean> {
      if (!sessionCookie) return false;

      try {
         const url = `${BASE_URL}/attendance`;
         const headers = header("att");
         headers.Cookie = `PHPSESSID=${sessionCookie}`;

         const response = await axios.get(url, {
            headers,
            timeout: REQUEST_TIMEOUT
         });

         return response.data.includes("function selectHour(obj)");
      } catch (error) {
         logger.warn("Session validation failed", error);
         return false;
      }
   }

   /**
    * Renews session by logging in again
    */
   async renewSession(): Promise<void> {
      const sessionToken = this.generateSessionToken();
      const headers = header("att");
      headers.Cookie = `PHPSESSID=${sessionToken}`;
      headers.Referer = `${BASE_URL}/attendance/attendanceLogin.php`;

      const payload = `username=${N_USERNAME}&password=${N_PASSWORD}&captcha=`;

      try {
         await axios.post(LOGIN_URL, payload, {
            headers,
            maxRedirects: 0,
            timeout: REQUEST_TIMEOUT,
            validateStatus: (status) => status >= 200 && status < 303,
         });

         sessionCookie = sessionToken;
         logger.info("Session renewed successfully");
      } catch (error) {
         logger.error("Failed to renew session", error);
         throw new InvalidCredentialsError();
      }
   }

   /**
    * Generates a random session token
    */
   private generateSessionToken(): string {
      const randomString = crypto.randomBytes(3).toString("hex");
      return `ggpmgfj8dssskkp2q2h6db${randomString}0`;
   }

   /**
    * Gets attendance data as JSON with Redis caching
    */
   async getAttendanceJSON(): Promise<Attendance> {
      // Try Redis cache first
      const cached = await this.getCachedAttendance();
      if (cached) {
         logger.debug("Returning cached attendance");
         return cached;
      }

      // Fetch fresh data
      const response = await this.getResponse("att");

      if (!response.includes(this.rollnumber)) {
         throw new NoDataFoundError("attendance");
      }

      // Store in Redis for future requests
      await storeAttendanceToRedis(response);

      return await Academic.parseAttendanceResponse(response, this.rollnumber);
   }

   /**
    * Gets cached attendance from Redis
    */
   private async getCachedAttendance(): Promise<Attendance | null> {
      try {
         const redisClient = await getClient();
         const cached = await redisClient.get(`attendance:${this.rollnumber}`);
         return cached ? JSON.parse(cached) as Attendance : null;
      } catch (error) {
         logger.warn("Redis cache miss", error);
         return null;
      }
   }

   /**
    * Parses attendance HTML response into structured data
    */
   static async parseAttendanceResponse(doc: string, rollnumber: string): Promise<Attendance> {
      const student = await getStudentCached(rollnumber);
      const { roll_no, branch, section, year } = student;

      const $ = cheerio.load(doc);
      const studentRow = $(`tr[id=${roll_no.toUpperCase()}]`);

      if (!studentRow.length) {
         throw new NoDataFoundError("attendance");
      }

      const percentageText = studentRow.find("td[class=tdPercent]").text();
      const totalClassesMatch = percentageText.match(/\(([^)]+)\)/);
      const totalClassesStr = totalClassesMatch ? totalClassesMatch[1].trim() : "0/0";

      const rows = $("tr");
      const nameRow = rows.eq(1);
      const lastUpdatedRow = rows.eq(2);
      const conductedRow = rows.eq(3);

      // Extract data from rows
      const names = nameRow.find("td").map((_, el) => $(el).text()).get();
      const lastUpdated = lastUpdatedRow.find("td").map((_, el) => $(el).text()).get();
      const attended = studentRow.find("td").map((_, el) => $(el).text()).get();
      const conducted = conductedRow.find("td").map((_, el) => $(el).text()).get();

      // Clean up arrays
      lastUpdated.shift();
      conducted.shift();
      attended.splice(0, 2);

      // Filter out empty subjects and format data
      const subjects = Academic.buildSubjectList(names, attended, conducted, lastUpdated);

      const [attendedTotal, conductedTotal] = totalClassesStr.split("/").map(s => parseInt(s.trim()) || 0);

      return {
         rollno: roll_no,
         year_branch_section: `${year.slice(0, 1)}_${BRANCHES[parseInt(branch)]}_${section}`,
         percentage: parseFloat(percentageText.split("(")[0].trim()) || 0,
         totalClasses: {
            attended: attendedTotal,
            conducted: conductedTotal,
         },
         subjects,
      };
   }

   /**
    * Builds subject list from parsed data
    */
   private static buildSubjectList(
      names: string[],
      attended: string[],
      conducted: string[],
      lastUpdated: string[]
   ): AttendanceBySubject[] {
      const subjects: AttendanceBySubject[] = [];

      for (let i = 0; i < conducted.length; i++) {
         const conductedCount = parseInt(conducted[i]) || 0;

         // Skip subjects with no classes or percentage column
         if (conductedCount === 0 || names[i] === "%AGE") continue;

         subjects.push({
            subject: names[i] || "Unknown",
            attended: parseInt(attended[i]) || 0,
            conducted: conductedCount,
            lastUpdated: lastUpdated[i]?.split("(")[0]?.trim() || "N/A",
         });
      }

      return subjects;
   }

   /**
    * Gets mid-term marks as JSON with Redis caching
    */
   async getMidmarksJSON(): Promise<Midmarks> {
      // Try Redis cache first
      const cached = await this.getCachedMidmarks();
      if (cached) {
         logger.debug("Returning cached midmarks");
         return cached;
      }

      // Fetch fresh data
      const response = await this.getResponse("mid");

      if (!response.includes(this.rollnumber)) {
         throw new NoDataFoundError("midmarks");
      }

      // Store in Redis for future requests
      await storeMidMarksToRedis(response);

      return await Academic.parseMidmarksResponse(response, this.rollnumber);
   }

   /**
    * Gets cached midmarks from Redis
    */
   private async getCachedMidmarks(): Promise<Midmarks | null> {
      try {
         const redisClient = await getClient();
         const cached = await redisClient.get(`midmarks:${this.rollnumber}`);
         return cached ? JSON.parse(cached) as Midmarks : null;
      } catch (error) {
         logger.warn("Redis cache miss", error);
         return null;
      }
   }

   /**
    * Parses midmarks HTML response into structured data
    */
   static async parseMidmarksResponse(doc: string, rollnumber: string): Promise<Midmarks> {
      const student = await getStudentCached(rollnumber);
      const { roll_no, year, section, branch } = student;

      const $ = cheerio.load(doc);
      const studentRow = $(`tr[id=${roll_no.toUpperCase()}]`);

      if (!studentRow.length) {
         throw new NoDataFoundError("midmarks");
      }

      const marksCells = studentRow.find("td").slice(2);
      const marksList = marksCells.map((_, el) => $(el).text()).get();

      const nameRow = $("tr").eq(1);
      const { subjects, labs } = Academic.separateSubjectsAndLabs($, nameRow);

      const midmarksList = Academic.buildMidmarksList([...subjects, ...labs], marksList, subjects);

      return {
         rollno: roll_no,
         year_branch_section: `${year.slice(0, 1)}_${BRANCHES[parseInt(branch)]}_${section}`,
         subjects: midmarksList,
      };
   }

   /**
    * Separates subjects and labs from header row
    */
   private static separateSubjectsAndLabs($: cheerio.CheerioAPI, nameRow: cheerio.Cheerio<any>): { subjects: string[]; labs: string[] } {
      const subjects: string[] = [];
      const labs: string[] = [];

      nameRow.find("td").each((_, element) => {
         const hasLink = $(element).find("a").length > 0;
         const text = hasLink
            ? $(element).find("a").text().trim()
            : $(element).text().trim();

         if (text) {
            (hasLink ? subjects : labs).push(text);
         }
      });

      return { subjects, labs };
   }

   /**
    * Builds midmarks list from parsed data
    */
   private static buildMidmarksList(
      allSubjects: string[],
      marksList: string[],
      subjectsOnly: string[]
   ): MidmarksBySubject[] {
      return allSubjects.map((subject, i) => {
         const isSubject = subjectsOnly.includes(subject);
         const marksStr = marksList[i] || "";

         if (isSubject) {
            const [part1, part2] = marksStr.split("/");
            const m2Match = part2?.match(/^(\d+)\((\d+)\)/);

            return {
               subject,
               M1: parseInt(part1) || 0,
               M2: m2Match ? parseInt(m2Match[1]) : 0,
               average: m2Match ? parseInt(m2Match[2]) : 0,
               type: "Subject",
            };
         }

         return {
            subject,
            M1: parseInt(marksStr) || 0,
            M2: 0,
            average: 0,
            type: "Lab",
         };
      });
   }
}
