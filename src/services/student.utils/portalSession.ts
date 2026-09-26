import axios from "axios";
import crypto from "crypto";
import { urls, headers as header, BASE_URL } from "../../constants/index.js";
import { N_USERNAME, N_PASSWORD } from "../../config/environmentals.js";
import { InvalidCredentialsError } from "./academicErrors.js";
import { logger } from "../../config/logger.js";

const LOGIN_URL = urls.login;
const REQUEST_TIMEOUT = 5000; // Increased timeout for reliability

// Session cookie storage
let sessionCookie = "";

/**
 * Generates a random session token (PHPSESSID the portal accepts).
 * Shared with syncdb.ts which performs its own login.
 */
export const makeSessionToken = (): string => {
  const randomString = crypto.randomBytes(3).toString("hex");
  return `ggpmgfj8dssskkp2q2h6db${randomString}0`;
};

export const getSessionCookie = (): string => sessionCookie;

/**
 * Validates if current session cookie is still valid
 */
export const isSessionValid = async (): Promise<boolean> => {
  if (!sessionCookie) return false;

  try {
    const url = `${BASE_URL}/attendance`;
    const headers = header("att");
    headers.Cookie = `PHPSESSID=${sessionCookie}`;

    const response = await axios.get(url, {
      headers,
      timeout: REQUEST_TIMEOUT,
    });

    return response.data.includes("function selectHour(obj)");
  } catch (error) {
    logger.warn("[Academic] Session validation failed:", error);
    return false;
  }
};

/**
 * Renews session by logging in again
 */
export const renewSession = async (): Promise<void> => {
  const sessionToken = makeSessionToken();
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
    logger.debug("[Academic] Session renewed successfully");
  } catch (error) {
    logger.error("[Academic] Failed to renew session:", error);
    throw new InvalidCredentialsError();
  }
};

/** Academic year the portal expects for "today" (IST; year flips in July). */
export const getAcadYearForDate = (now: Date = new Date()): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
};
