//
// Academic Module — portal HTTP orchestration (parsing and formatting live
// in parsers.ts / formatters.ts, session handling in portalSession.ts)
//
import { urls, headers as header } from "../../constants/index.js";
import { logger } from "../../config/logger.js";

import { IAcademic, Attendance, Midmarks, Student } from "../../types/index.js";

import axios, { AxiosError } from "axios";
import { getStudentCached, StudentNotFoundError } from "../redis/utils.js";
import { redisKeys } from "../redis/keys.js";
import {
  persistAttendanceSection,
  persistMidmarksSection,
} from "../redis/storeAttOrMidToRedis.js";
import { getClient } from "../redis/getRedisClient.js";
import {
  storeResponse,
  getResponseRecord,
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
import {
  contextFor,
  parseAttendanceResponse,
  parseAttendanceSection,
  parseMidmarksResponse,
  parseMidmarksSection,
} from "./parsers.js";

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

/**
 * In-flight portal requests, keyed by section + command.
 *
 * Attendance and mid-marks reports cover a whole section: two students in the
 * same section must share one POST and one parse. The entry is deleted when
 * the request settles, so a failure is never cached for later callers.
 */
const sectionFlights = new Map<string, Promise<string>>();

/** "4 hours ago" etc. for a SQLite UTC datetime string. */
const formatAge = (updatedAt?: string | null): string | null => {
  if (!updatedAt) return null;

  const iso = updatedAt.includes("T")
    ? updatedAt
    : `${updatedAt.replace(" ", "T")}Z`;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;

  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 60) return "less than a minute ago";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

// A report row can exist in truncated HTML while carrying no usable numbers.
// Such a response must neither overwrite the fallback nor write zero stats.
const isUsableAttendance = (attendance: Attendance): boolean =>
  attendance.totalClasses.conducted > 0 ||
  attendance.subjects.length > 0 ||
  attendance.percentage > 0;

const isUsableMidmarks = (midmarks: Midmarks): boolean =>
  midmarks.subjects.length > 0;

export class Academic implements IAcademic {
  /**
   * When the data did not come from a fresh portal request, this says so.
   * The Telegram layer prints it above the card, because a stale attendance
   * figure is worse than a visible delay: a student may skip a class on it.
   */
  private dataNotice: string | null = null;

  constructor(public rollnumber: string) {
    // Normalize roll number to uppercase
    this.rollnumber = rollnumber.toUpperCase().trim();
  }

  /** Why the current result is not fresh, or null when it is. */
  getDataNotice(): string | null {
    return this.dataNotice;
  }

  private markCached(
    scope: "recent" | "fallback",
    recentWindow = "last hour",
    fallbackUpdatedAt?: string | null,
  ): void {
    if (scope === "recent") {
      this.dataNotice = `Saved copy from the ${recentWindow}; the college portal was not checked just now.`;
      return;
    }

    const age = formatAge(fallbackUpdatedAt);
    this.dataNotice = age
      ? `The college portal could not be reached. This is the last saved copy from ${age}; it may be out of date.`
      : "The college portal could not be reached. This is the last saved copy and may be out of date.";
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
   * Live portal response for callers that must not be served a saved copy.
   *
   * The uptime canary uses this instead of getResponse: getResponse falls
   * back to the section's saved response on a portal error, which would hide
   * a login failure or a broken report from the health check. This shares the
   * same single-flight request/login path and lets every failure throw.
   */
  async getFreshResponse(command: "mid" | "att"): Promise<string> {
    return this.fetchFresh(command, 0);
  }

  /**
   * Single portal request + session/blocked checks.
   *
   * The request is single-flight per section and command: concurrent students
   * in one section await the same POST. Responses are not cached here — the
   * caller caches only after the roll check and a successful parse, so a
   * broken layout cannot overwrite the last good fallback.
   */
  private async fetchFresh(
    command: "mid" | "att",
    retryCount: number,
  ): Promise<string> {
    const student = await getStudentCached(this.rollnumber);
    const requestData = this.buildRequestData(command, student);

    logger.debug(
      `[Academic] Fetching ${command} for ${this.rollnumber}`,
      requestData,
    );

    const key = `${student.year}:${student.branch}:${student.section}:${command}`;
    const existing = sectionFlights.get(key);
    if (existing) {
      logger.debug(`[Academic] joining in-flight ${command} for ${key}`);
      return existing;
    }

    const url = command === "mid" ? urls.midmarks : urls.attendance;

    // The retry after a login-page response must not look itself up in the
    // flight map (it would await its own promise), so it recurses locally.
    const request = async (attempt: number): Promise<string> => {
      const response = await axios.post(url, requestData, {
        headers: this.buildHeaders(command),
        timeout: REQUEST_TIMEOUT,
      });

      const responseData = response.data;

      // Check if session expired (login page returned)
      if (this.isLoginPage(responseData)) {
        logger.debug("[Academic] Session expired, renewing...");
        await renewSession();

        if (attempt < MAX_RETRY_ATTEMPTS) {
          return request(attempt + 1);
        }
        throw new InvalidCredentialsError();
      }

      // Check if report is blocked
      if (this.isReportBlocked(responseData)) {
        throw new BlockedReportError();
      }

      return responseData;
    };

    const flight = request(retryCount);
    sectionFlights.set(key, flight);

    try {
      return await flight;
    } finally {
      // Never leave a settled (especially rejected) promise in the map.
      if (sectionFlights.get(key) === flight) {
        sectionFlights.delete(key);
      }
    }
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
      this.markCached("fallback", "last hour", cachedResponse.updatedAt);
      return cachedResponse.content;
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
   * Section-level cached response from the fallback store, if any. The record
   * carries its save time so the notice can say how old the copy is.
   */
  private async getFallbackResponse(
    command: "mid" | "att",
  ): Promise<{ content: string; updatedAt: string | null } | null> {
    try {
      const student = await getStudentCached(this.rollnumber);
      return await getResponseRecord(
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
    this.dataNotice = null;

    // Try Redis cache first
    const cached = await this.getCachedJson<Attendance>(
      redisKeys.attendance(this.rollnumber),
    );
    if (cached) {
      logger.debug("[Academic] Returning cached attendance");
      this.markCached("recent");
      return cached;
    }

    // Fetch fresh data
    const response = await this.getResponse("att");

    if (!response.includes(this.rollnumber)) {
      throw new NoDataFoundError("attendance");
    }

    // Resolve the student once: the section context the report was fetched
    // for is the same one the whole-section write needs.
    const student = await getStudentCached(this.rollnumber);
    const context = contextFor(student);
    const parsed = parseAttendanceSection(response, context);
    const mine =
      parsed.get(this.rollnumber) ?? parsed.get(student.roll_no.toUpperCase());

    if (!mine) {
      throw new NoDataFoundError("attendance");
    }

    // Only a fresh, usable report may replace the saved copy or the section
    // stats. A fallback must not refresh its own timestamp, and a malformed
    // response must not poison either store.
    if (this.dataNotice === null && isUsableAttendance(mine)) {
      await this.cacheResponse(student, "att", response);

      // The same parsed map serves the requester and the section-wide
      // stats/cache write: one cheerio.load per report.
      void persistAttendanceSection(parsed, context).catch((e) =>
        logger.warn("[Academic] background attendance cache failed:", e),
      );
    }

    return mine;
  }

  /**
   * Gets mid-term marks as JSON with Redis caching
   */
  async getMidmarksJSON(): Promise<Midmarks> {
    this.dataNotice = null;

    // Try Redis cache first
    const cached = await this.getCachedJson<Midmarks>(
      redisKeys.midmarks(this.rollnumber),
    );
    if (cached) {
      logger.debug("[Academic] Returning cached midmarks");
      // mid-mark cache TTL is two hours (CACHE_TTL_MIDMARKS_S = 7200)
      this.markCached("recent", "last two hours");
      return cached;
    }

    // Fetch fresh data
    const response = await this.getResponse("mid");

    if (!response.includes(this.rollnumber)) {
      throw new NoDataFoundError("midmarks");
    }

    const student = await getStudentCached(this.rollnumber);
    const context = contextFor(student);
    const parsed = parseMidmarksSection(response, context);
    const mine =
      parsed.get(this.rollnumber) ?? parsed.get(student.roll_no.toUpperCase());

    if (!mine) {
      throw new NoDataFoundError("midmarks");
    }

    if (this.dataNotice === null && isUsableMidmarks(mine)) {
      await this.cacheResponse(student, "mid", response);

      // The same parsed map serves the requester and the section-wide
      // stats/cache write: one cheerio.load per report.
      void persistMidmarksSection(parsed, context).catch((e) =>
        logger.warn("[Academic] background midmarks cache failed:", e),
      );
    }

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
