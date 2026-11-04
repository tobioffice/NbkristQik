import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// Redis is down for every test in this file: the DB writes must still land.
vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => {
    throw new Error("Redis connect refused");
  }),
}));

vi.mock("../../src/services/student.utils/Academic.js", () => ({
  Academic: {
    parseAttendanceResponse: vi.fn(async (_doc: string, roll: string) => ({
      rollno: roll,
      year_branch_section: "4_CSE_A",
      percentage: 87.5,
      totalClasses: { attended: 7, conducted: 8 },
      subjects: [],
    })),
    parseMidmarksResponse: vi.fn(async (_doc: string, roll: string) => ({
      rollno: roll,
      year_branch_section: "3_CSE_A",
      subjects: [{ subject: "MATH", M1: 20, M2: 30 }],
    })),
  },
}));

vi.mock("../../src/services/redis/utils.js", () => ({
  getStudentCached: vi.fn(async (roll: string) => ({
    roll_no: roll,
    name: "Test Student",
    section: "A",
    branch: "5",
    year: "31",
  })),
}));

import { turso } from "../../src/db/db.js";
import { initStatsTable } from "../../src/db/student_stats.model.js";
import {
  storeAttendanceToRedis,
  storeMidMarksToRedis,
} from "../../src/services/redis/storeAttOrMidToRedis.js";
import { getClient } from "../../src/services/redis/getRedisClient.js";

const doc = `<table>
  <tr id="26KB1A0501"></tr>
  <tr id="26KB1A0502"></tr>
</table>`;

beforeAll(async () => {
  await initStatsTable();
});

beforeEach(async () => {
  await turso.execute("DELETE FROM student_stats");
});

describe("leaderboard stats without Redis", () => {
  it("still writes every attendance stat to the database", async () => {
    await storeAttendanceToRedis(doc);

    const rows = await turso.execute(`
      SELECT roll_no, attendance_percentage
      FROM student_stats ORDER BY roll_no
    `);
    expect(
      rows.rows.map((row) => [
        String(row.roll_no),
        Number(row.attendance_percentage),
      ]),
    ).toEqual([
      ["26KB1A0501", 87.5],
      ["26KB1A0502", 87.5],
    ]);
    // the Redis connection was attempted (and rejected) without rejecting
    expect(vi.mocked(getClient)).toHaveBeenCalled();
  });

  it("still writes every mid-mark stat to the database", async () => {
    await storeMidMarksToRedis(doc);

    const rows = await turso.execute(`
      SELECT roll_no, mid_marks_avg
      FROM student_stats ORDER BY roll_no
    `);
    expect(
      rows.rows.map((row) => [String(row.roll_no), Number(row.mid_marks_avg)]),
    ).toEqual([
      ["26KB1A0501", 25],
      ["26KB1A0502", 25],
    ]);
  });
});
