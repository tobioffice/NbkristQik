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
      "🧑‍🎓 <code>23KB1A3061</code> · 4 AI DS B\n" +
        "\n" +
        "📊 91.26% · 188/206\n" +
        "🟩🟩🟩🟩🟩🟩🟩🟩🟩⬜\n" +
        "🎯 75% needs 155 · you're 33 ahead.",
    );
  });

  it("reads the portal's branch string the way the room reads it", () => {
    const message = formatAttendanceMessage({
      ...sample,
      year_branch_section: "2_ECE_D",
    });

    expect(message).toContain("· 2 ECE D");
    expect(message).not.toContain("2_ECE_D");
  });

  it("fills one block per ten percent, leaving the rest white", () => {
    const message = formatAttendanceMessage({ ...sample, percentage: 85 });

    expect(message).toContain("🟩🟩🟩🟩🟩🟩🟩🟩⬜⬜");
  });

  it("turns the bar yellow below 75 and red below 50", () => {
    expect(formatAttendanceMessage({ ...sample, percentage: 60 })).toContain(
      "🟨🟨🟨🟨🟨🟨⬜⬜⬜⬜",
    );
    expect(formatAttendanceMessage({ ...sample, percentage: 40 })).toContain(
      "🟥🟥🟥🟥⬜⬜⬜⬜⬜⬜",
    );
  });

  it("says which side of the 75% line the numbers are on", () => {
    // 185 of 205 is 90%: the same attended count minus ten reads the other
    // way, so both halves of the line are pinned here
    expect(
      formatAttendanceMessage({
        ...sample,
        percentage: 90.24,
        totalClasses: { attended: 185, conducted: 205 },
      }),
    ).toContain("🎯 75% needs 154 · you're 31 ahead.");
    expect(
      formatAttendanceMessage({
        ...sample,
        percentage: 48.78,
        totalClasses: { attended: 191, conducted: 368 },
      }),
    ).toContain("🎯 75% needs 276 · you're 85 short.");
  });

  it("leaves the target out before the portal has counted anything", () => {
    const message = formatAttendanceMessage({
      ...sample,
      totalClasses: { attended: 0, conducted: 0 },
    });

    expect(message).not.toContain("🎯");
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
