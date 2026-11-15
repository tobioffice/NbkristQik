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
  it("prints the labelled card students see in chat", () => {
    expect(formatAttendanceMessage(sample)).toBe(
      "🧑‍🎓 ROLL: <code>23KB1A3061</code>\n" +
        "🏫 Branch: 4 AI DS B\n" +
        "📚 Attended: 188/206\n" +
        "\n" +
        "📈 Percentage: 91.26%\n\n" +
        "█████████░",
    );
  });

  it("reads the portal's branch string the way the room reads it", () => {
    const message = formatAttendanceMessage({
      ...sample,
      year_branch_section: "2_ECE_D",
    });

    expect(message).toContain("🏫 Branch: 2 ECE D");
    expect(message).not.toContain("2_ECE_D");
  });

  it("does not tell the student how much they can bunk", () => {
    const message = formatAttendanceMessage(sample);

    expect(message).not.toContain("You can bunk");
    expect(message).not.toContain("straight to get back");
    expect(message).not.toContain("Six classes make a day");
  });

  it("keeps the shape of the mid marks and bunk replies", () => {
    const message = formatAttendanceMessage(withSubjects);

    expect(
      message.startsWith(
        "🧑‍🎓 ROLL: <code>23KB1A3061</code>\n" +
          "🏫 Branch: 4 AI DS B\n" +
          "📚 Attended: 188/206\n" +
          "\n" +
          "📈 Percentage: 91.26%\n",
      ),
    ).toBe(true);
    expect(message).toContain("<pre>");
    // a closing line, the way mid marks and the bunk plan close
    expect(message.endsWith("<i>Stay above 75% and you're safe.</i>")).toBe(
      true,
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

  it("escapes portal text so Telegram does not reject the markup", () => {
    const message = formatAttendanceMessage({
      ...sample,
      subjects: [
        {
          subject: "OS & DBMS",
          attended: 10,
          conducted: 20,
          lastUpdated: "12-10-2026",
        },
      ],
    });

    // an unescaped & would fail HTML parsing and lose the whole reply
    expect(message).toContain("OS &amp; DBMS");
    expect(message).not.toContain("OS & DBMS");
    // padding is measured before escaping, so the row still lines up
    expect(message).toContain("│  50% │ 12-10");
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
