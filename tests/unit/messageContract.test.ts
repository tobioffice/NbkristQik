import { describe, expect, it } from "vitest";
import {
  formatAttendanceMessage,
  formatBunkPlanMessage,
  formatMidmarksMessage,
} from "../../src/services/student.utils/formatters.js";
import type { Attendance, Midmarks } from "../../src/types/index.js";

/**
 * The contract of the chat replies.
 *
 * These tests are written against what a student is owed, not against what
 * the formatter happens to print. Every subject the portal returned has to
 * appear with its numbers, a percentage has to be explainable, and a warning
 * has to name what it warns about. A formatter that loses a whole section
 * fails here.
 *
 * This file exists because of a real regression: the attendance table was
 * deleted, and the tests of the day were rewritten in the same change to
 * expect its absence. A snapshot cannot catch that. A test that derives its
 * expectations from the input data can.
 */

/** The rows of the first table, without its header and its rules. */
const tableRows = (message: string): string[] => {
  const table = /<pre>([\s\S]*?)<\/pre>/.exec(message);
  if (!table) return [];
  return table[1]
    .split("\n")
    .filter((line) => line.trim() !== "")
    .filter((line) => !line.includes("─"))
    .filter((line) => !line.startsWith("SUBJ"));
};

/** How many classes can be skipped, by trying: the definition, not the formula. */
const skipsAffordable = (attended: number, conducted: number): number => {
  let skips = 0;
  while (attended / (conducted + skips + 1) >= 0.75) skips += 1;
  return skips;
};

/** Classes to attend in a row to get back to 75%, by trying. */
const classesNeeded = (attended: number, conducted: number): number => {
  let needed = 0;
  while ((attended + needed) / (conducted + needed) < 0.75) needed += 1;
  return needed;
};

const semester: Attendance = {
  rollno: "23KB1A1229",
  year_branch_section: "4_IT_-",
  percentage: 82.22,
  totalClasses: { attended: 148, conducted: 180 },
  subjects: [
    {
      subject: "COMPUTER NETWORKS",
      attended: 28,
      conducted: 32,
      lastUpdated: "12-10-2025",
    },
    {
      subject: "DATABASE MANAGEMENT SYSTEMS",
      attended: 22,
      conducted: 30,
      lastUpdated: "12-10-2025",
    },
    {
      subject: "COMPILER DESIGN",
      attended: 18,
      conducted: 26,
      lastUpdated: "10-10-2025",
    },
  ],
};

describe("attendance: the card and the half that explains it", () => {
  const message = formatAttendanceMessage(semester);

  it("opens the way the mid marks and bunk replies open", () => {
    expect(message).toContain("Attendance for <code>23KB1A1229</code>");
    expect(message).toContain("· 4 IT");
    expect(message).not.toContain("4_IT_-");
    expect(message).toContain("<b>82.22%</b> · 148/180");
  });

  it("prints a row for every subject the portal returned", () => {
    expect(tableRows(message)).toHaveLength(semester.subjects.length);

    for (const subject of semester.subjects) {
      expect(message).toContain(`${subject.attended}/${subject.conducted}`);
    }
  });

  it("shows when the portal last saw each subject", () => {
    expect(message).toContain("12-10");
    expect(message).toContain("10-10");
  });

  it("cannot hide a weak subject behind a strong average", () => {
    // 82% overall, but COMPILER DESIGN is 69%: it has to be named
    expect(message).toContain("Below 75% in 2 subjects");
    expect(message).toContain("COMPILER DESIGN");
    expect(message).toContain("DATABASE MANAGEMENT SYSTEMS");
  });

  it("carries the target, said in college days, not raw classes", () => {
    // 17 classes of room is two whole days at six classes a day
    expect(message).toContain("You can bunk 2 days.");
    expect(message).not.toContain("Stay above 75% and you're safe.");
  });

  it("leaves the table out only when there is nothing to put in it", () => {
    expect(
      formatAttendanceMessage({ ...semester, subjects: [] }),
    ).not.toContain("<pre>");
  });

  it("shows a dash, never a NaN, for a subject with no classes yet", () => {
    const message = formatAttendanceMessage({
      ...semester,
      subjects: [{ subject: "OS", attended: 0, conducted: 0, lastUpdated: "" }],
    });

    expect(message).not.toContain("NaN");
    expect(message).toContain("—");
    expect(message).toContain("N/A");
  });

  it("fits one Telegram message even for a whole semester", () => {
    const full: Attendance = {
      ...semester,
      subjects: Array.from({ length: 20 }, (_, i) => ({
        subject: `SUBJECT NUMBER ${i}`,
        attended: 20,
        conducted: 25,
        lastUpdated: "12-10-2025",
      })),
    };

    expect(formatAttendanceMessage(full).length).toBeLessThan(4096);
  });

  it("does not let a course name break the reply", () => {
    const message = formatAttendanceMessage({
      ...semester,
      subjects: [
        {
          subject: "DATA & ALGO <LAB>",
          attended: 10,
          conducted: 10,
          lastUpdated: "",
        },
      ],
    });

    // Telegram parses HTML: the name's markup characters must arrive escaped
    expect(message).toContain("DATA &amp; AL");
    expect(message).not.toContain("<LAB>");
  });
});

