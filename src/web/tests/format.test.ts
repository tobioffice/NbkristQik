import { describe, it, expect } from "vitest";
import { formatScore, rankBadgeClass } from "../src/format";

describe("formatScore", () => {
  it("formats attendance to two decimals", () => {
    expect(formatScore({ attendance_percentage: 95.5, mid_marks_avg: null }, "attendance")).toBe("95.50");
  });

  it("formats mid-marks to one decimal", () => {
    expect(formatScore({ attendance_percentage: 95.5, mid_marks_avg: 18.75 }, "midmarks")).toBe("18.8");
  });

  it("renders a dash for missing mid-marks", () => {
    expect(formatScore({ attendance_percentage: 95.5, mid_marks_avg: null }, "midmarks")).toBe("-");
  });
});

describe("rankBadgeClass", () => {
  it("gives every rank a badge class", () => {
    expect(rankBadgeClass(1)).toContain("yellow");
    expect(rankBadgeClass(2)).toContain("indigo");
    expect(rankBadgeClass(99)).toContain("slate");
  });

  it("treats tied ranks identically", () => {
    expect(rankBadgeClass(2)).toBe(rankBadgeClass(3));
  });
});
