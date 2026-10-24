/**
 * The zoom on a page.
 *
 * A page is a vector: the server sends SVG, and the browser can draw it at
 * any size without the ink going soft. The zoom is a change of size, not a
 * change of pixels.
 *
 * Two things have to be true for a zoom to feel right:
 *
 *   - the point under the finger stays under the finger, and
 *   - the page never grows past what the reader can still read.
 *
 * Both are arithmetic, so they live here and are tested.
 */

/** The zoom that fits the page to the screen. */
export const FIT_ZOOM = 1;

/**
 * Below fit the page gets smaller than the screen. Allowed, because a
 * student pulling back to see the whole spread is a reasonable thing to do,
 * but it is not a reading size.
 */
export const MIN_ZOOM = 0.8;

/**
 * Above this a line of a page holds one word. A4 text is set for a page,
 * and three times fit is about as far as a phone can usefully go.
 */
export const MAX_ZOOM = 3;

/** The ladder the zoom buttons walk up and down. */
export const ZOOM_STEPS = [0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export const clampZoom = (zoom: number): number =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** What the reader shows in the zoom button: 100%, 150%, 250%. */
export const zoomLabel = (zoom: number): string => `${Math.round(zoom * 100)}%`;

/**
 * The next rung of the ladder.
 *
 * Steps are not multiplicative: a ladder a student can predict is a ladder
 * they can use without looking.
 */
export const stepZoom = (zoom: number, direction: 1 | -1): number => {
  if (direction > 0) {
    const next = ZOOM_STEPS.find((step) => step > zoom + 0.001);
    return next ?? MAX_ZOOM;
  }
  const previous = [...ZOOM_STEPS]
    .reverse()
    .find((step) => step < zoom - 0.001);
  return previous ?? MIN_ZOOM;
};

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
}

/**
 * Where a point on the screen sits inside a page, in fit-width pixels.
 *
 * Fit-width pixels do not move when the zoom changes, so a point measured
 * this way can be held still through any number of zooms.
 */
export const pointInPage = (focal: Point, page: Box, zoom: number): Point => ({
  x: (focal.x - page.left) / zoom,
  y: (focal.y - page.top) / zoom,
});

/**
 * The scroll to add after a zoom, so the page point that was under the
 * finger is still under it.
 *
 * The page box grows with the zoom, so the point travels with it. The
 * scroll has to travel the same way: by the distance the point moved.
 * Scrolling by s moves the content up by s, which is why the point's new
 * position is subtracted from where it has to land.
 */
export const scrollToHold = (
  held: Point,
  zoom: number,
  page: Box,
  focal: Point,
): Point => ({
  x: page.left + held.x * zoom - focal.x,
  y: page.top + held.y * zoom - focal.y,
});

/** The distance between two touches, for a pinch. */
export const touchDistance = (a: Point, b: Point): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** The middle of two touches, for a pinch: the point that must not move. */
export const touchMidpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
