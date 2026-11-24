import { describe, it, expect } from "vitest";
import {
  dbUtcMs,
  formatFreshnessRange,
  formatGap,
  formatScore,
  formatSyncedAt,
  istStampFromDb,
  istWeekDayLabel,
  istWeekLabel,
} from "../src/format";

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

describe("istWeekLabel", () => {
  it("prints the league's Monday in IST", () => {
    // Monday 16 Nov 2026, 12:00 IST
    expect(istWeekLabel(new Date("2026-11-16T06:30:00Z"))).toBe(
      "Week of 16 Nov",
    );
  });

  it("keeps Sunday night in the week that is ending", () => {
    // Sunday 22 Nov 2026, 23:59 IST
    expect(istWeekLabel(new Date("2026-11-22T18:29:00Z"))).toBe(
      "Week of 16 Nov",
    );
  });

  it("rolls over at Monday midnight IST, not UTC", () => {
    // Monday 23 Nov 2026, 00:00 IST (still Sunday 22 Nov in UTC)
    expect(istWeekLabel(new Date("2026-11-22T18:30:00Z"))).toBe(
      "Week of 23 Nov",
    );
  });
});

describe("istWeekDayLabel", () => {
  it("counts the running week from Monday", () => {
    // Monday 16 Nov 2026, 12:00 IST
    expect(istWeekDayLabel(new Date("2026-11-16T06:30:00Z"))).toBe(
      "Day 1 of 7",
    );
    // Tuesday 24 Nov 2026, 12:00 IST
    expect(istWeekDayLabel(new Date("2026-11-24T06:30:00Z"))).toBe(
      "Day 2 of 7",
    );
  });

  it("ends on Sunday and rolls over at Monday midnight IST", () => {
    // Sunday 22 Nov 2026, 23:59 IST
    expect(istWeekDayLabel(new Date("2026-11-22T18:29:00Z"))).toBe(
      "Day 7 of 7",
    );
    // Monday 23 Nov 2026, 00:00 IST (still Sunday in UTC)
    expect(istWeekDayLabel(new Date("2026-11-22T18:30:00Z"))).toBe(
      "Day 1 of 7",
    );
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

describe("database timestamps", () => {
  it("reads SQLite's UTC stamp as epoch milliseconds", () => {
    expect(dbUtcMs("2026-10-25 11:58:00")).toBe(
      Date.parse("2026-10-25T11:58:00Z"),
    );
  });

  it("prints an absolute IST stamp for a report's last activity", () => {
    expect(istStampFromDb("2026-10-25 11:58:00")).toMatch(/^25 Oct, 5:28/);
  });

  it("has nothing to print without a readable stamp", () => {
    expect(istStampFromDb(null)).toBeNull();
    expect(istStampFromDb("not a date")).toBeNull();
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

describe("formatFreshnessRange", () => {
  const now = new Date("2026-10-25T12:00:00Z");

  it("keeps the single sync line when the range is under an hour", () => {
    expect(
      formatFreshnessRange("2026-10-25 11:58:00", "2026-10-25 11:20:00", now),
    ).toBe("Synced 2 min ago");
  });

  it("prints both ends when one fresh row would mask an old register", () => {
    expect(
      formatFreshnessRange("2026-10-25 11:58:00", "2026-10-19 12:00:00", now),
    ).toBe("Updated 2 min to 6 days ago");
  });

  it("falls back to the newest stamp when the oldest is missing", () => {
    expect(formatFreshnessRange("2026-10-25 09:00:00", null, now)).toBe(
      "Synced 3 hours ago",
    );
  });

  it("has nothing to say without a newest timestamp", () => {
    expect(formatFreshnessRange(null, "2026-10-19 12:00:00", now)).toBeNull();
    expect(formatFreshnessRange("not a date", null, now)).toBeNull();
  });
});
