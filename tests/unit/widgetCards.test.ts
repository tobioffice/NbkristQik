import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import {
  formatAttendanceWidget,
  formatBunkWidget,
  formatMidmarksWidget,
} from "../../src/services/student.utils/formatters.js";
import {
  WIDGET_HTML,
  widgetFits,
  widgetKind,
  widgetStateJson,
} from "../../src/services/student.utils/widget.js";
import type { Attendance, Midmarks } from "../../src/types/index.js";

const attendance: Attendance = {
  rollno: "23KB1A0599",
  year_branch_section: "4_CSE_C",
  percentage: 77.12,
  totalClasses: { attended: 182, conducted: 236 },
  subjects: [
    { subject: "MS", attended: 17, conducted: 33, lastUpdated: "12-10-2026" },
    { subject: "GS", attended: 19, conducted: 24, lastUpdated: "12-10-2026" },
    { subject: "EMPS", attended: 18, conducted: 21, lastUpdated: "12-10-2026" },
    { subject: "DL", attended: 36, conducted: 42, lastUpdated: "12-10-2026" },
    {
      subject: "AR_VR",
      attended: 24,
      conducted: 34,
      lastUpdated: "12-10-2026",
    },
    { subject: "AMDS", attended: 32, conducted: 40, lastUpdated: "12-10-2026" },
    { subject: "LABS", attended: 36, conducted: 42, lastUpdated: "" },
  ],
};

const midmarks: Midmarks = {
  rollno: "23KB1A0599",
  year_branch_section: "4_CSE_C",
  subjects: [{ subject: "MS", type: "MID", M1: 18, M2: null, average: 18 }],
};

describe("the attendance widget state", () => {
  it("carries the labelled facts and the meter", () => {
    const card = formatAttendanceWidget(attendance, "Cached ≤1h");

    expect(card.state.kind).toBe("att");
    expect(card.state.lines).toEqual([
      { label: "ROLL", value: "23KB1A0599" },
      { label: "Branch", value: "4 CSE C" },
      { label: "Attended", value: "182/236" },
      { label: "Percentage", value: "77.12%" },
    ]);
    expect(card.state.meter).toEqual({ value: 77.12, threshold: 75 });
    expect(card.state.table?.headers).toEqual([
      "Subject",
      "Att/Tot",
      "Now",
      "Last",
    ]);
    expect(card.state.warning).toContain("Below 75% in 2 subjects");
    expect(card.state.warning).toContain("MS, AR_VR");
    expect(card.state.notice).toBe("Cached ≤1h");
    expect(card.caption).toContain("Attendance · 23KB1A0599 · 77.12%");
    expect(card.caption).toContain("Cached ≤1h");
  });

  it("stays inside Telegram's 1024-byte chat state", () => {
    const card = formatAttendanceWidget(attendance);
    expect(widgetFits(card.state)).toBe(true);
  });

  it("still fits a ten-subject semester", () => {
    const many: Attendance = {
      ...attendance,
      subjects: Array.from({ length: 10 }, (_, index) => ({
        subject: `SUBJECT ${index + 1}`,
        attended: 20 + index,
        conducted: 30 + index,
        lastUpdated: "12-10-2026",
      })),
    };

    const card = formatAttendanceWidget(many);
    expect(widgetFits(card.state)).toBe(true);
    expect(Buffer.byteLength(widgetStateJson(card.state), "utf8")).toBeLessThan(
      1024,
    );
  });
});

describe("the other widget cards", () => {
  it("keeps the mid-mark columns", () => {
    const card = formatMidmarksWidget(midmarks);

    expect(card.state.kind).toBe("mid");
    expect(card.state.table?.headers).toEqual([
      "Subject",
      "Type",
      "M1",
      "M2",
      "Avg",
    ]);
    expect(card.state.meter).toBeUndefined();
    expect(card.caption).toContain("Mid marks · 23KB1A0599");
  });

  it("keeps the bunk forecast in its own card", () => {
    const card = formatBunkWidget(attendance);

    expect(card.state.kind).toBe("bunk");
    expect(card.state.headline).toContain("You can bunk");
    expect(card.state.table?.headers).toEqual([
      "Subject",
      "Now",
      "Bunk",
      "Need",
    ]);
    expect(card.caption).toContain("Bunk plan · 23KB1A0599");
  });
});

describe("the widget document", () => {
  it("is inside Telegram's code and compression limits", () => {
    const bytes = Buffer.byteLength(WIDGET_HTML, "utf8");
    const packed = deflateSync(WIDGET_HTML, { level: 9 }).length;

    expect(bytes).toBeLessThan(32768);
    expect(packed).toBeLessThan(4096);
  });

  it("reads the kind back for the text-card fallback", () => {
    expect(widgetKind(JSON.stringify({ v: 1, kind: "mid" }))).toBe("mid");
    expect(widgetKind(JSON.stringify({ v: 1, kind: "bunk" }))).toBe("bunk");
    expect(widgetKind(JSON.stringify({ v: 1, kind: "att" }))).toBe("att");
    expect(widgetKind(null)).toBe("att");
    expect(widgetKind("not json")).toBe("att");
  });
});
