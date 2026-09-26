//
// Academic Module — portal HTTP orchestration (parsing and formatting live
// in parsers.ts / formatters.ts, session handling in portalSession.ts)
//
import { urls, headers as header } from "../../constants/index.js";
import { logger } from "../../config/logger.js";

import { IAcademic, Attendance, Midmarks, Student } from "../../types/index.js";

import axios, { AxiosError } from "axios";
import { getStudentCached, StudentNotFoundError } from "../redis/utils.js";
import {
  storeAttendanceToRedis,
  storeMidMarksToRedis,
} from "../redis/storeAttOrMidToRedis.js";
import { getClient } from "../redis/getRedisClient.js";
import {
  storeResponse,
  getResponse,
  buildResponseId,
} from "../../db/fallback/response.model.js";
import {
  AcademicError,
  ServerDownError,
  BlockedReportError,
  NoDataFoundError,
  InvalidCredentialsError,
} from "./academicErrors.js";
import {
  getAcadYearForDate,
  getSessionCookie,
  isSessionValid,
  renewSession,
} from "./portalSession.js";
import { parseAttendanceResponse, parseMidmarksResponse } from "./parsers.js";

// Re-exported for existing importers (tests, AcademicTG, syncdb)
export {
  AcademicError,
  ServerDownError,
  BlockedReportError,
  NoDataFoundError,
  InvalidCredentialsError,
} from "./academicErrors.js";
export { getAcadYearForDate, makeSessionToken } from "./portalSession.js";

const REQUEST_TIMEOUT = 5000; // Increased timeout for reliability
const MAX_RETRY_ATTEMPTS = 2;

export class Academic implements IAcademic {
  constructor(public rollnumber: string) {
    // Normalize roll number to uppercase
    this.rollnumber = rollnumber.toUpperCase().trim();
  }

  /**
   * Fetches response from college server with retry logic
   */
  async getResponse(command: "mid" | "att", retryCount = 0): Promise<string> {
    try {
      return await this.fetchFresh(command, retryCount);
    } catch (error) {
      // Transient network failure? retry once with 1.5s backoff before
      // falling back to the section-level cached response
      if (this.isTransientNetworkError(error) && retryCount < 1) {
        logger.warn(
          `[Academic] Transient network error (${error instanceof AxiosError ? error.code : "unknown"}), retrying in 1.5s...`,
        );
        await new Promise((r) => setTimeout(r, 1500));
        return this.getResponse(command, retryCount + 1);
      }

      return this.handleRequestError(error, command);
    }
  }

