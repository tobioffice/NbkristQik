import { describe, expect, it } from "vitest";
import {
  FIT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  pointInPage,
  scrollToHold,
  stepZoom,
  touchDistance,
  touchMidpoint,
  zoomLabel,
} from "../src/zoom";

describe("the zoom ladder", () => {
  it("stays inside what the page can carry", () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it("walks up and down one rung at a time", () => {
    expect(stepZoom(FIT_ZOOM, 1)).toBe(1.25);
    expect(stepZoom(1.25, 1)).toBe(1.5);
    expect(stepZoom(1.5, -1)).toBe(1.25);
  });

  it("stops at the ends instead of falling off", () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it("shows the zoom as a number a student can read", () => {
    expect(zoomLabel(FIT_ZOOM)).toBe("100%");
    expect(zoomLabel(2.5)).toBe("250%");
  });
});

describe("the point under the finger", () => {
  const page = { left: 12, top: 100 };

  it("is measured in fit-width pixels, which do not move when the zoom does", () => {
    // the finger is 88 px into the page and 200 px down it
    expect(pointInPage({ x: 100, y: 300 }, page, 1)).toEqual({ x: 88, y: 200 });
    // the same finger, on a page already zoomed twice, is the same point
    expect(pointInPage({ x: 188, y: 500 }, page, 2)).toEqual({ x: 88, y: 200 });
  });
});

describe("holding a point through a zoom", () => {
  const page = { left: 12, top: 100 };
  const focal = { x: 100, y: 300 };

  it("scrolls by the distance the point travelled", () => {
    // the point sits 88 px into the page and 200 px down it
    const held = pointInPage(focal, page, 1);
    // zoomed twice, the point is now 176 px in and 400 px down: it moved by
    // 88 px across and 200 px down, so the scroll follows by that much
    const delta = scrollToHold(held, 2, page, focal);
    expect(delta.x).toBe(88);
    expect(delta.y).toBe(200);
  });

  it("moves the other way when the page shrinks", () => {
    const held = pointInPage(focal, page, 2);
    const delta = scrollToHold(held, 1, page, focal);
    expect(delta.x).toBe(-44);
    expect(delta.y).toBe(-100);
  });

  it("holds the point still: the finger lands on the same ink after the zoom", () => {
    const held = pointInPage(focal, page, 1);
    const delta = scrollToHold(held, 2, page, focal);
    // where the point sits after the zoom, minus the scroll that follows it
    const landed = {
      x: page.left + held.x * 2 - delta.x,
      y: page.top + held.y * 2 - delta.y,
    };
    expect(landed.x).toBeCloseTo(focal.x);
    expect(landed.y).toBeCloseTo(focal.y);
  });
});

describe("a pinch", () => {
  it("reads the distance and the middle of two fingers", () => {
    expect(touchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(touchMidpoint({ x: 0, y: 0 }, { x: 100, y: 40 })).toEqual({
      x: 50,
      y: 20,
    });
  });
});
