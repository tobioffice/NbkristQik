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
 * Parses attendance HTML response into structured data
 */
export const parseAttendanceResponse = async (
  doc: string,
  rollnumber: string,
): Promise<Attendance> => {
  const student = await getStudentCached(rollnumber);
  const { roll_no, branch, section, year } = student;

  const $ = cheerio.load(doc);
  const studentRow = $(`tr[id=${roll_no.toUpperCase()}]`);

  if (!studentRow.length) {
    throw new NoDataFoundError("attendance");
  }

  const percentageText = studentRow.find("td[class=tdPercent]").text();
  const totalClassesMatch = percentageText.match(/\(([^)]+)\)/);
  const totalClassesStr = totalClassesMatch
    ? totalClassesMatch[1].trim()
    : "0/0";

  const rows = $("tr");
  const nameRow = rows.eq(1);
  const lastUpdatedRow = rows.eq(2);
  const conductedRow = rows.eq(3);

  // Extract data from rows
  const names = nameRow
    .find("td")
    .map((_, el) => $(el).text())
    .get();
  const lastUpdated = lastUpdatedRow
    .find("td")
    .map((_, el) => $(el).text())
    .get();
  const attended = studentRow
    .find("td")
    .map((_, el) => $(el).text())
    .get();
  const conducted = conductedRow
    .find("td")
    .map((_, el) => $(el).text())
    .get();

  // Clean up arrays
  lastUpdated.shift();
  conducted.shift();
  attended.splice(0, 2);

  // Filter out empty subjects and format data
  const subjects = buildSubjectList(names, attended, conducted, lastUpdated);

  const [attendedTotal, conductedTotal] = totalClassesStr
    .split("/")
    .map((s) => parseInt(s.trim()) || 0);

  return {
    rollno: roll_no,
    year_branch_section: `${year.slice(0, 1)}_${BRANCHES[parseInt(branch)]}_${section}`,
    percentage: parseFloat(percentageText.split("(")[0].trim()) || 0,
    totalClasses: {
      attended: attendedTotal,
      conducted: conductedTotal,
    },
    subjects,
  };
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
 * Parses midmarks HTML response into structured data
 */
export const parseMidmarksResponse = async (
  doc: string,
  rollnumber: string,
): Promise<Midmarks> => {
  const student: Student = await getStudentCached(rollnumber);
  const { roll_no, year, section, branch } = student;

  const $ = cheerio.load(doc);
  const studentRow = $(`tr[id=${roll_no.toUpperCase()}]`);

  if (!studentRow.length) {
    throw new NoDataFoundError("midmarks");
  }

  const marksCells = studentRow.find("td").slice(2);
  const marksList = marksCells.map((_, el) => $(el).text()).get();

  const nameRow = $("tr").eq(1);
  const { subjects, labs } = separateSubjectsAndLabs($, nameRow);

  const midmarksList = buildMidmarksList(
    [...subjects, ...labs],
    marksList,
    subjects,
  );

  return {
    rollno: roll_no,
    year_branch_section: `${year.slice(0, 1)}_${BRANCHES[parseInt(branch)]}_${section}`,
    subjects: midmarksList,
  };
};

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
