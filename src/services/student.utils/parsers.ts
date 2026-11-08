import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { BRANCHES } from "../../constants/index.js";
import {
  AttendanceBySubject,
  Attendance,
  MidmarksBySubject,
  Midmarks,
  Student,
} from "../../types/index.js";
import { getStudentCached } from "../redis/utils.js";
import { NoDataFoundError } from "./academicErrors.js";

/**
 * The known section of a report request: the same fields the portal POST
 * carries. Parsing a whole report needs no per-row student lookup because the
 * section is already known — that is the point of the section parsers.
 */
export interface SectionContext {
  /** e.g. "32" (3rd year, 2nd semester) */
  yearSem: string;
  /** portal branch id, e.g. "5" */
  branch: string;
  /** section letter, e.g. "A" */
  section: string;
}

/** `3_CSE_A` from a yearSem/branch/section context. */
const sectionLabel = (context: SectionContext): string =>
  `${String(context.yearSem).slice(0, 1)}_${BRANCHES[parseInt(context.branch)]}_${context.section}`;

/** Normalise a `tr[id]` roll number; reports print it uppercase already. */
const rowRoll = (id: string | undefined): string =>
  (id ?? "").trim().toUpperCase();

/**
 * Parses one attendance report page into every student row it contains.
 *
 * One `cheerio.load` and one pass over the report rows for the whole section.
 * The previous implementation reloaded and re-parsed the same document once
 * per roll number and looked up each student in Redis/DB; a 60-student
 * section paid 60 DOM parses for one page.
 *
 * A row that is missing or has no id is skipped, not fatal — the caller that
 * needs a specific student raises `NoDataFoundError`.
 */
export const parseAttendanceSection = (
  doc: string,
  context: SectionContext,
): Map<string, Attendance> => {
  const $ = cheerio.load(doc);
  const label = sectionLabel(context);

  const rows = $("tr");
  const names = rows
    .eq(1)
    .find("td")
    .map((_, el) => $(el).text())
    .get();
  const lastUpdated = rows
    .eq(2)
    .find("td")
    .map((_, el) => $(el).text())
    .get();
  const conducted = rows
    .eq(3)
    .find("td")
    .map((_, el) => $(el).text())
    .get();

  // Clean up arrays once for the whole section (the first cells are labels).
  lastUpdated.shift();
  conducted.shift();

  const students = new Map<string, Attendance>();

  $("tr[id]").each((_, element) => {
    const studentRow = $(element);
    const rollno = rowRoll(studentRow.attr("id"));
    if (!rollno) return;

    const percentageText = studentRow.find("td[class=tdPercent]").text();
    const totalClassesMatch = percentageText.match(/\(([^)]+)\)/);
    const totalClassesStr = totalClassesMatch
      ? totalClassesMatch[1].trim()
      : "0/0";

    const attended = studentRow
      .find("td")
      .map((_, el) => $(el).text())
      .get();
    attended.splice(0, 2);

    const subjects = buildSubjectList(names, attended, conducted, lastUpdated);

    const [attendedTotal, conductedTotal] = totalClassesStr
      .split("/")
      .map((s) => parseInt(s.trim()) || 0);

    students.set(rollno, {
      rollno,
      year_branch_section: label,
      percentage: parseFloat(percentageText.split("(")[0].trim()) || 0,
      totalClasses: {
        attended: attendedTotal,
        conducted: conductedTotal,
      },
      subjects,
    });
  });

  return students;
};

const buildSubjectList = (
  names: string[],
  attended: string[],
  conducted: string[],
  lastUpdated: string[],
): AttendanceBySubject[] => {
  const subjects: AttendanceBySubject[] = [];

  for (let i = 0; i < conducted.length; i++) {
    const conductedCount = parseInt(conducted[i]) || 0;

    // Skip subjects with no classes or percentage column
    if (conductedCount === 0 || names[i] === "%AGE") continue;

    subjects.push({
      subject: names[i] || "Unknown",
      attended: parseInt(attended[i]) || 0,
      conducted: conductedCount,
      lastUpdated: lastUpdated[i]?.split("(")[0]?.trim() || "N/A",
    });
  }

  return subjects;
};

