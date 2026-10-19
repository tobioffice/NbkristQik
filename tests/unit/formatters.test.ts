import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  formatAttendanceMessage,
  formatBunkPlanMessage,
  formatMidmarksMessage,
} from "../../src/services/student.utils/formatters.js";
import type { Attendance, Midmarks } from "../../src/types/index.js";

const attendance: Attendance = {
  rollno: "23B91A05<1>",
  year_branch_section: "2-CSE-A & B",
  percentage: 82.5,
  totalClasses: { attended: 33, conducted: 40 },
  subjects: [
    {
      subject: "DSA <Lab>",
      attended: 8,
      conducted: 10,
      lastUpdated: "01-10-2026",
    },
  ],
};

const midmarks: Midmarks = {
  rollno: "23B91A05<1>",
  year_branch_section: "2-CSE-A & B",
  subjects: [
    { subject: "OS <Theory>", M1: 18, M2: 20, average: 19, type: "M1&M2" },
  ],
};

describe("escapeHtml", () => {
  it("escapes ampersands before angle brackets", () => {
    expect(escapeHtml("<b>A & B</b>")).toBe("&lt;b&gt;A &amp; B&lt;/b&gt;");
  });
});

describe("formatters", () => {
  it("escapes portal text in the attendance report", () => {
    const msg = formatAttendanceMessage(attendance);
    expect(msg).toContain("23B91A05&lt;1&gt;");
    expect(msg).toContain("2-CSE-A &amp; B");
    expect(msg).toContain("DSA &lt;L..");
    expect(msg).not.toContain("<Lab>");
  });

  it("escapes portal text in the mid-marks report", () => {
    const msg = formatMidmarksMessage(midmarks);
    expect(msg).toContain("23B91A05&lt;1&gt;");
    expect(msg).toContain("OS &lt;The");
    expect(msg).not.toContain("<Theory>");
  });

  it("escapes portal text in the bunk plan", () => {
    const msg = formatBunkPlanMessage(attendance);
    expect(msg).toContain("23B91A05&lt;1&gt;");
    expect(msg).toContain("2-CSE-A &amp; B");
    expect(msg).not.toContain("<Lab>");
  });
});
