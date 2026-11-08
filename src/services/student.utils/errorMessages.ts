import { StudentNotFoundError } from "../redis/utils.js";

/**
 * A lookup's text plus the buttons that belong with it.
 *
 * Most messages are text-only. The one exception is "roll not found": the
 * closest rolls are offered as buttons, so the copy can honestly say "tap
 * one" instead of listing codes that do nothing.
 */
export interface LookupReplyMarkup {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export interface LookupResult {
  text: string;
  markup?: LookupReplyMarkup;
}

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
 *
 * The suggestions are returned as an inline keyboard: one tap checks that
 * roll with the same `att_<roll>` callback the card uses, and the callback
 * handler still validates it before any portal request.
 */
export const buildStudentNotFoundMessage = (
  error: StudentNotFoundError,
): LookupResult => {
  const { rollnumber, suggestions } = error;

  let msg =
    `⚠️ <code>${rollnumber}</code> isn't in the college records yet.\n` +
    `New admissions can take a while to show up here.\n\n`;

  const markup: LookupReplyMarkup | undefined =
    suggestions.length > 0
      ? {
          inline_keyboard: suggestions.map((s) => [
            { text: s, callback_data: `att_${s}` },
          ]),
        }
      : undefined;

  if (markup) {
    msg += `Closest rolls I have, tap one to try it:\n\n`;
  }

  msg += `Yours still missing? /report it and I'll add it.`;
  return { text: msg, markup };
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
