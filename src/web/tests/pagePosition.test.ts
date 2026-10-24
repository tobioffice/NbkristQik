import { describe, expect, it } from "vitest";
import { PAGE_RATIO, pageAtMiddle } from "../src/pagePosition";

describe("the page box", () => {
  it("is A4, so a portrait page is never cropped", () => {
    // a landscape box crops a portrait raster and pushes the last page out
    expect(PAGE_RATIO).toBeCloseTo(1.414, 3);
  });
});

describe("the page at the middle of the screen", () => {
  it("counts from the first page", () => {
    expect(pageAtMiddle(0, 1000, 500, 10)).toBe(1);
  });

  it("follows the scroll one page at a time", () => {
    expect(pageAtMiddle(0, 1000, 1500, 10)).toBe(2);
    expect(pageAtMiddle(0, 1000, 2500, 10)).toBe(3);
  });

  it("never runs past the last page", () => {
    expect(pageAtMiddle(0, 1000, 999999, 3)).toBe(3);
  });

  it("never runs before the first page", () => {
    expect(pageAtMiddle(0, 1000, -500, 10)).toBe(1);
  });

  it("stays on page one when there is nothing to measure", () => {
    expect(pageAtMiddle(0, 1000, 500, 1)).toBe(1);
    expect(pageAtMiddle(0, 0, 500, 10)).toBe(1);
  });
});
