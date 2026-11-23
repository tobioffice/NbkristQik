export const formatScore = (
  stat: { attendance_percentage: number; mid_marks_avg: number | null },
  sortBy: "attendance" | "midmarks",
): string =>
  sortBy === "attendance"
    ? (stat.attendance_percentage?.toFixed(2) ?? "-")
    : stat.mid_marks_avg != null
      ? stat.mid_marks_avg.toFixed(1)
      : "-";

/** "1 unit" / "3 units": the one piece of grammar the shelf needs. */
export const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * The 75% line, said as a distance: "6.2 above 75%" reads faster than a
 * percentage the student has to hold in their head.
 */
export const formatGap = (value: number, minimum = 75): string => {
  const diff = Math.round((value - minimum) * 10) / 10;
  if (diff === 0) return `on the ${minimum}% line`;
  return diff > 0
    ? `${diff.toFixed(1)} above ${minimum}%`
    : `${Math.abs(diff).toFixed(1)} below ${minimum}%`;
};

export interface BunkPlan {
  /** Classes that can be skipped and still stay at or above the minimum. */
  skips: number;
  /** Classes to attend in a row to reach the minimum. */
  needed: number;
}

/**
 * The bunk plan, with the same arithmetic as the bot's formatter.
 *
 * Skipping X more classes grows the denominator:
 *   attended / (conducted + X) >= minimum  ->  X <= attended/minimum - conducted
 * Attending Y in a row grows both sides:
 *   (attended + Y) / (conducted + Y) >= minimum
 *     ->  Y >= (minimum * conducted - attended) / (1 - minimum)
 *
 * Neither number is ever negative: at or above the line there is nothing to
 * recover, and below it there is nothing to skip.
 */
export const bunkPlan = (
  attended: number,
  conducted: number,
  minimum = 75,
): BunkPlan => {
  if (conducted <= 0) return { skips: 0, needed: 0 };

  const target = minimum / 100;
  // binary fractions make an exact half land a hair above or below the
  // integer; a tiny tolerance keeps the printed plan from adding a phantom
  // class at the boundary
  const epsilon = 1e-9;
  return {
    skips: Math.max(0, Math.floor(attended / target - conducted + epsilon)),
    needed: Math.max(
      0,
      Math.ceil((target * conducted - attended) / (1 - target) - epsilon),
    ),
  };
};

/**
 * SQLite writes `datetime('now')` as "YYYY-MM-DD HH:MM:SS" in UTC. Parsing
 * that string raw would read it as local time, so the zone is pinned.
 */
const parseDbUtc = (value: string): number => {
  const trimmed = value.trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) return Date.parse(trimmed);
  return Date.parse(`${trimmed.replace(" ", "T")}Z`);
};

/** A SQLite UTC timestamp as epoch milliseconds; NaN when unreadable. */
export const dbUtcMs = (value: string): number => parseDbUtc(value);

/** An absolute stamp in IST, 12-hour, the way the register prints dates. */
export const istStamp = (ms: number): string =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(ms));

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * "Week of 17 Nov": the IST Monday the league's week starts on.
 *
 * The home banner paints before its league answer lands, so it computes the
 * label itself; India has no daylight saving, so the fixed shift is exact and
 * matches the server's label. The API's answer replaces it when it arrives.
 */
export const istWeekLabel = (now: Date = new Date()): string => {
  const shifted = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const weekday = shifted.getUTCDay() || 7; // 1 = Monday ... 7 = Sunday
  const monday = new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() - (weekday - 1),
    ),
  );
  return `Week of ${monday.getUTCDate()} ${MONTHS[monday.getUTCMonth()]}`;
};

/** An absolute IST stamp from a database timestamp; null when unreadable. */
export const istStampFromDb = (
  value: string | null | undefined,
): string | null => {
  if (!value) return null;
  const ms = parseDbUtc(value);
  return Number.isNaN(ms) ? null : istStamp(ms);
};

/**
 * "Synced 2 hours ago" — honest about stale data instead of implying the
 * numbers are live. Falls back to an IST date past a day, and to null when
 * the server has no timestamp at all.
 */
export const formatSyncedAt = (
  updatedAt: string | null | undefined,
  now: Date = new Date(),
): string | null => {
  if (!updatedAt) return null;
  const then = parseDbUtc(updatedAt);
  if (Number.isNaN(then)) return null;

  const minutes = Math.max(0, Math.floor((now.getTime() - then) / 60_000));
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `Synced ${istStamp(then)}`;
};

/** "2 min" / "3 hours" / "6 days": one end of a freshness range. */
const formatAge = (ms: number, now: Date): string => {
  const minutes = Math.max(0, Math.floor((now.getTime() - ms) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
};

/**
 * The age of the register, or the range when one fresh row would otherwise
 * make every row look fresh. A spread under an hour keeps the existing
 * "Synced X min ago" copy; a wider one prints both ends.
 */
export const formatFreshnessRange = (
  newest: string | null | undefined,
  oldest: string | null | undefined,
  now: Date = new Date(),
): string | null => {
  if (!newest) return null;
  const newestMs = parseDbUtc(newest);
  if (Number.isNaN(newestMs)) return null;

  const synced = formatSyncedAt(newest, now);
  if (!oldest) return synced;

  const oldestMs = parseDbUtc(oldest);
  if (Number.isNaN(oldestMs)) return synced;

  // a clock skew or a bad pair should read as "fresh", never as a negative
  // range
  const spread = Math.max(0, newestMs - oldestMs);
  if (spread < 3_600_000) return synced;

  return `Updated ${formatAge(newestMs, now)} to ${formatAge(oldestMs, now)} ago`;
};
