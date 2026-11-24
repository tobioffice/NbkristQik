import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// Redis is down for every test in this file: the DB writes must still land.
vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn(async () => {
    throw new Error("Redis connect refused");
  }),
}));

// Synthetic section report: no portal call, no student data.
vi.mock("../../src/services/student.utils/parsers.js", () => ({
  parseAttendanceSection: vi.fn(() => new Map()),
  parseMidmarksSection: vi.fn(() => {
    const make = (roll: string, subjects: unknown[]) => ({
      rollno: roll,
      year_branch_section: "3_CSE_A",
      subjects,
    });
    return new Map([
      [
        "26KB1A0501",
        make("26KB1A0501", [
          { subject: "MATH", M1: 27, M2: 26, average: 28, type: "Subject" },
          { subject: "PHYS", M1: 24, M2: null, average: null, type: "Subject" },
          { subject: "LAB", M1: 29, M2: null, average: null, type: "Lab" },
        ]),
      ],
      [
        "26KB1A0502",
        make("26KB1A0502", [
          // the college entered a zero: it must count, not be skipped
          { subject: "MATH", M1: 0, M2: 0, average: 0, type: "Subject" },
          { subject: "PHYS", M1: 20, M2: null, average: null, type: "Subject" },
        ]),
      ],
      [
        "26KB1A0503",
        make("26KB1A0503", [
          // absent in M1: the report's average replaces the 19/2 hack
          { subject: "MATH", M1: null, M2: 19, average: 21, type: "Subject" },
          { subject: "PHYS", M1: 25, M2: null, average: null, type: "Subject" },
        ]),
      ],
    ]);
  }),
}));

import { turso } from "../../src/db/db.js";
import { initStatsTable } from "../../src/db/student_stats.model.js";
import { storeMidMarksToRedis } from "../../src/services/redis/storeAttOrMidToRedis.js";

const context = { yearSem: "31", branch: "5", section: "A" };
const doc = "<table></table>";

beforeAll(async () => {
  await initStatsTable();
});

beforeEach(async () => {
  await turso.execute("DELETE FROM student_stats");
});

describe("mid-mark average", () => {
  it("uses the college's average over (M1 + M2) / 2 when the report has one", async () => {
    await storeMidMarksToRedis(doc, context);

    const rows = await turso.execute(`
      SELECT roll_no, mid_marks_avg FROM student_stats ORDER BY roll_no
    `);

    expect(
      rows.rows.map((row) => [String(row.roll_no), Number(row.mid_marks_avg)]),
    ).toEqual([
      // 28 (college) + 24 (only M1) + 29 (lab) over 3
      ["26KB1A0501", 27],
      // a recorded zero is a mark: (0 + 20) / 2
      ["26KB1A0502", 10],
      // absent M1: 21 (college) + 25 over 2, not (19/2 + 25) / 2
      ["26KB1A0503", 23],
    ]);
  });
});