/**
 * Parses one mid-marks report page into every student row it contains.
 * One `cheerio.load` for the section; no per-row student lookup.
 */
export const parseMidmarksSection = (
  doc: string,
  context: SectionContext,
): Map<string, Midmarks> => {
  const $ = cheerio.load(doc);
  const label = sectionLabel(context);

  const nameRow = $("tr").eq(1);
  const { subjects, labs } = separateSubjectsAndLabs($, nameRow);
  const allSubjects = [...subjects, ...labs];

  const students = new Map<string, Midmarks>();

  $("tr[id]").each((_, element) => {
    const studentRow = $(element);
    const rollno = rowRoll(studentRow.attr("id"));
    if (!rollno) return;

    const marksList = studentRow
      .find("td")
      .slice(2)
      .map((_, el) => $(el).text())
      .get();

    students.set(rollno, {
      rollno,
      year_branch_section: label,
      subjects: buildMidmarksList(allSubjects, marksList, subjects),
    });
  });

  return students;
};

/**
 * Parses attendance for one student.
 *
 * A thin wrapper over `parseAttendanceSection` kept for the requester path and
 * existing importers: it resolves the student's section, parses that section
 * once, and returns the requested row.
 */
export const parseAttendanceResponse = async (
  doc: string,
  rollnumber: string,
): Promise<Attendance> => {
  const student: Student = await getStudentCached(rollnumber);
  const students = parseAttendanceSection(doc, contextFor(student));

  const attendance =
    students.get(student.roll_no.toUpperCase()) ??
    students.get(rollnumber.toUpperCase());

  if (!attendance) {
    throw new NoDataFoundError("attendance");
  }

  return attendance;
};

/**
 * Parses mid-marks for one student — a thin wrapper over
 * `parseMidmarksSection` (see `parseAttendanceResponse`).
 */
export const parseMidmarksResponse = async (
  doc: string,
  rollnumber: string,
): Promise<Midmarks> => {
  const student: Student = await getStudentCached(rollnumber);
  const students = parseMidmarksSection(doc, contextFor(student));

  const midmarks =
    students.get(student.roll_no.toUpperCase()) ??
    students.get(rollnumber.toUpperCase());

  if (!midmarks) {
    throw new NoDataFoundError("midmarks");
  }

  return midmarks;
};

/** The section context a student's stored record describes. */
export const contextFor = (student: Student): SectionContext => ({
  yearSem: student.year,
  branch: student.branch,
  section: student.section,
});

const separateSubjectsAndLabs = (
  $: cheerio.CheerioAPI,
  nameRow: cheerio.Cheerio<Element>,
): { subjects: string[]; labs: string[] } => {
  const subjects: string[] = [];
  const labs: string[] = [];

  nameRow.find("td").each((_, element) => {
    const hasLink = $(element).find("a").length > 0;
    const text = hasLink
      ? $(element).find("a").text().trim()
      : $(element).text().trim();

    if (text) {
      (hasLink ? subjects : labs).push(text);
    }
  });

  return { subjects, labs };
};

const buildMidmarksList = (
  allSubjects: string[],
  marksList: string[],
  subjectsOnly: string[],
): MidmarksBySubject[] => {
  return allSubjects.map((subject, i) => {
    const isSubject = subjectsOnly.includes(subject);
    const marksStr = marksList[i] || "";

    if (isSubject) {
      const [part1, part2] = marksStr.split("/");
      const m2Match = part2?.match(/^(\d+)\((\d+)\)/);

      return {
        subject,
        M1: parseInt(part1) || 0,
        M2: m2Match ? parseInt(m2Match[1]) : 0,
        average: m2Match ? parseInt(m2Match[2]) : 0,
        type: "Subject",
      };
    }

    return {
      subject,
      M1: parseInt(marksStr) || 0,
      M2: 0,
      average: 0,
      type: "Lab",
    };
  });
};
