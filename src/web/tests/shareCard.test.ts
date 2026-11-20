import { describe, it, expect } from "vitest";
import { buildRankCardModel } from "../src/shareCard";

describe("buildRankCardModel", () => {
  it("names the board, the rank and the ranked count", () => {
    const model = buildRankCardModel({
      sort: "attendance",
      rank: 4,
      total: 63,
      value: 87.4,
      scope: "section",
      scopeLabel: "CSE · Year 3 · Section A",
    });

    expect(model.eyebrow).toBe("Attendance rank");
    expect(model.rank).toBe("4");
    expect(model.score).toBe("87.40");
    expect(model.unit).toBe("%");
    expect(model.scopeLabel).toBe("CSE · Year 3 · Section A");
    expect(model.count).toBe("63 students ranked");
    expect(model.gapNote).toBe("12.4 above the 75% line");
    expect(model.belowMinimum).toBe(false);
    expect(model.merit).toBeNull();
    expect(model.crown).toBe(false);
    expect(model.alt).toContain("#4 of 63");
    expect(model.alt).toContain("87.40%");
  });

  it("uses the register's red for a score below the minimum", () => {
    const model = buildRankCardModel({
      sort: "attendance",
      rank: 40,
      total: 63,
      value: 71.25,
      scope: "section",
      scopeLabel: "CSE · Year 3 · Section A",
    });

    expect(model.belowMinimum).toBe(true);
    expect(model.gapNote).toBe("3.7 below the 75% line");
  });

  it("crowns the leader and calls the top three by name", () => {
    const first = buildRankCardModel({
      sort: "attendance",
      rank: 1,
      total: 63,
      value: 96,
      scope: "section",
      scopeLabel: "CSE · Year 3 · Section A",
    });
    expect(first.crown).toBe(true);
    expect(first.merit).toBe("First in the section");

    const third = buildRankCardModel({
      sort: "attendance",
      rank: 3,
      total: 63,
      value: 90,
      scope: "all",
      scopeLabel: "All students",
    });
    expect(third.crown).toBe(false);
    expect(third.merit).toBe("Third overall");
  });

  it("has no percent or 75% note on the mid-mark card", () => {
    const model = buildRankCardModel({
      sort: "midmarks",
      rank: 7,
      total: 63,
      value: 24.5,
      scope: "section",
      scopeLabel: "CSE · Year 3 · Section A",
    });

    expect(model.eyebrow).toBe("Mid-mark rank");
    expect(model.score).toBe("24.5");
    expect(model.unit).toBeNull();
    expect(model.gapNote).toBe("Average of M1 and M2");
    expect(model.count).toBe("63 students ranked");
  });

  it("says one student, not one students", () => {
    const model = buildRankCardModel({
      sort: "attendance",
      rank: 1,
      total: 1,
      value: 100,
      scope: "all",
      scopeLabel: "All students",
    });

    expect(model.count).toBe("1 student ranked");
  });

  it("never names a classmate", () => {
    const model = buildRankCardModel({
      sort: "attendance",
      rank: 4,
      total: 63,
      value: 87.4,
      scope: "section",
      scopeLabel: "CSE · Year 3 · Section A",
    });

    const text = JSON.stringify(model);
    expect(text).not.toMatch(/25KB/i);
    expect(text).not.toMatch(/ASHA/i);
  });
});
