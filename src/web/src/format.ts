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

/**
 * SQLite writes `datetime('now')` as "YYYY-MM-DD HH:MM:SS" in UTC. Parsing
 * that string raw would read it as local time, so the zone is pinned.
 */
const parseDbUtc = (value: string): number => {
  const trimmed = value.trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) return Date.parse(trimmed);
  return Date.parse(`${trimmed.replace(" ", "T")}Z`);
};

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
