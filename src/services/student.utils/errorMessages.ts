import { StudentNotFoundError } from "../redis/utils.js";

export const buildServerDownMessage = (
  _dataType: string,
  timestamp: string,
): string =>
  `⚠️ <b>College Server Temporarily Down</b>\n\n` +
  `🔄 <b>Status:</b> Server not responding\n` +
  `⏰ <b>Time:</b> ${timestamp}\n\n` +
  `💡 <b>What you can do:</b>\n` +
  `• Wait 5-10 minutes and try again\n` +
  `• Server usually recovers automatically\n` +
  `• Peak hours (9 AM - 5 PM) may be slower\n\n` +
  `📦 <i>Showing cached data if available...</i>\n\n` +
  `<i>Tip: Try again using your roll number</i>`;

export const buildNoDataMessage = (rollNo: string, dataType: string): string =>
  `❌ <b>No ${dataType === "attendance" ? "Attendance" : "Mid-Marks"} Data Found</b>\n\n` +
  `🔍 <b>Roll Number:</b> <code>${rollNo}</code>\n\n` +
  `💡 <b>Please check:</b>\n` +
  `• Roll number is correct (e.g., 21B81A05E9)\n` +
  `• Data is available on college portal\n` +
  `• You're registered for this semester\n\n` +
  `<i>If issue persists, contact your faculty.</i>`;

/**
 * Roll number not in college records. Not framed as a typo — the roll is
 * often simply new/unloaded in the DB (e.g. fresh 1st-year batches).
 */
export const buildStudentNotFoundMessage = (
  error: StudentNotFoundError,
): string => {
  const { rollnumber, suggestions } = error;

  let msg =
    `❌ <b>Roll number not found</b>\n\n` +
    `<code>${rollnumber}</code> isn't in college records yet.\n` +
    `<i>New admissions sometimes take time to appear here.</i>\n\n`;

  if (suggestions.length > 0) {
    msg += `🔎 <b>Nearby rolls in records:</b>\n`;
    for (const s of suggestions) {
      msg += `• <code>${s}</code>\n`;
    }
    msg += `\nTap a suggestion and send it.\n\n`;
  }

  msg += `<i>Missing? Use /report and I'll add it.</i>`;
  return msg;
};

export const buildBlockedReportMessage = (): string =>
  `🚫 <b>Report Access Blocked</b>\n\n` +
  `⚠️ The college administrator has temporarily blocked access to this report.\n\n` +
  `💡 <b>What to do:</b>\n` +
  `• Contact your class coordinator\n` +
  `• Check college portal for announcements\n` +
  `• Try again in a few hours\n\n` +
  `<i>This is usually temporary during result preparation.</i>`;

export const buildGenericErrorMessage = (
  message: string,
  dataType: string,
  timestamp: string,
): string =>
  `⚠️ <b>Error Fetching ${dataType === "attendance" ? "Attendance" : "Mid-Marks"}</b>\n\n` +
  `❌ <b>Error:</b> ${message}\n` +
  `⏰ <b>Time:</b> ${timestamp}\n\n` +
  `💡 <b>Try:</b>\n` +
  `• Send your roll number again\n` +
  `• Wait a few minutes\n` +
  `• Check your internet connection\n\n` +
  `<i>If problem continues, use /report to notify admin.</i>`;

export const buildUnknownErrorMessage = (
  dataType: string,
  timestamp: string,
): string =>
  `⚠️ <b>Unexpected Error</b>\n\n` +
  `❌ <b>Type:</b> Unable to fetch ${dataType}\n` +
  `⏰ <b>Time:</b> ${timestamp}\n\n` +
  `💡 <b>Troubleshooting:</b>\n` +
  `1. Try again in a few minutes\n` +
  `2. Verify your roll number is correct\n` +
  `3. Check if college portal is accessible\n\n` +
  `📝 <b>Still facing issues?</b>\n` +
  `Use /report to contact support with your roll number.\n\n` +
  `<i>We apologize for the inconvenience.</i>`;
