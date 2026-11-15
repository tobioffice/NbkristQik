import { describe, expect, it } from "vitest";
import { InputFile } from "node-telegram-bot-api";
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

    expect(card.html).toContain("<table bordered striped compact>");
    expect(card.html).toContain('<th align="right">Att/Tot</th>');
    expect(card.html).toContain("🧑‍🎓 ROLL:");
    expect(card.html).toContain("📈 Percentage: <b>82.50%</b>");
    expect(card.html).toContain('<img src="tg://photo?id=attendance-bar"');
    expect(card.html).toContain('alt="Attendance 82.50%"');
    expect(card.html).toContain("Stay above 75% and you're safe.");
    expect(card.html).not.toContain("You can bunk");
    expect(card.html).not.toContain("<pre>");
  });

  it("uploads the bar as rich media, not a public url", () => {
    const card = formatAttendanceRich(attendance);

    expect(card.media).toHaveLength(1);
    expect(card.media?.[0]?.id).toBe("attendance-bar");

    const photo = card.media?.[0]?.media;
    expect(photo).toMatchObject({ type: "photo" });
    if (!photo || !("media" in photo)) {
      throw new Error("the bar media is missing");
    }
    expect(photo.media).toBeInstanceOf(InputFile);

    const file = photo.media as InputFile;
    const bytes = Buffer.from(file.data as Uint8Array);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.readUInt32BE(16)).toBe(640);
    expect(bytes.readUInt32BE(20)).toBe(40);
  });

  it("keeps the subject name and escapes its ampersand", () => {
    const card = formatAttendanceRich(attendance);

    expect(card.html).toContain("OS &amp; DBMS");
    expect(card.html).toContain("99/120");
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
