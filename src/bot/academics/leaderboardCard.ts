import { getRegistration } from "../../db/registration.model.js";
import { getStudentCached } from "../../services/redis/utils.js";
import {
  getLeaderboard,
  getStudentRank,
} from "../../db/student_stats.model.js";
import { BRANCHES } from "../../constants/index.js";
import { escapeHtml } from "../../services/text.js";
import { logger } from "../../config/logger.js";

/**
 * The register, said in the chat.
 *
 * It used to be a web page. Attendance answers live only in the bot now, so
 * the register comes here too: the same rows, one message, no second surface
 * to open. Names are private-chat only — a group message gets forwarded, and
 * a classmate's name should not ride along with it.
 */

const TOP = 10;

interface Scope {
  year?: string;
  branch?: string;
  section?: string;
}

interface Caller {
  scope: Scope;
  /** The saved registration's roll, for the "you are #N" line. */
  roll: string | null;
}

/** The portal's year_sem (11..42) as the year digit the register filters on. */
const yearOf = (raw: unknown): string | undefined => {
  const match = String(raw ?? "")
    .trim()
    .match(/^([1-4])/);
  return match ? match[1] : undefined;
};

/**
 * The caller's own section, when they have a saved roll. A missing
 * registration, an unmapped roll or a failed lookup all fall back to the
 * whole register rather than failing the card.
 */
const callerFor = async (userId: number): Promise<Caller> => {
  try {
    const registration = await getRegistration(String(userId));
    if (!registration) return { scope: {}, roll: null };

    const student = await getStudentCached(registration.roll_no);
    const year = yearOf(student.year);
    return {
      roll: registration.roll_no,
      scope: year
        ? {
            year,
            branch: student.branch ? String(student.branch) : undefined,
            section: student.section ? String(student.section) : undefined,
          }
        : {},
    };
  } catch (e) {
    logger.debug(
      "[leaderboard] scope lookup skipped:",
      e instanceof Error ? e.message : e,
    );
    return { scope: {}, roll: null };
  }
};

/** "3rd year · CSE · A", or null for a whole-college view. */
const scopeLine = (scope: Scope): string | null => {
  if (!scope.year) return null;
  const suffix =
    scope.year === "1"
      ? "st"
      : scope.year === "2"
        ? "nd"
        : scope.year === "3"
          ? "rd"
          : "th";
  const branch = scope.branch
    ? (BRANCHES[Number(scope.branch)] ?? scope.branch)
    : null;
  return [`${scope.year}${suffix} year`, branch, scope.section]
    .filter(Boolean)
    .join(" · ");
};

const scoreOf = (value: unknown): string =>
  typeof value === "number" ? `${value.toFixed(2)}%` : "-";

/**
 * The register as one HTML message, ready for `sendMessage`.
 *
 * `withNames` is the privacy switch: a private chat may name its classmates,
 * a group gets rolls only. The caller's own rank rides along only when the
 * rows can carry names, so a group card says no more than the rows do.
 */
export const leaderboardText = async ({
  userId,
  withNames,
}: {
  userId: number;
  withNames: boolean;
}): Promise<string> => {
  const caller = await callerFor(userId);
  const { rows, total } = await getLeaderboard(
    "attendance",
    TOP,
    0,
    caller.scope,
    // no name search here: this card is the top of the register, not a lookup
    { includeNames: withNames, searchNames: false },
  );

  if (rows.length === 0) {
    return "Nobody has a figure yet. Ask /attendance once and come back.";
  }

  const head = scopeLine(caller.scope);
  const lines = rows.map((row, index) => {
    const who = withNames && row.name ? row.name : row.roll_no;
    return `<b>${index + 1}</b> ${escapeHtml(String(who))} · ${scoreOf(row.attendance_percentage)}`;
  });

  const rank =
    withNames && caller.roll
      ? await getStudentRank(caller.roll, "attendance").catch(() => null)
      : null;

  const parts = [
    "🏆 <b>Attendance register</b>",
    head ? `<i>${escapeHtml(head)}</i>` : "<i>Whole college</i>",
    "",
    ...lines,
    "",
    `<i>Top ${rows.length} of ${total}. Ask /attendance for your own figure.</i>`,
  ];

  if (rank) {
    const mine = rank.value == null ? "-" : `${Number(rank.value).toFixed(2)}%`;
    parts.push(`<i>You are #${rank.rank} of ${rank.total} at ${mine}.</i>`);
  }

  return parts.join("\n");
};
