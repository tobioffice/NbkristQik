import {
  AttendanceBySubject,
  Attendance,
  MidmarksBySubject,
  Midmarks,
} from "../../types/index.js";
import { InputFile, type InputRichMessage } from "node-telegram-bot-api";
import { escapeHtml } from "../text.js";
import { renderAttendanceBarPng } from "../attendanceBar.js";
import type { WidgetCard, WidgetState } from "./widget.js";

/**
 * The replies a student gets about their own numbers.
 *
 * The text card builds its tables with `preTable`; the rich card uses the same
 * rows in a real Telegram table via `richTable`. A new column is one row of a
 * declaration either way, not a new set of padStart calls.
 */

/** The pass mark the college enforces, and the one every warning compares to. */
const TARGET_PERCENT = 75;

/**
 * The college day: six periods. The card counts days, not raw classes,
 * because "go to the next 340 in a row" is a number nobody can picture.
 */
const CLASSES_PER_DAY = 6;

/**
 * Classes that can be skipped and still land on the target.
 *
 * Math: to stay at or above TARGET after skipping X more classes (conducted
 * grows):  attended / (conducted + X) >= TARGET  ->  X <= attended/TARGET - conducted
 */
const skipsAffordable = (attended: number, conducted: number): number =>
  Math.max(0, Math.floor(attended / (TARGET_PERCENT / 100) - conducted));

/**
 * Classes to attend in a row to get back to the target.
 *
 * (attended + Y) / (conducted + Y) >= TARGET  ->  Y >= (TARGET*conducted - attended) / (1 - TARGET)
 */
const classesNeeded = (attended: number, conducted: number): number =>
  Math.max(
    0,
    Math.ceil(
      ((TARGET_PERCENT / 100) * conducted - attended) /
        (1 - TARGET_PERCENT / 100),
    ),
  );

/** "1 day" / "3 days". */
const dayWord = (days: number): string => `${days} day${days === 1 ? "" : "s"}`;

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

/**
 * A real table for a rich message. The cells must already be escaped HTML;
 * a subject name is escaped when its row is built, not here, because some
 * cells carry deliberate inline tags.
 */
