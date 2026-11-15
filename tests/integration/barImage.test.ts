import { describe, expect, it } from "vitest";
import request from "supertest";
import { attendanceBarUrl } from "../../src/services/attendanceBar.js";

const { app } = await import("../../src/api/server.js");

describe("GET /bar/attendance.png", () => {
  it("serves a signed bar as a cacheable PNG", async () => {
    const url = attendanceBarUrl(77.12, 75);
    expect(url).not.toBeNull();
    const parsed = new URL(url!);

    const res = await request(app).get(`${parsed.pathname}${parsed.search}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["cache-control"]).toContain("public");
    expect(Buffer.from(res.body).subarray(0, 8).toString("hex")).toBe(
      "89504e470d0a1a0a",
    );
  });

  it("refuses a tampered token", async () => {
    const res = await request(app).get(
      "/bar/attendance.png?pct=77.12&target=75&t=bad",
    );

    expect(res.status).toBe(403);
  });
});
