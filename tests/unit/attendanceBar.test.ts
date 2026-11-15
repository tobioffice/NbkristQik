import { describe, expect, it } from "vitest";
import {
  attendanceBarUrl,
  renderAttendanceBarPng,
  verifyAttendanceBarToken,
} from "../../src/services/attendanceBar.js";

describe("the attendance bar image", () => {
  it("renders a valid PNG", () => {
    const png = renderAttendanceBarPng({ percentage: 77.12, target: 75 });

    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(640);
    expect(png.readUInt32BE(20)).toBe(18);
    expect(png.length).toBeGreaterThan(100);
  });

  it("changes when the percentage changes", () => {
    const low = renderAttendanceBarPng({ percentage: 30, target: 75 });
    const high = renderAttendanceBarPng({ percentage: 90, target: 75 });

    expect(low.equals(high)).toBe(false);
  });

  it("signs the url and rejects a changed number", () => {
    const url = attendanceBarUrl(77.123, 75);
    expect(url).not.toBeNull();

    const parsed = new URL(url!);
    expect(parsed.pathname).toBe("/bar/attendance.png");
    expect(parsed.searchParams.get("pct")).toBe("77.12");
    expect(parsed.searchParams.get("target")).toBe("75");

    const token = parsed.searchParams.get("t") ?? "";
    expect(verifyAttendanceBarToken("77.12", "75", token)).toBe(true);
    expect(verifyAttendanceBarToken("77.13", "75", token)).toBe(false);
    expect(verifyAttendanceBarToken("77.12", "80", token)).toBe(false);
  });
});