  /**
   * Single portal request + session/blocked checks + fallback caching.
   * Recurses through getResponse after session renewal.
   */
  private async fetchFresh(
    command: "mid" | "att",
    retryCount: number,
  ): Promise<string> {
    const url = command === "mid" ? urls.midmarks : urls.attendance;
    const student = await getStudentCached(this.rollnumber);
    const requestData = this.buildRequestData(command, student);

    logger.debug(
      `[Academic] Fetching ${command} for ${this.rollnumber}`,
      requestData,
    );

    const response = await axios.post(url, requestData, {
      headers: this.buildHeaders(command),
      timeout: REQUEST_TIMEOUT,
    });

    const responseData = response.data;

    // Check if session expired (login page returned)
    if (this.isLoginPage(responseData)) {
      logger.debug("[Academic] Session expired, renewing...");
      await renewSession();

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
  }

  private isTransientNetworkError(error: unknown): boolean {
    return (
      error instanceof AxiosError &&
      (error.code === "ECONNABORTED" ||
        error.code === "ETIMEDOUT" ||
        !error.response ||
        error.code === "ECONNREFUSED")
    );
  }

  /**
   * Builds request data based on command type
   */
  private buildRequestData(
    command: "mid" | "att",
    student: Student,
  ): Record<string, string> {
    const baseData = {
      acadYear: getAcadYearForDate(),
      branch: student.branch,
      section: student.section,
      dateOfAttendance: "27-03-2030", // Max date for attendance
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
      yearSem: student.year,
    };
  }

  /**
   * Builds request headers with session cookie
   */
  private buildHeaders(command: "mid" | "att"): Record<string, string> {
    const headers = header(command);
    headers.Cookie = `PHPSESSID=${getSessionCookie()}`;
    return headers;
  }

  /**
   * Checks if response is login page (session expired)
   */
  private isLoginPage(response: string): boolean {
    return response.includes(
      "<tr><td>User Name</td><td>:</td><td><input type=textbox name='username' id='username'",
    );
  }

  /**
   * Checks if report is blocked by admin — matches the portal's actual
   * blocked-page marker, not any occurrence of "Blocked" (student names,
   * subject codes etc. could false-positive a valid report).
   */
  private isReportBlocked(response: string): boolean {
    return response.includes("Blocked by Admin");
  }

  /**
   * Caches successful response for fallback
   */
  private async cacheResponse(
    student: Student,
    command: "mid" | "att",
    response: string,
  ): Promise<void> {
    try {
      await storeResponse(
        buildResponseId(student.year, student.branch, student.section, command),
        response,
      );
    } catch (error) {
      logger.error("[Academic] Failed to cache response:", error);
    }
  }

  /**
   * Handles request errors with fallback to cached data
   */
  private async handleRequestError(
    error: unknown,
    command: "mid" | "att",
  ): Promise<string> {
    // Re-throw custom errors
    if (error instanceof AcademicError) {
      throw error;
    }

    // Student genuinely not in college records — must not be masked as a
    // server outage. Propagate so the user gets "not found" + suggestions.
    if (error instanceof StudentNotFoundError) {
      throw error;
    }

    if (this.isNetworkError(error)) {
      logger.warn("[Academic] Network error, attempting fallback...");
    } else {
      logger.error("[Academic] Request error:", error);
    }

    const cachedResponse = await this.getFallbackResponse(command);
    if (cachedResponse) {
      logger.debug("[Academic] Using cached response");
      return cachedResponse;
    }

    throw new ServerDownError();
  }

  private isNetworkError(error: unknown): boolean {
    return (
      error instanceof AxiosError &&
      (error.code === "ECONNABORTED" ||
        error.code === "ETIMEDOUT" ||
        !error.response)
    );
  }

  /**
   * Section-level cached response from the fallback store, if any
   */
  private async getFallbackResponse(
    command: "mid" | "att",
  ): Promise<string | null> {
    try {
      const student = await getStudentCached(this.rollnumber);
      return await getResponse(
        buildResponseId(student.year, student.branch, student.section, command),
      );
    } catch (fallbackError) {
      logger.error("[Academic] Fallback failed:", fallbackError);
      return null;
    }
  }

  /**
   * Gets attendance data as JSON with Redis caching
   */
  async getAttendanceJSON(): Promise<Attendance> {
    // Try Redis cache first
    const cached = await this.getCachedJson<Attendance>(
      `attendance:${this.rollnumber}`,
    );
    if (cached) {
      logger.debug("[Academic] Returning cached attendance");
      return cached;
    }

    // Fetch fresh data
    const response = await this.getResponse("att");

    if (!response.includes(this.rollnumber)) {
      throw new NoDataFoundError("attendance");
    }

    // Parse requester first and reply fast; full-section cache happens in background
    const mine = await parseAttendanceResponse(response, this.rollnumber);
    void storeAttendanceToRedis(response).catch((e) =>
      logger.warn("[Academic] background attendance cache failed:", e),
    );

    return mine;
  }

  /**
   * Gets mid-term marks as JSON with Redis caching
   */
  async getMidmarksJSON(): Promise<Midmarks> {
    // Try Redis cache first
    const cached = await this.getCachedJson<Midmarks>(
      `midmarks:${this.rollnumber}`,
    );
    if (cached) {
      logger.debug("[Academic] Returning cached midmarks");
      return cached;
    }

    // Fetch fresh data
    const response = await this.getResponse("mid");

    if (!response.includes(this.rollnumber)) {
      throw new NoDataFoundError("midmarks");
    }

    // Parse requester first and reply fast; full-section cache happens in background
    const mine = await parseMidmarksResponse(response, this.rollnumber);
    void storeMidMarksToRedis(response).catch((e) =>
      logger.warn("[Academic] background midmarks cache failed:", e),
    );

    return mine;
  }

  /**
   * Cached JSON from Redis, or null on miss/connection failure
   */
  private async getCachedJson<T>(key: string): Promise<T | null> {
    try {
      const redisClient = await getClient();
      const cached = await redisClient.get(key);
      return cached ? (JSON.parse(cached) as T) : null;
    } catch (error) {
      logger.debug("[Academic] Redis cache miss:", error);
      return null;
    }
  }

  /**
   * Validates if current session cookie is still valid
   */
  async isSessionValid(): Promise<boolean> {
    return isSessionValid();
  }

  /**
   * Renews session by logging in again
   */
  async renewSession(): Promise<void> {
    return renewSession();
  }

  /**
   * Parses attendance HTML response into structured data
   */
  static async parseAttendanceResponse(
    doc: string,
    rollnumber: string,
  ): Promise<Attendance> {
    return parseAttendanceResponse(doc, rollnumber);
  }

  /**
   * Parses midmarks HTML response into structured data
   */
  static async parseMidmarksResponse(
    doc: string,
    rollnumber: string,
  ): Promise<Midmarks> {
    return parseMidmarksResponse(doc, rollnumber);
  }
}
