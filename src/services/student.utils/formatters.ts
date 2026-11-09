import {
  AttendanceBySubject,
  Attendance,
  MidmarksBySubject,
  Midmarks,
} from "../../types/index.js";
import { escapeHtml } from "../text.js";

/**
 * The replies a student gets about their own numbers.
 *
 * Every table here is built by `preTable`, so the three of them line up the
 * same way on a phone and a new column is one row of a declaration rather
 * than a new set of padStart calls.
 */

/** The pass mark the college enforces, and the one every warning compares to. */
const TARGET_PERCENT = 75;

interface Column {
  header: string;
  width: number;
  align?: "left" | "right";
}

/** A monospaced table, as Telegram draws it inside <pre>. */
const preTable = (columns: Column[], rows: string[][]): string => {
  const pad = (cell: string, column: Column): string =>
    column.align === "right"
      ? cell.padStart(column.width)
      : cell.padEnd(column.width);

  const width =
    columns.reduce((sum, column) => sum + column.width, 0) +
    3 * (columns.length - 1);
  const rule = "─".repeat(width);
  // width is measured on the raw text and escaping happens after padding, so
  // a subject like "OS & DBMS" cannot shift the columns once Telegram renders
  // the entity as one character.
  const lines = rows.map((cells) =>
    cells.map((cell, i) => escapeHtml(pad(cell, columns[i]))).join(" │ "),
  );

  return [
    `<pre>`,
    columns.map((column) => pad(column.header, column)).join(" │ "),
    rule,
    ...lines,
    rule,
    `</pre>`,
  ].join("\n");
};

/** A subject's own percentage, or null before the portal has marked anything. */
const percentOf = (subject: AttendanceBySubject): number | null =>
  subject.conducted > 0 ? (subject.attended / subject.conducted) * 100 : null;

/** The subjects that sit below the pass mark. */
const subjectsBelowTarget = (subjects: AttendanceBySubject[]) =>
  subjects.filter((subject) => {
    const percentage = percentOf(subject);
    return percentage !== null && percentage < TARGET_PERCENT;
  });

/** "Below 75% in 2 subjects: <code>A</code>, <code>B</code>" or nothing. */
const belowTargetLine = (
  subjects: AttendanceBySubject[],
  name: (subject: AttendanceBySubject) => string,
): string => {
  const risky = subjectsBelowTarget(subjects);
  if (risky.length === 0) return "";

  const names = risky.map(
    (subject) => `<code>${escapeHtml(name(subject))}</code>`,
  );
  return (
    `Below ${TARGET_PERCENT}% in ${risky.length} subject` +
    `${risky.length === 1 ? "" : "s"}: ${names.join(", ")}`
  );
};

/**
 * The portal's own branch string reads "2_ECE_D"; a room reads "2 ECE D".
 * The separators are underscores and the section can end bare, so this only
 * swaps the separators, squeezes the spaces and drops a dangling dash.
 */
const cleanBranch = (raw: string): string =>
  raw
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s-]+|[\s-]+$/g, "")
    .trim();

/**
 * The 75% line said in classes, so the percentage has something to be
 * measured against.
 *
 * The target is the attended count that sits on the line at today's
 * denominator: ceil(75% of conducted, minus a hair so an exact hit does not
 * round up into the next class). The gap is that count against what the
 * student has; the Bunk button carries the real recover-or-skip arithmetic.
 */
const targetLine = (attended: number, conducted: number): string | null => {
  if (conducted <= 0) return null;

  const target = Math.ceil((TARGET_PERCENT / 100) * conducted - 1e-9);
  const gap = attended - target;

  if (gap > 0) return `🎯 75% needs ${target} · you're ${gap} ahead.`;
  if (gap < 0) return `🎯 75% needs ${target} · you're ${-gap} short.`;
  return `🎯 75% needs ${target} · you're right on it.`;
};

/**
 * Formats attendance data into a Telegram-friendly message with a freshness
 * indicator and a row per subject.
 */
export const formatAttendanceMessage = (data: Attendance): string => {
  const { rollno, year_branch_section, percentage, totalClasses, subjects } =
    data;

  let msg =
    `🧑‍🎓 <code>${escapeHtml(rollno)}</code> · ${escapeHtml(cleanBranch(year_branch_section))}\n\n` +
    `📊 ${percentage.toFixed(2)}% · ${totalClasses.attended}/${totalClasses.conducted}\n` +
    buildProgressBar(percentage) +
    (targetLine(totalClasses.attended, totalClasses.conducted) ?? "");

  if (subjects.length === 0) return msg.trimEnd();

  msg += `\n\n${buildAttendanceTable(subjects)}`;

  const warning = belowTargetLine(subjects, (subject) => subject.subject);
  if (warning) msg += `\n${warning}`;

  return msg.trimEnd();
};

/**
 * The other half of the attendance reply: what the percentage is made of.
 *
 * The card alone cannot tell a student whether the 82% is safe across the
 * board or carried by two subjects, so every subject gets a row with its
 * own attended/conducted, its percentage, and when the portal last saw it.
 */
const buildAttendanceTable = (subjects: AttendanceBySubject[]): string =>
  preTable(
    [
      { header: "SUBJ", width: 11 },
      { header: "ATT/TOT", width: 7, align: "right" },
      { header: "NOW", width: 4, align: "right" },
      { header: "LAST", width: 5 },
    ],
    subjects.map((subject) => {
      const percentage = percentOf(subject);
      return [
        truncateText(subject.subject, 11),
        `${subject.attended}/${subject.conducted}`,
        percentage === null ? "—" : `${Math.round(percentage)}%`,
        formatLastUpdated(subject.lastUpdated),
      ];
    }),
  );

