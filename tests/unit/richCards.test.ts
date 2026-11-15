import { describe, expect, it } from "vitest";
import {
  formatAttendanceRich,
  formatBunkPlanRich,
  formatMidmarksRich,
} from "../../src/services/student.utils/formatters.js";
import type { Attendance, Midmarks } from "../../src/types/index.js";

const attendance: Attendance = {
  rollno: "25KB1A05AR",
  year_branch_section: "2_ECE_D",
  percentage: 82.5,
  totalClasses: { attended: 99, conducted: 120 },
  subjects: [
    {
      subject: "OS & DBMS",
      attended: 40,
      conducted: 48,
      lastUpdated: "05-11-2026",
    },
    {
      subject: "NETWORKS",
      attended: 59,
      conducted: 72,
      lastUpdated: "05-11-2026",
    },
  ],
};

const midmarks: Midmarks = {
  rollno: "25KB1A05AR",
  year_branch_section: "2_ECE_D",
  subjects: [
    {
      subject: "OS",
      type: "MID",
      M1: 18,
      M2: null,
      average: 18,
    },
  ],
};

describe("rich attendance card", () => {
  it("uses a real table instead of a monospaced block", () => {
    const card = formatAttendanceRich(attendance);

    expect(card).toContain("<table bordered striped compact>");
    expect(card).toContain('<th align="right">Att/Tot</th>');
    expect(card).toContain("🧑‍🎓 ROLL:");
    expect(card).toContain("📈 Percentage: <b>82.50%</b>");
    expect(card).toContain(
      "/bar/attendance.png?pct=82.50&amp;target=75&amp;t=",
    );
    expect(card).toContain('alt="Attendance 82.50%"');
    expect(card).toContain("Stay above 75% and you're safe.");
    expect(card).not.toContain("You can bunk");
    expect(card).not.toContain("<pre>");
  });

  it("keeps the subject name and escapes its ampersand", () => {
    const card = formatAttendanceRich(attendance);

    expect(card).toContain("OS &amp; DBMS");
    expect(card).toContain("99/120");
  });
});

describe("rich mid-marks card", () => {
  it("gives each paper its own column", () => {
    const card = formatMidmarksRich(midmarks);

    expect(card).toContain('<th align="right">M1</th>');
    expect(card).toContain('<th align="right">M2</th>');
    expect(card).toContain('<th align="right">Avg</th>');
    expect(card).toContain("18");
    expect(card).toContain("—"); // M2 was not written
  });
});

describe("rich bunk card", () => {
  it("keeps the skip and recovery numbers right aligned", () => {
    const card = formatBunkPlanRich(attendance);

    expect(card).toContain('<th align="right">Bunk</th>');
    expect(card).toContain('<th align="right">Need</th>');
    expect(card).toContain("Bunk plan for");
    expect(card).toContain("Six classes make a day.");
  });

  it("writes a zero row for a subject with no classes yet", () => {
    const card = formatBunkPlanRich({
      ...attendance,
      subjects: [
        {
          subject: "NEW SUBJECT",
          attended: 0,
          conducted: 0,
          lastUpdated: "",
        },
      ],
    });

    expect(card).toContain("NEW SUBJECT");
    expect(card).toContain('<td align="right">0%</td>');
    expect(card).toContain('<td align="right">0</td>');
  });
});
