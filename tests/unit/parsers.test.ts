import { describe, it, expect, vi, beforeEach } from "vitest";

// Count cheerio.load calls. A section parse must load the document once,
// however many student rows it contains.
const loadCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("cheerio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("cheerio")>();
  return {
    ...actual,
    load: (...args: Parameters<typeof actual.load>) => {
      loadCalls.count++;
      return actual.load(...args);
    },
  };
});

vi.mock("../../src/services/redis/utils.js", () => ({
  getStudentCached: vi.fn(async (roll: string) => ({
    roll_no: roll.toUpperCase(),
    name: "Test Student",
    section: "A",
    branch: "5",
    year: "32",
  })),
  StudentNotFoundError: class StudentNotFoundError extends Error {},
}));

import {
  parseAttendanceResponse,
  parseAttendanceSection,
  parseMidmarksResponse,
  parseMidmarksSection,
} from "../../src/services/student.utils/parsers.js";
import { NoDataFoundError } from "../../src/services/student.utils/academicErrors.js";

const attendanceDoc = `
<html><body><table>
  <tr><td>Student</td><td>Report</td></tr>
  <tr>
    <td>Data Structures</td>
    <td>Operating Systems</td>
  </tr>
  <tr>
    <td>Last updated</td>
    <td>01-02-2026</td>
    <td>01-02-2026</td>
  </tr>
  <tr>
    <td>%AGE</td>
    <td>50</td>
    <td>45</td>
  </tr>
  <tr id="AAA00001">
    <td>AAA00001</td><td>Alice</td>
    <td>45</td><td>40</td>
    <td class="tdPercent">85.5 (450/526)</td>
  </tr>
  <tr id="AAA00002">
    <td>AAA00002</td><td>Bob</td>
    <td>30</td><td>20</td>
    <td class="tdPercent">62.5 (250/400)</td>
  </tr>
  <tr id="AAA00003">
    <td>AAA00003</td><td>Cara</td>
    <td>10</td><td>11</td>
    <td class="tdPercent">95.0 (105/110)</td>
  </tr>
</table></body></html>
`;

const midmarksDoc = `
<html><body><table>
  <tr><td>Student</td><td>Report</td></tr>
  <tr>
    <td><a>Data Structures</a></td>
    <td><a>Operating Systems</a></td>
    <td>DS Lab</td>
  </tr>
  <tr id="AAA00001">
    <td>AAA00001</td><td>Alice</td>
    <td>23/25(24)</td><td>22/24(23)</td><td>25</td>
  </tr>
  <tr id="AAA00002">
    <td>AAA00002</td><td>Bob</td>
    <td>10/12(11)</td><td>14/15(14)</td><td>20</td>
  </tr>
</table></body></html>
`;

const context = { yearSem: "32", branch: "5", section: "A" };

describe("parseAttendanceSection", () => {
  beforeEach(() => {
    loadCalls.count = 0;
  });

  it("parses every student row with one cheerio load", () => {
    const students = parseAttendanceSection(attendanceDoc, context);

    expect(loadCalls.count).toBe(1);
    expect(students.size).toBe(3);

    expect(students.get("AAA00001")).toMatchObject({
      rollno: "AAA00001",
      year_branch_section: "3_CSE_A",
      percentage: 85.5,
      totalClasses: { attended: 450, conducted: 526 },
    });
    expect(students.get("AAA00001")?.subjects).toHaveLength(2);
    expect(students.get("AAA00002")).toMatchObject({
      rollno: "AAA00002",
      percentage: 62.5,
      totalClasses: { attended: 250, conducted: 400 },
    });
    expect(students.get("AAA00002")?.subjects[1]).toMatchObject({
      subject: "Operating Systems",
      attended: 20,
      conducted: 45,
    });
  });

  it("skips a document with no student rows instead of throwing", () => {
    const students = parseAttendanceSection(
      "<html><body><table></table></body></html>",
      context,
    );
    expect(students.size).toBe(0);
  });

  it("keeps the single-student wrapper working", async () => {
    const attendance = await parseAttendanceResponse(attendanceDoc, "aaa00002");
    expect(attendance.rollno).toBe("AAA00002");
    expect(attendance.year_branch_section).toBe("3_CSE_A");
  });

  it("raises NoDataFound for a roll that is not in the report", async () => {
    await expect(
      parseAttendanceResponse(attendanceDoc, "AAA99999"),
    ).rejects.toThrow(NoDataFoundError);
  });
});

describe("parseMidmarksSection", () => {
  beforeEach(() => {
    loadCalls.count = 0;
  });

  it("parses every student row with one cheerio load", () => {
    const students = parseMidmarksSection(midmarksDoc, context);

    expect(loadCalls.count).toBe(1);
    expect(students.size).toBe(2);

    expect(students.get("AAA00001")).toMatchObject({
      rollno: "AAA00001",
      year_branch_section: "3_CSE_A",
    });
    expect(students.get("AAA00001")?.subjects).toHaveLength(3);
    expect(students.get("AAA00001")?.subjects[0]).toMatchObject({
      subject: "Data Structures",
      M1: 23,
      M2: 25,
      average: 24,
      type: "Subject",
    });
    expect(students.get("AAA00002")?.subjects[2]).toMatchObject({
      subject: "DS Lab",
      M1: 20,
      type: "Lab",
    });
  });

  it("keeps the single-student wrapper working", async () => {
    const midmarks = await parseMidmarksResponse(midmarksDoc, "AAA00001");
    expect(midmarks.rollno).toBe("AAA00001");
    expect(midmarks.subjects).toHaveLength(3);
  });

  it("raises NoDataFound for a roll that is not in the report", async () => {
    await expect(
      parseMidmarksResponse(midmarksDoc, "AAA99999"),
    ).rejects.toThrow(NoDataFoundError);
  });
});
