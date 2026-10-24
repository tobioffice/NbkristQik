import {
  AttendanceBySubject,
  Attendance,
  MidmarksBySubject,
  Midmarks,
} from "../../types/index.js";

/**
 * Formats attendance data into Telegram-friendly message with freshness indicator
 */
export const formatAttendanceMessage = (data: Attendance): string => {
  const { rollno, year_branch_section, percentage, totalClasses, subjects } =
    data;

  let msg =
    `🧑‍🎓 ROLL: ${rollno}\n` +
    `🏫 Branch: ${year_branch_section}\n` +
    `📚 Attended: ${totalClasses.attended}/${totalClasses.conducted}\n\n` +
    `📈 Percentage: ${percentage.toFixed(2)}%\n` +
    buildProgressBar(percentage);

  if (subjects.length > 0) {
    msg += `\n${buildAttendanceTable(subjects)}`;

    const risky = subjects.filter(
      (sub) => sub.conducted > 0 && (sub.attended / sub.conducted) * 100 < 75,
    );
    if (risky.length > 0) {
      msg +=
        `Below 75% in ${risky.length} subject${risky.length !== 1 ? "s" : ""}: ` +
        risky
          .map((sub) => `<code>${escapeHtml(sub.subject)}</code>`)
          .join(", ") +
        "\n";
    }

    msg += `\n<i>Stay above 75% and you're safe.</i>`;
  }

  return msg.trimEnd();
};

/** The name column, wide enough for the portal's course names, not the codes. */
const NAME_WIDTH = 11;
const COUNT_WIDTH = 7;
const PERCENT_WIDTH = 4;
const SEEN_WIDTH = 5;

/**
 * The other half of the attendance reply: what the percentage is made of.
 *
 * The card alone cannot tell a student whether the 82% is safe across the
 * board or carried by two subjects, so every subject gets a row with its
 * own attended/conducted, its percentage, and when the portal last saw it.
 */
const buildAttendanceTable = (subjects: AttendanceBySubject[]): string => {
  const line =
    NAME_WIDTH + 3 + COUNT_WIDTH + 3 + PERCENT_WIDTH + 3 + SEEN_WIDTH;

  let table = `<pre>`;
  table +=
    `${"SUBJ".padEnd(NAME_WIDTH)} │ ` +
    `${"ATT/TOT".padStart(COUNT_WIDTH)} │ ` +
    `${"NOW".padStart(PERCENT_WIDTH)} │ LAST\n`;
  table += `${"─".repeat(line)}\n`;

  for (const sub of subjects) {
    // pad first, escape second: the entity must not count towards the column
    const name = escapeHtml(
      truncateText(sub.subject, NAME_WIDTH).padEnd(NAME_WIDTH),
    );
    const seen = `${sub.attended}/${sub.conducted}`.padStart(COUNT_WIDTH);
    const now =
      sub.conducted > 0
        ? `${Math.round((sub.attended / sub.conducted) * 100)}%`.padStart(
            PERCENT_WIDTH,
          )
        : "—".padStart(PERCENT_WIDTH);
    const last = formatLastUpdated(sub.lastUpdated);

    table += `${name} │ ${seen} │ ${now} │ ${last}\n`;
  }

  table += `${"─".repeat(line)}</pre>\n`;
  return table;
};

/** Telegram parses HTML in replies; a course name must not break the parse. */
const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const formatLastUpdated = (value: string): string => {
  const trimmed = value.trim();

  // the portal sends DD-MM-YYYY, often with a "(2 days ago)" tail that the
  // parser already cut; the day and month are enough on a chat line
  if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
    return trimmed.slice(0, 5);
  }

  return trimmed || "N/A";
};

/**
 * Formats midmarks data into Telegram-friendly message
 */
export const formatMidmarksMessage = (data: Midmarks): string => {
  const { rollno, year_branch_section, subjects } = data;

  // Header section
  let msg =
    `Mid marks for <code>${rollno}</code>\n` +
    `<code>${year_branch_section}</code>\n`;

  msg += `\n`;
  msg += buildMidmarksTable(subjects);
  msg += `\n<i>Give the low ones some extra time.</i>`;

  return msg;
};

const buildMidmarksTable = (subjects: MidmarksBySubject[]): string => {
  let msg =
    `<pre>` +
    `SUBJECT      │ TYPE │ M1  M2  AVG\n` +
    `─────────────────────────────────\n`;

  for (const sub of subjects) {
    const subjectName = truncateText(sub.subject, 11);
    const type = truncateText(sub.type, 4);

    const m1 = sub.M1 ? String(sub.M1).padStart(2) : "  ";
    const m2 = sub.M2 ? String(sub.M2).padStart(2) : "  ";
    const avg = sub.average ? String(sub.average).padStart(3) : "   ";

    msg += `${subjectName.padEnd(11)} │ ${type.padEnd(4)} │ ${m1} ${m2} ${avg}\n`;
  }

  msg += `</pre>\n`;
  return msg;
};

