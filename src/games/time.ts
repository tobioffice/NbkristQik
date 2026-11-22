/**
 * The league runs on IST, like every other time the bot shows.
 *
 * India has no daylight saving, so a fixed +5:30 shift is exact and avoids a
 * timezone database in the hot path. Dates are plain `YYYY-MM-DD` keys and
 * weeks are ISO weeks (`YYYY-Www`), both computed on the shifted clock.
 */

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (value: number): string => String(value).padStart(2, "0");

/** `YYYY-MM-DD` for a Date already shifted to IST. */
const dateKeyOf = (shifted: Date): string =>
  `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate(),
  )}`;

/** The ISO week (`YYYY-Www`) containing a `YYYY-MM-DD` date. */
export const isoWeekKey = (dateKey: string): string => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // ISO weeks start on Monday; Sunday is day 7.
  const isoDay = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - isoDay);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7,
  );
  return `${isoYear}-W${pad(week)}`;
};

export interface IstStamp {
  /** `YYYY-MM-DD` in IST. */
  date: string;
  /** ISO week `YYYY-Www`. */
  week: string;
  /** Monday of the same week, `YYYY-MM-DD`. */
  monday: string;
  /** 1 = Monday ... 7 = Sunday. */
  weekday: number;
  hour: number;
  minute: number;
}

/** The IST date, week, weekday and clock for a moment (default: now). */
export const istStamp = (now: Date = new Date()): IstStamp => {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const date = dateKeyOf(shifted);
  const weekday = shifted.getUTCDay() || 7;
  const mondayDate = new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() - (weekday - 1),
    ),
  );

  return {
    date,
    week: isoWeekKey(date),
    monday: dateKeyOf(mondayDate),
    weekday,
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
};

/** The calendar day before a `YYYY-MM-DD` key. */
export const previousDateKey = (dateKey: string): string => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return dateKeyOf(date);
};

/** "4:12 pm": the IST clock in the 12-hour form every card uses. */
export const istClockLabel = (now: Date = new Date()): string => {
  const { hour, minute } = istStamp(now);
  const hour12 = hour % 12 || 12;
  return `${hour12}:${pad(minute)} ${hour < 12 ? "am" : "pm"}`;
};
