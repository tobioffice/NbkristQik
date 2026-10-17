import { StudentNotFoundError } from "../redis/utils.js";

export const buildServerDownMessage = (
  _dataType: string,
  _timestamp: string,
): string =>
  `⚠️ The college portal isn't responding right now. It usually comes back on its own, try again in 5 or 10 minutes.\n\n` +
  `I'll show your last saved data below if I have any.`;

export const buildNoDataMessage = (rollNo: string, dataType: string): string =>
  `⚠️ I can't find ${dataType === "attendance" ? "attendance" : "mid marks"} data for <code>${rollNo}</code>.\n\n` +
  `Check the roll number once, and whether the portal shows it. If the semester just changed, your roll may not be loaded yet.\n\n` +
  `Still missing? Ask your faculty.`;

/**
 * Roll number not in college records. Not framed as a typo — the roll is
 * often simply new/unloaded in the DB (e.g. fresh 1st-year batches).
 */
export const buildStudentNotFoundMessage = (
  error: StudentNotFoundError,
): string => {
  const { rollnumber, suggestions } = error;

  let msg =
    `⚠️ <code>${rollnumber}</code> isn't in the college records yet.\n` +
    `New admissions can take a while to show up here.\n\n`;

  if (suggestions.length > 0) {
    msg += `Closest rolls I have, tap one to try it:\n`;
    for (const s of suggestions) {
      msg += `• <code>${s}</code>\n`;
    }
    msg += `\n`;
  }

  msg += `Yours still missing? /report it and I'll add it.`;
  return msg;
};

export const buildBlockedReportMessage = (): string =>
  `⚠️ The college has blocked this report for now. This happens for a short while when results are being prepared.\n\n` +
  `Check back in a few hours, or ask your class coordinator.`;

export const buildGenericErrorMessage = (
  message: string,
  dataType: string,
  _timestamp: string,
): string =>
  `⚠️ Error fetching your ${dataType === "attendance" ? "attendance" : "mid marks"}: ${message}\n\n` +
  `Send your roll again in a few minutes. If it keeps failing, /report it to me.`;

export const buildUnknownErrorMessage = (
  dataType: string,
  _timestamp: string,
): string =>
  `⚠️ Couldn't fetch ${dataType}. Error on my side.\n\n` +
  `Try again in a few minutes and check the roll number. Still stuck? /report it with your roll and I'll take a look.`;
