import { describe, it, expect } from "vitest";
import { formatGap, formatScore, formatSyncedAt } from "../src/format";

describe("formatScore", () => {
  it("formats attendance to two decimals", () => {
    expect(
      formatScore(
        { attendance_percentage: 95.5, mid_marks_avg: null },
        "attendance",
      ),
    ).toBe("95.50");
  });

  it("formats mid-marks to one decimal", () => {
    expect(
      formatScore(
        { attendance_percentage: 95.5, mid_marks_avg: 18.75 },
        "midmarks",
      ),
    ).toBe("18.8");
  });

  it("renders a dash for missing mid-marks", () => {
    expect(
      formatScore(
        { attendance_percentage: 95.5, mid_marks_avg: null },
        "midmarks",
      ),
    ).toBe("-");
  });
});

describe("formatGap", () => {
  it("says how far above the line a student sits", () => {
    expect(formatGap(81.24)).toBe("6.2 above 75%");
  });

  it("says how far below the line a student sits", () => {
    expect(formatGap(72.24)).toBe("2.8 below 75%");
  });

  it("names the line itself", () => {
    expect(formatGap(75)).toBe("on the 75% line");
  });
});

describe("formatSyncedAt", () => {
  const now = new Date("2026-10-25T12:00:00Z");

  it("reads the database timestamp as UTC, not local time", () => {
    expect(formatSyncedAt("2026-10-25 11:58:00", now)).toBe("Synced 2 min ago");
  });

  it("counts hours under a day", () => {
    expect(formatSyncedAt("2026-10-25 09:00:00", now)).toBe(
      "Synced 3 hours ago",
    );
  });

  it("uses the singular for one hour", () => {
    expect(formatSyncedAt("2026-10-25 11:00:00", now)).toBe(
      "Synced 1 hour ago",
    );
  });

  it("falls back to an IST date past a day", () => {
    expect(formatSyncedAt("2026-10-22 05:30:00", now)).toMatch(
      /^Synced 22 Oct, 11:00/,
    );
  });

  it("has nothing to say without a timestamp", () => {
    expect(formatSyncedAt(null)).toBeNull();
    expect(formatSyncedAt("not a date")).toBeNull();
  });
});
