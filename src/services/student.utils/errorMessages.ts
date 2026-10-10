import { StudentNotFoundError } from "../redis/utils.js";

export const buildServerDownMessage = (
  _dataType: string,
  timestamp: string,
): string =>
  `⚠️ <b>College Server Temporarily Unavailable</b>\n\n` +
  `🔄 <b>Status:</b> The server isn't responding right now\n` +
  `⏰ <b>Time:</b> ${timestamp}\n\n` +
  `💡 <b>What you can do:</b>\n` +
  `• Wait 5-10 minutes and try again\n` +
  `• The server usually comes back on its own\n` +
  `• Peak hours (9 AM - 5 PM) can be slower\n\n` +
  `📦 <i>I'll show your last saved data if I have it...</i>\n\n` +
  `<i>Tip: Try again with your roll number</i>`;

export const buildNoDataMessage = (rollNo: string, dataType: string): string =>
  `❌ <b>No ${dataType === "attendance" ? "Attendance" : "Mid-Marks"} Data Found</b>\n\n` +
  `🔍 <b>Roll Number:</b> <code>${rollNo}</code>\n\n` +
  `💡 <b>Try checking:</b>\n` +
  `• Is the roll number correct? (e.g., 21B81A05E9)\n` +
  `• Is the data available on the college portal?\n` +
  `• Are you registered for this semester?\n\n` +
  `<i>If it still doesn't work, reach out to your faculty.</i>`;

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
    `<code>${rollnumber}</code> is not in the college database yet.\n` +
    `<i>Sometimes new admissions take a little time to appear here.</i>\n\n`;

  if (suggestions.length > 0) {
    msg += `🔎 <b>Closest roll numbers in our records:</b>\n`;
    for (const s of suggestions) {
      msg += `• <code>${s}</code>\n`;
    }
    msg += `\nTap a suggestion and send it.\n\n`;
  }

  msg += `<i>If you still can't find it, use /report and I'll add it.</i>`;
  return msg;
};

export const buildBlockedReportMessage = (): string =>
  `🚫 <b>Report Access Blocked</b> ⛔️\n\n` +
  `⚠️ The college admin has temporarily blocked this report.\n\n` +
  `💡 <b>What can you do?</b>\n` +
  `• Get in touch with your class coordinator\n` +
  `• Keep an eye on announcements on the college portal\n` +
  `• Check again after a few hours\n\n` +
  `<i>This usually happens for a short time during result preparation.</i>`;

export const buildGenericErrorMessage = (
  message: string,
  dataType: string,
  timestamp: string,
): string =>
  `⚠️ <b>Error Fetching ${dataType === "attendance" ? "Attendance" : "Mid-Marks"}</b>\n\n` +
  `❌ <b>Error:</b> ${message}\n` +
  `⏰ <b>Time:</b> ${timestamp}\n\n` +
  `💡 <b>What you can try:</b>\n` +
  `• Send your roll number again\n` +
  `• Wait a few minutes and retry\n` +
  `• Make sure you're connected to the internet\n\n` +
  `<i>If it still fails, use /report to notify the admin.</i>`;

export const buildUnknownErrorMessage = (
  dataType: string,
  timestamp: string,
): string =>
  `⚠️ <b>Unexpected Error</b>\n\n` +
  `❌ <b>Type:</b> Couldn't fetch ${dataType}\n` +
  `⏰ <b>Time:</b> ${timestamp}\n\n` +
  `💡 <b>What you can try:</b>\n` +
  `1. Try again after a few minutes\n` +
  `2. Check your roll number properly\n` +
  `3. See if the college portal opens for you\n\n` +
  `📝 <b>Still stuck?</b>\n` +
  `Use /report with your roll number to reach support.\n\n` +
  `<i>Sorry for the inconvenience!</i>`;