/**
 * Formats bunk plan: per-subject skip/attend analysis against a 75% target
 * Math: to stay at >= TARGET after skipping X more classes (conducted grows):
 *   attended / (conducted + X) >= TARGET  →  X <= attended/TARGET - conducted
 * To recover by attending Y more classes:
 *   (attended + Y) / (conducted + Y) >= TARGET  →  Y >= (TARGET*conducted - attended) / (1 - TARGET)
 */
export const formatBunkPlanMessage = (data: Attendance): string => {
  const { rollno, year_branch_section, percentage, totalClasses, subjects } =
    data;

  const bunk = (att: number, cond: number) => Math.floor(att / 0.75 - cond);
  const need = (att: number, cond: number) =>
    Math.ceil((0.75 * cond - att) / 0.25);

  const overallBunk = Math.max(
    0,
    bunk(totalClasses.attended, totalClasses.conducted),
  );
  const overallNeed = Math.max(
    0,
    need(totalClasses.attended, totalClasses.conducted),
  );

  let msg =
    `Bunk plan for <code>${rollno}</code>\n` +
    `<code>${year_branch_section}</code> · <b>${percentage.toFixed(2)}%</b> ` +
    `(${totalClasses.attended}/${totalClasses.conducted})\n\n`;

  msg += buildBunkHeadline(overallBunk, overallNeed);
  msg += buildBunkTable(subjects, bunk, need);

  const risky = subjects.filter(
    (s) => s.conducted > 0 && (s.attended / s.conducted) * 100 < 75,
  );
  if (risky.length > 0) {
    msg +=
      `Below 75% in ${risky.length} subject${risky.length !== 1 ? "s" : ""}:\n` +
      risky
        .map((s) => `<code>${truncateText(s.subject, 12)}</code>`)
        .join(", ") +
      `\n\n`;
  }

  msg += `<i>Bunk means skips you can afford, need means classes to attend in a row.</i>`;

  return msg;
};

const buildBunkHeadline = (
  overallBunk: number,
  overallNeed: number,
): string => {
  if (overallBunk > 0) {
    return `You can bunk ${overallBunk} more and stay above 75%.\n\n`;
  }
  if (overallNeed > 0) {
    return `Go to the next ${overallNeed} in a row to get back to 75%.\n\n`;
  }
  return `You're right at 75%. Go to everything.\n\n`;
};

const buildBunkTable = (
  subjects: AttendanceBySubject[],
  bunk: (att: number, cond: number) => number,
  need: (att: number, cond: number) => number,
): string => {
  let msg = `<pre>`;
  msg += `SUBJ     │ NOW │ BUNK │ NEED\n`;
  msg += `──────────────────────────────\n`;

  for (const sub of subjects) {
    const name = truncateText(sub.subject, 8).padEnd(8);
    const nowPct =
      sub.conducted > 0
        ? ((sub.attended / sub.conducted) * 100).toFixed(0).padStart(3)
        : "  0";
    const canBunk =
      sub.conducted > 0 ? Math.max(0, bunk(sub.attended, sub.conducted)) : 0;
    const mustAttend =
      sub.conducted > 0 ? Math.max(0, need(sub.attended, sub.conducted)) : 0;

    msg += `${name} │ ${nowPct}% │${String(canBunk).padStart(5)} │${String(mustAttend).padStart(5)}\n`;
  }
  msg += `──────────────────────────────</pre>\n\n`;
  return msg;
};

/**
 * Builds a visual progress bar for percentage
 */
const buildProgressBar = (percentage: number): string => {
  const blocks = {
    green: "🟩",
    yellow: "🟨",
    red: "🟥",
    white: "⬜",
  };

  const filledBlocks = Math.floor(percentage / 10);
  const emptyBlocks = 10 - filledBlocks;

  let blockColor: keyof typeof blocks;
  if (percentage >= 75) {
    blockColor = "green";
  } else if (percentage >= 50) {
    blockColor = "yellow";
  } else {
    blockColor = "red";
  }

  return (
    blocks[blockColor].repeat(filledBlocks) +
    blocks.white.repeat(emptyBlocks) +
    "\n"
  );
};

const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  // trim first: "COMPUTER .." reads like a typo, "COMPUTER.." reads like a cut
  return text.substring(0, maxLength - 2).trimEnd() + "..";
};
