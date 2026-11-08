import { describe, it, expect } from "vitest";
import { bunkPlan } from "../src/format";

describe("bunkPlan", () => {
  it("has nothing to plan when no classes were conducted", () => {
    expect(bunkPlan(0, 0)).toEqual({ skips: 0, needed: 0 });
  });

  it("leaves no slack exactly on the 75% line", () => {
    expect(bunkPlan(75, 100)).toEqual({ skips: 0, needed: 0 });
    expect(bunkPlan(3, 4)).toEqual({ skips: 0, needed: 0 });
  });

  it("counts skips above the line with floor", () => {
    expect(bunkPlan(80, 100)).toEqual({ skips: 6, needed: 0 });
    expect(bunkPlan(76, 100)).toEqual({ skips: 1, needed: 0 });
  });

  it("counts the classes needed below the line with ceil", () => {
    expect(bunkPlan(70, 100)).toEqual({ skips: 0, needed: 20 });
    expect(bunkPlan(74, 100)).toEqual({ skips: 0, needed: 4 });
    // 74.9 needs one full class even though the raw gap is under one
    expect(bunkPlan(74.9, 100)).toEqual({ skips: 0, needed: 1 });
  });

  it("never returns a negative number", () => {
    expect(bunkPlan(0, 10)).toEqual({ skips: 0, needed: 30 });
    expect(bunkPlan(100, 100)).toEqual({ skips: 33, needed: 0 });
    expect(bunkPlan(10, 100)).toEqual({ skips: 0, needed: 260 });
  });

  it("honours a different minimum", () => {
    expect(bunkPlan(80, 100, 80)).toEqual({ skips: 0, needed: 0 });
    expect(bunkPlan(70, 100, 80)).toEqual({ skips: 0, needed: 50 });
  });
});
