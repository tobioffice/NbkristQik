import { describe, it, expect } from "vitest";

import { formatAttendanceMessage } from "../../src/services/student.utils/formatters.js";
import type { Attendance } from "../../src/types/index.js";

const sample: Attendance = {
  rollno: "23KB1A3061",
  year_branch_section: "4_AI_DS_B",
  percentage: 91.26,
  totalClasses: { attended: 188, conducted: 206 },
  subjects: [],
};

describe("formatAttendanceMessage", () => {
  it("prints the compact card students see in chat", () => {
    expect(formatAttendanceMessage(sample)).toBe(
      "🧑‍🎓 ROLL: 23KB1A3061\n" +
        "🏫 Branch: 4_AI_DS_B\n" +
        "📚 Attended: 188/206\n" +
        "\n" +
        "📈 Percentage: 91.26%\n" +
        "🟩🟩🟩🟩🟩🟩🟩🟩🟩⬜",
    );
  });

  it("fills one block per ten percent, leaving the rest white", () => {
    const message = formatAttendanceMessage({ ...sample, percentage: 85 });

    expect(message.endsWith("🟩🟩🟩🟩🟩🟩🟩🟩⬜⬜")).toBe(true);
  });

  it("turns the bar yellow below 75 and red below 50", () => {
    expect(formatAttendanceMessage({ ...sample, percentage: 60 })).toContain(
      "🟨🟨🟨🟨🟨🟨⬜⬜⬜⬜",
    );
    expect(formatAttendanceMessage({ ...sample, percentage: 40 })).toContain(
      "🟥🟥🟥🟥⬜⬜⬜⬜⬜⬜",
    );
  });

  it("prints the other half: a row per subject under the card", () => {
    const message = formatAttendanceMessage(withSubjects);

    expect(message).toContain("SUBJ        │ ATT/TOT │  NOW │ LAST");
    // the numbers the percentage is made of, so 82% cannot hide a 60%
    expect(message).toContain("CN");
    expect(message).toContain("28/32");
    expect(message).toContain("│  88% │ 12-10");
    expect(message).toContain("DBMS");
    expect(message).toContain("22/30");
    expect(message).toContain("│  73% │ 12-10");
    expect(message).toContain("Stay above 75% and you're safe.");
  });

  it("leaves a dash where a subject has no classes yet, never a NaN", () => {
    const message = formatAttendanceMessage({
      ...sample,
      subjects: [{ subject: "OS", attended: 0, conducted: 0, lastUpdated: "" }],
    });

    expect(message).not.toContain("NaN");
    expect(message).toContain("—");
    expect(message).toContain("N/A");
  });
});

const withSubjects: Attendance = {
  ...sample,
  subjects: [
    {
      subject: "CN",
      attended: 28,
      conducted: 32,
      lastUpdated: "12-10-2025",
    },
    {
      subject: "DBMS",
      attended: 22,
      conducted: 30,
      lastUpdated: "12-10-2025",
    },
  ],
};
