import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/services/student.utils/parsers.js", () => ({
  parseAttendanceSection: vi.fn(),
  parseMidmarksSection: vi.fn(() => {
    return new Map([
      [
        "AAA00001",
        {
          rollno: "AAA00001",
          year_branch_section: "3_CSE_A",
          subjects: [{ subject: "MATH", M1: 20, M2: 30 }],
        },
      ],
      [
        "AAA00002",
        {
          rollno: "AAA00002",
          year_branch_section: "3_CSE_A",
          subjects: [{ subject: "MATH", M1: 10, M2: 20 }],
        },
      ],
    ]);
  }),
}));

vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    expire: vi.fn().mockResolvedValue(1),
  }),
}));

vi.mock("../../src/db/student_stats.model.js", () => ({
  updateAttendanceStats: vi.fn().mockResolvedValue(undefined),
  updateMidMarkStats: vi.fn().mockResolvedValue(undefined),
}));

import { storeMidMarksToRedis } from "../../src/services/redis/storeAttOrMidToRedis.js";
import { getClient } from "../../src/services/redis/getRedisClient.js";
import { updateMidMarkStats } from "../../src/db/student_stats.model.js";

const doc =
  '<html><body><table><tr id="AAA00001"></tr><tr id="AAA00002"></tr></table></body></html>';
const context = { yearSem: "32", branch: "5", section: "A" };

describe("storeMidMarksToRedis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the whole section in one stat batch and one cache fan-out", async () => {
    await storeMidMarksToRedis(doc, context);

    const client = await getClient();
    expect(vi.mocked(client.set)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(client.set)).toHaveBeenCalledWith(
      "midmarks:AAA00001",
      expect.any(String),
      { EX: 60 * 60 * 2 },
    );

    // one batch per section, carrying every roll and the semester
    expect(vi.mocked(updateMidMarkStats)).toHaveBeenCalledTimes(1);
    const rows = vi.mocked(updateMidMarkStats).mock.calls[0][0];
    expect(rows.map((row) => row.roll)).toEqual(["AAA00001", "AAA00002"]);
    expect(rows.every((row) => row.yearSem === "32")).toBe(true);
    expect(rows.map((row) => row.value)).toEqual([25, 15]);
  });

  it("uses the request semester for the year-41 scale, not a per-row lookup", async () => {
    await storeMidMarksToRedis(doc, { ...context, yearSem: "41" });

    const rows = vi.mocked(updateMidMarkStats).mock.calls[0][0];
    // (25 / 40) * 30 = 18.75, (15 / 40) * 30 = 11.25
    expect(rows.map((row) => row.value)).toEqual([18.75, 11.25]);
  });
});