const richTable = (
  headers: { label: string; align: "left" | "right" }[],
  rows: string[][],
): string => {
  const head = headers
    .map((column) => `<th align="${column.align}">${column.label}</th>`)
    .join("");
  const body = rows
    .map(
      (cells) =>
        `<tr>${cells
          .map(
            (cell, index) => `<td align="${headers[index].align}">${cell}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  return `<table bordered striped compact><tr>${head}</tr>${body}</table>`;
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

/** The same warning as plain text, for the widget state. */
const belowTargetPlain = (subjects: AttendanceBySubject[]): string => {
  const risky = subjectsBelowTarget(subjects);
  if (risky.length === 0) return "";
  const names = risky.map((subject) => subject.subject).join(", ");
  return (
    `Below ${TARGET_PERCENT}% in ${risky.length} subject` +
    `${risky.length === 1 ? "" : "s"}: ${names}`
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
 * Ten dots: filled for the rounded percentage, empty for the rest. The exact
 * figure is on the line above, and the warning below names every subject
 * under the 75% line, so the bar is only a glance.
 */
const buildProgressBar = (percentage: number): string => {
  const filled = Math.max(0, Math.min(10, Math.round(percentage / 10)));
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)}`;
};

/**
 * Formats attendance data into a Telegram-friendly message with a freshness
 * indicator and a row per subject.
 */
export const formatAttendanceMessage = (data: Attendance): string => {
  const { rollno, year_branch_section, percentage, totalClasses, subjects } =
    data;

  let msg =
    `🧑‍🎓 ROLL: <code>${escapeHtml(rollno)}</code>\n` +
    `🏫 Branch: ${escapeHtml(cleanBranch(year_branch_section))}\n` +
    `📚 Attended: ${totalClasses.attended}/${totalClasses.conducted}\n\n` +
    `📈 Percentage: ${percentage.toFixed(2)}%\n\n` +
    buildProgressBar(percentage);

  if (subjects.length === 0) return msg.trimEnd();

  msg += `\n\n${buildAttendanceTable(subjects)}`;

  const warning = belowTargetLine(subjects, (subject) => subject.subject);
  if (warning) msg += `\n${warning}\n`;

  msg += `\n<i>Stay above ${TARGET_PERCENT}% and you're safe.</i>`;

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
    `\n\n<i>Give the low ones some extra time.</i>`
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

  msg += `<i>Bunk means classes you can skip, need means classes in a row. Six classes make a day.</i>`;

  return msg;
};

const buildBunkHeadline = (bunk: number, need: number): string => {
  if (bunk > 0) {
    return `You can bunk ${bunk} more and stay above ${TARGET_PERCENT}%.\n\n`;
  }
  if (need > 0) {
    // days, not classes: the recovery number is large and a day is graspable
    return `Go ${dayWord(Math.ceil(need / CLASSES_PER_DAY))} straight to get back to ${TARGET_PERCENT}%.\n\n`;
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

const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  // trim first: "COMPUTER .." reads like a typo, "COMPUTER.." reads like a cut
  return text.substring(0, maxLength - 2).trimEnd() + "..";
};

/**
 * The attendance card as a rich message: the same figures, with a real table
 * instead of a monospaced block. `text` stays alongside it as the fallback for
 * a client that does not render rich messages yet.
 */
export const formatAttendanceRich = (data: Attendance): InputRichMessage => {
  const { rollno, year_branch_section, percentage, totalClasses, subjects } =
    data;

  const barPng = renderAttendanceBarPng({
    percentage,
    target: TARGET_PERCENT,
  });
  const bar =
    `<img src="tg://photo?id=attendance-bar" ` +
    `alt="Attendance ${percentage.toFixed(2)}%"/>`;
  const media: InputRichMessage["media"] = [
    {
      id: "attendance-bar",
      media: {
        type: "photo",
        media: new InputFile(barPng, {
          filename: "attendance-bar.png",
          contentType: "image/png",
        }),
      },
    },
  ];

  const blocks = [
    `<p>🧑‍🎓 ROLL: <code>${escapeHtml(rollno)}</code></p>`,
    `<p>🏫 Branch: ${escapeHtml(cleanBranch(year_branch_section))}</p>`,
    `<p>📚 Attended: ${totalClasses.attended}/${totalClasses.conducted}</p>`,
    `<p>📈 Percentage: <b>${percentage.toFixed(2)}%</b></p>`,
    bar,
  ];

  if (subjects.length === 0) return { html: blocks.join("\n"), media };

  blocks.push(
    richTable(
      [
        { label: "Subject", align: "left" },
        { label: "Att/Tot", align: "right" },
        { label: "Now", align: "right" },
        { label: "Last", align: "left" },
      ],
      subjects.map((subject) => {
        const percent = percentOf(subject);
        return [
          escapeHtml(subject.subject),
          `${subject.attended}/${subject.conducted}`,
          percent === null ? "—" : `${Math.round(percent)}%`,
          escapeHtml(formatLastUpdated(subject.lastUpdated)),
        ];
      }),
    ),
  );

  const warning = belowTargetLine(subjects, (subject) => subject.subject);
  if (warning) blocks.push(`<p>${warning}</p>`);
  blocks.push(
    `<footer>Stay above ${TARGET_PERCENT}% and you're safe.</footer>`,
  );

  return { html: blocks.join("\n"), media };
};

/** The mid-marks card as a rich message, one column per paper. */
export const formatMidmarksRich = (data: Midmarks): string => {
  const { rollno, year_branch_section, subjects } = data;

  return [
    `<p><b>Mid marks for <code>${escapeHtml(rollno)}</code></b> · ${escapeHtml(cleanBranch(year_branch_section))}</p>`,
    richTable(
      [
        { label: "Subject", align: "left" },
        { label: "Type", align: "left" },
        { label: "M1", align: "right" },
        { label: "M2", align: "right" },
        { label: "Avg", align: "right" },
      ],
      subjects.map((subject) => [
        escapeHtml(subject.subject),
        escapeHtml(subject.type),
        subject.M1 == null ? "—" : String(subject.M1),
        subject.M2 == null ? "—" : String(subject.M2),
        subject.average == null ? "—" : String(subject.average),
      ]),
    ),
    `<footer>Give the low ones some extra time.</footer>`,
  ].join("\n");
};

/** The bunk plan as a rich message, one row per subject. */
export const formatBunkPlanRich = (data: Attendance): string => {
  const { rollno, year_branch_section, percentage, totalClasses, subjects } =
    data;

  const blocks = [
    `<p><b>Bunk plan for <code>${escapeHtml(rollno)}</code></b> · ${escapeHtml(cleanBranch(year_branch_section))}</p>`,
    `<p><b>${percentage.toFixed(2)}%</b> · ${totalClasses.attended}/${totalClasses.conducted}</p>`,
    `<p>${buildBunkHeadline(
      skipsAffordable(totalClasses.attended, totalClasses.conducted),
      classesNeeded(totalClasses.attended, totalClasses.conducted),
    ).trim()}</p>`,
    richTable(
      [
        { label: "Subject", align: "left" },
        { label: "Now", align: "right" },
        { label: "Bunk", align: "right" },
        { label: "Need", align: "right" },
      ],
      subjects.map((subject) => {
        const percent = percentOf(subject);
        return [
          escapeHtml(subject.subject),
          percent === null ? "0%" : `${percent.toFixed(0)}%`,
          percent === null
            ? "0"
            : String(skipsAffordable(subject.attended, subject.conducted)),
          percent === null
            ? "0"
            : String(classesNeeded(subject.attended, subject.conducted)),
        ];
      }),
    ),
  ];

  const warning = belowTargetLine(subjects, (subject) => subject.subject);
  if (warning) blocks.push(`<p>${warning}</p>`);
  blocks.push(
    `<footer>Bunk means classes you can skip, need means classes in a row. Six classes make a day.</footer>`,
  );

  return blocks.join("\n");
};

/**
 * The attendance card as widget state. The widget code is fixed; this object
 * is the part that changes, so it stays small enough for Telegram's 1024-byte
 * chat state.
 */
export const formatAttendanceWidget = (
  data: Attendance,
  notice?: string,
): WidgetCard => {
  const { rollno, year_branch_section, percentage, totalClasses, subjects } =
    data;

  const rows = subjects.map((subject) => {
    const percent = percentOf(subject);
    return [
      subject.subject,
      `${subject.attended}/${subject.conducted}`,
      percent === null ? "—" : `${Math.round(percent)}%`,
      formatLastUpdated(subject.lastUpdated),
    ];
  });

  const warning = belowTargetPlain(subjects);
  const state: WidgetState = {
    v: 1,
    kind: "att",
    lines: [
      { label: "ROLL", value: rollno },
      { label: "Branch", value: cleanBranch(year_branch_section) },
      {
        label: "Attended",
        value: `${totalClasses.attended}/${totalClasses.conducted}`,
      },
      { label: "Percentage", value: `${percentage.toFixed(2)}%` },
    ],
    meter: { value: percentage, threshold: TARGET_PERCENT },
    ...(rows.length
      ? {
          table: {
            headers: ["Subject", "Att/Tot", "Now", "Last"],
            rows,
          },
        }
      : {}),
    ...(warning ? { warning } : {}),
    footer: `Stay above ${TARGET_PERCENT}% and you're safe.`,
    ...(notice ? { notice } : {}),
  };

  return {
    state,
    caption:
      `Attendance · ${rollno} · ${percentage.toFixed(2)}%` +
      (notice ? ` · ${notice}` : ""),
  };
};

/** The mid-marks card as widget state, one column per paper. */
export const formatMidmarksWidget = (
  data: Midmarks,
  notice?: string,
): WidgetCard => {
  const { rollno, year_branch_section, subjects } = data;

  const rows = subjects.map((subject) => [
    subject.subject,
    subject.type,
    subject.M1 == null ? "—" : String(subject.M1),
    subject.M2 == null ? "—" : String(subject.M2),
    subject.average == null ? "—" : String(subject.average),
  ]);

  const state: WidgetState = {
    v: 1,
    kind: "mid",
    lines: [
      { label: "ROLL", value: rollno },
      { label: "Branch", value: cleanBranch(year_branch_section) },
    ],
    ...(rows.length
      ? {
          table: {
            headers: ["Subject", "Type", "M1", "M2", "Avg"],
            rows,
          },
        }
      : {}),
    footer: "Give the low ones some extra time.",
    ...(notice ? { notice } : {}),
  };

  return {
    state,
    caption:
      `Mid marks · ${rollno} · ${cleanBranch(year_branch_section)}` +
      (notice ? ` · ${notice}` : ""),
  };
};

/** The bunk plan as widget state, with the same forecast as the text card. */
export const formatBunkWidget = (
  data: Attendance,
  notice?: string,
): WidgetCard => {
  const { rollno, year_branch_section, percentage, totalClasses, subjects } =
    data;

  const rows = subjects.map((subject) => {
    const percent = percentOf(subject);
    return [
      subject.subject,
      percent === null ? "0%" : `${percent.toFixed(0)}%`,
      percent === null
        ? "0"
        : String(skipsAffordable(subject.attended, subject.conducted)),
      percent === null
        ? "0"
        : String(classesNeeded(subject.attended, subject.conducted)),
    ];
  });

  const warning = belowTargetPlain(subjects);
  const state: WidgetState = {
    v: 1,
    kind: "bunk",
    lines: [
      { label: "ROLL", value: rollno },
      { label: "Branch", value: cleanBranch(year_branch_section) },
      {
        label: "Attended",
        value: `${totalClasses.attended}/${totalClasses.conducted}`,
      },
      { label: "Percentage", value: `${percentage.toFixed(2)}%` },
    ],
    meter: { value: percentage, threshold: TARGET_PERCENT },
    headline: buildBunkHeadline(
      skipsAffordable(totalClasses.attended, totalClasses.conducted),
      classesNeeded(totalClasses.attended, totalClasses.conducted),
    ).trim(),
    ...(rows.length
      ? {
          table: {
            headers: ["Subject", "Now", "Bunk", "Need"],
            rows,
          },
        }
      : {}),
    ...(warning ? { warning } : {}),
    footer:
      "Bunk means classes you can skip, need means classes in a row. Six classes make a day.",
    ...(notice ? { notice } : {}),
  };

  return {
    state,
    caption:
      `Bunk plan · ${rollno} · ${percentage.toFixed(2)}%` +
      (notice ? ` · ${notice}` : ""),
  };
};
