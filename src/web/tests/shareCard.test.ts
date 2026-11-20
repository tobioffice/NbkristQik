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
    expect(model.showBar).toBe(true);
    expect(model.barPercent).toBe(87.4);
    expect(model.belowMinimum).toBe(false);
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
    expect(model.barPercent).toBe(71.25);
  });

  it("has no bar or percent on the mid-mark card", () => {
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
    expect(model.showBar).toBe(false);
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