const formatLastUpdated = (value: string): string => {
  const trimmed = value.trim();

  // the portal sends DD-MM-YYYY, often with a "(2 days ago)" tail that the
  // parser already cut. Keep a short year: without it, "05-11" is ambiguous
  // between semesters and a stale figure can look current.
  if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
    return trimmed.slice(0, 8); // DD-MM-YY
  }

  return trimmed || "N/A";
};

/** Formats midmarks data into a Telegram-friendly message. */
export const formatMidmarksMessage = (data: Midmarks): string => {
  const { rollno, year_branch_section, subjects } = data;

  return (
    `Mid marks for <code>${escapeHtml(rollno)}</code> · ${escapeHtml(cleanBranch(year_branch_section))}\n\n` +
    buildMidmarksTable(subjects) +
    `\n<i>Give the low ones some extra time.</i>`
  );
};

const buildMidmarksTable = (subjects: MidmarksBySubject[]): string =>
  preTable(
    [
      { header: "SUBJECT", width: 11 },
      { header: "TYPE", width: 4 },
      { header: "M1  M2  AVG", width: 10, align: "right" },
    ],
    subjects.map((subject) => [
      truncateText(subject.subject, 11),
      truncateText(subject.type, 4),
      [
        subject.M1 ? String(subject.M1).padStart(2) : "  ",
        subject.M2 ? String(subject.M2).padStart(2) : "  ",
        subject.average ? String(subject.average).padStart(3) : "   ",
      ].join(" "),
    ]),
  );

/**
 * Formats the bunk plan: per-subject skip/attend analysis against the pass
 * mark.
 *
 * Math: to stay at or above TARGET after skipping X more classes (conducted
 * grows):  attended / (conducted + X) >= TARGET  →  X <= attended/TARGET - conducted
 * To recover by attending Y more classes:
 *   (attended + Y) / (conducted + Y) >= TARGET  →  Y >= (TARGET*conducted - attended) / (1 - TARGET)
 */
export const formatBunkPlanMessage = (data: Attendance): string => {
  const { rollno, year_branch_section, percentage, totalClasses, subjects } =
    data;

  const target = TARGET_PERCENT / 100;
  const skipsAffordable = (att: number, cond: number) =>
    Math.max(0, Math.floor(att / target - cond));
  const classesNeeded = (att: number, cond: number) =>
    Math.max(0, Math.ceil((target * cond - att) / (1 - target)));

  let msg =
    `Bunk plan for <code>${escapeHtml(rollno)}</code> · ${escapeHtml(cleanBranch(year_branch_section))}\n` +
    `<b>${percentage.toFixed(2)}%</b> · ${totalClasses.attended}/${totalClasses.conducted}\n\n`;

  msg += buildBunkHeadline(
    skipsAffordable(totalClasses.attended, totalClasses.conducted),
    classesNeeded(totalClasses.attended, totalClasses.conducted),
  );
  msg += buildBunkTable(subjects, skipsAffordable, classesNeeded);

  const warning = belowTargetLine(subjects, (subject) =>
    truncateText(subject.subject, 12),
  );
  if (warning) msg += `${warning}\n\n`;

  msg += `<i>Bunk means skips you can afford, need means classes to attend in a row.</i>`;

  return msg;
};

const buildBunkHeadline = (bunk: number, need: number): string => {
  if (bunk > 0) {
    return `You can bunk ${bunk} more and stay above ${TARGET_PERCENT}%.\n\n`;
  }
  if (need > 0) {
    return `Go to the next ${need} in a row to get back to ${TARGET_PERCENT}%.\n\n`;
  }
  return `You're right at ${TARGET_PERCENT}%. Go to everything.\n\n`;
};

const buildBunkTable = (
  subjects: AttendanceBySubject[],
  skipsAffordable: (att: number, cond: number) => number,
  classesNeeded: (att: number, cond: number) => number,
): string =>
  `${preTable(
    [
      { header: "SUBJ", width: 8 },
      { header: "NOW", width: 4, align: "right" },
      { header: "BUNK", width: 5, align: "right" },
      { header: "NEED", width: 5, align: "right" },
    ],
    subjects.map((subject) => {
      const percentage = percentOf(subject);
      return [
        truncateText(subject.subject, 8),
        percentage === null ? "0%" : `${percentage.toFixed(0)}%`,
        percentage === null
          ? "0"
          : String(skipsAffordable(subject.attended, subject.conducted)),
        percentage === null
          ? "0"
          : String(classesNeeded(subject.attended, subject.conducted)),
      ];
    }),
  )}\n\n`;

/** A visual bar for the attendance card. */
const buildProgressBar = (percentage: number): string => {
  const filled = Math.floor(percentage / 10);
  // green is safe, amber is close, red is already behind
  const block =
    percentage >= TARGET_PERCENT ? "🟩" : percentage >= 50 ? "🟨" : "🟥";

  return block.repeat(filled) + "⬜".repeat(10 - filled) + "\n";
};

const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  // trim first: "COMPUTER .." reads like a typo, "COMPUTER.." reads like a cut
  return text.substring(0, maxLength - 2).trimEnd() + "..";
};
