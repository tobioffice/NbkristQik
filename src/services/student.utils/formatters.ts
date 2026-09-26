import {
  AttendanceBySubject,
  Attendance,
  MidmarksBySubject,
  Midmarks,
} from "../../types/index.js";

/**
 * Formats attendance data into Telegram-friendly message with freshness indicator
 */
export const formatAttendanceMessage = (
  data: Attendance,
  isCached = false,
): string => {
  const { rollno, year_branch_section, percentage, totalClasses, subjects } =
    data;

  // Header section with freshness indicator
  let msg =
    `🧑‍🎓 <b>ROLL:</b> <code>${rollno}</code>\n` +
    `🏫 <b>Branch:</b> <code>${year_branch_section}</code>\n` +
    `📚 <b>Attended:</b> <code>${totalClasses.attended}/${totalClasses.conducted}</code>\n\n` +
    `📈 <b>Percentage:</b> <b>${percentage.toFixed(2)}%</b>\n`;

  // Add cache indicator if data is from cache
  if (isCached) {
    msg += `📦 <i>Cached data</i>\n`;
  }

  msg += buildProgressBar(percentage);
  msg += buildAttendanceTable(subjects);
  msg += `\n<i>💡 Tip: Maintain 75%+ for good attendance</i>`;

  return msg;
};

const buildAttendanceTable = (subjects: AttendanceBySubject[]): string => {
  let msg =
    `<pre>` +
    `SUBJ     │ ST │ATT/TOT│LAST\n` +
    `────────────────────────────\n`;

  for (const sub of subjects) {
    const subPercentage = (sub.attended / sub.conducted) * 100;
    const status = getStatusEmoji(subPercentage);
    const lastUpdated = formatLastUpdated(sub.lastUpdated);
    const subjectName = truncateText(sub.subject, 8);

    msg +=
      `${subjectName.padEnd(9)} │ ${status} │` +
      `${String(sub.attended).padStart(2)}/${String(sub.conducted).padStart(2)} │` +
      `${lastUpdated.padEnd(5)}\n`;
  }

  msg += `────────────────────────────</pre>\n`;
  return msg;
};

/**
 * Formats midmarks data into Telegram-friendly message
 */
export const formatMidmarksMessage = (
  data: Midmarks,
  isCached = false,
): string => {
  const { rollno, year_branch_section, subjects } = data;

  // Header section
  let msg =
    `<b>📊 Mid Marks Report</b>\n\n` +
    `🧑‍🎓 <b>ID:</b> <code>${rollno}</code>\n` +
    `🏫 <b>Branch:</b> <code>${year_branch_section}</code>\n`;

  // Add cache indicator
  if (isCached) {
    msg += `📦 <i>Cached data</i>\n`;
  }

  msg += `\n`;
  msg += buildMidmarksTable(subjects);
  msg += `\n<i>💡 Tip: Focus on subjects with low averages</i>`;

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
    `🎯 <b>Bunk Plan for</b> <code>${rollno}</code>\n` +
    `🏫 <b>Branch:</b> <code>${year_branch_section}</code>\n` +
    `📈 <b>Current:</b> <b>${percentage.toFixed(2)}%</b> ` +
    `(${totalClasses.attended}/${totalClasses.conducted})\n\n`;

  msg += buildBunkHeadline(overallBunk, overallNeed);
  msg += buildBunkTable(subjects, bunk, need);

  const risky = subjects.filter(
    (s) => s.conducted > 0 && (s.attended / s.conducted) * 100 < 75,
  );
  if (risky.length > 0) {
    msg +=
      `⚠️ <b>Below 75% in ${risky.length} subject${risky.length !== 1 ? "s" : ""}:</b> ` +
      risky
        .map((s) => `<code>${truncateText(s.subject, 12)}</code>`)
        .join(", ") +
      `\n\n`;
  }

  msg += `<i>💡 BUNK = classes you can skip, NEED = classes to attend consecutively to reach 75%</i>`;

  return msg;
};

const buildBunkHeadline = (
  overallBunk: number,
  overallNeed: number,
): string => {
  if (overallBunk > 0) {
    return `🟢 <b>You can bunk ${overallBunk} more class${overallBunk !== 1 ? "es" : ""}</b> and stay at 75%+\n\n`;
  }
  if (overallNeed > 0) {
    return `🔴 <b>Attend next ${overallNeed} class${overallNeed !== 1 ? "es" : ""}</b> to get back to 75%+\n\n`;
  }
  return `🟢 You're exactly at the limit. Attend everything.\n\n`;
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

const getStatusEmoji = (percentage: number): string => {
  if (percentage >= 75) return "🟢";
  if (percentage >= 50) return "🟡";
  return "🔴";
};

const formatLastUpdated = (dateStr: string): string => {
  const trimmed = dateStr.trim();

  // If it's a date in DD-MM-YYYY format, show only DD-MM
  if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
    return trimmed.slice(0, 5);
  }

  return trimmed || "N/A";
};

const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 2) + "..";
};
