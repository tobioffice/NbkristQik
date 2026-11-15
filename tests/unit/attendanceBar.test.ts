import { describe, expect, it } from "vitest";
import { renderAttendanceBarPng } from "../../src/services/attendanceBar.js";

describe("the attendance bar image", () => {
  it("renders a valid PNG with the padded aspect ratio", () => {
    const png = renderAttendanceBarPng({ percentage: 77.12, target: 75 });

    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(640);
    expect(png.readUInt32BE(20)).toBe(64);
    expect(png.length).toBeGreaterThan(100);
  });

  it("changes when the percentage changes", () => {
    const low = renderAttendanceBarPng({ percentage: 30, target: 75 });
    const high = renderAttendanceBarPng({ percentage: 90, target: 75 });

    expect(low.equals(high)).toBe(false);
  });
});