describe("midmarks: every subject, every column", () => {
  const marks: Midmarks = {
    rollno: "23KB1A1229",
    year_branch_section: "4_IT_-",
    subjects: [
      {
        subject: "COMPUTER NETWORKS",
        type: "Theory",
        M1: 18,
        M2: 21,
        average: 19.5,
      },
      { subject: "DBMS", type: "Theory", M1: 14, M2: null, average: null },
      { subject: "CN LAB", type: "Lab", M1: null, M2: null, average: null },
    ],
  };

  const message = formatMidmarksMessage(marks);

  it("prints a row for every subject", () => {
    expect(tableRows(message)).toHaveLength(marks.subjects.length);
  });

  it("keeps the marks it has and never prints null or NaN", () => {
    expect(message).toContain("18");
    expect(message).toContain("21");
    expect(message).toContain("19.5");
    expect(message).not.toContain("null");
    expect(message).not.toContain("NaN");
  });

  it("closes with the nudge", () => {
    expect(message).toContain("Give the low ones some extra time.");
  });
});

describe("bunk: the headline has to agree with the numbers", () => {
  const message = formatBunkPlanMessage(semester);

  it("says how many skips the numbers actually allow", () => {
    const allowed = skipsAffordable(148, 180);
    expect(message).toContain(`You can bunk ${allowed} more`);
  });

  it("prints a row for every subject", () => {
    expect(tableRows(message)).toHaveLength(semester.subjects.length);
  });

  it("names the subjects below 75", () => {
    expect(message).toContain("Below 75% in 2 subjects");
    expect(message).toContain("COMPILER");
    expect(message).toContain("DATABASE");
  });

  it("says how many days in a row get a student back to 75", () => {
    const behind: Attendance = {
      ...semester,
      percentage: 50,
      totalClasses: { attended: 10, conducted: 20 },
    };
    const needed = classesNeeded(10, 20);
    // six classes to a day, and a partial day still counts as a day
    const days = Math.ceil(needed / 6);

    expect(formatBunkPlanMessage(behind)).toContain(`Go ${days} days straight`);
  });

  it("tells a student exactly at 75 to go to everything", () => {
    const onTheLine: Attendance = {
      ...semester,
      percentage: 75,
      totalClasses: { attended: 15, conducted: 20 },
    };

    expect(formatBunkPlanMessage(onTheLine)).toContain(
      "You're right at 75%. Go to everything.",
    );
  });

  it("explains its own two words and the day it counts in", () => {
    expect(message).toContain(
      "Bunk means classes you can skip, need means classes in a row. Six classes make a day.",
    );
  });

  it("never prints a NaN for a subject with no classes yet", () => {
    const message = formatBunkPlanMessage({
      ...semester,
      subjects: [{ subject: "OS", attended: 0, conducted: 0, lastUpdated: "" }],
    });

    expect(message).not.toContain("NaN");
  });
});
