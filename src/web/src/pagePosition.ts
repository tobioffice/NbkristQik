/**
 * Where the reader is.
 *
 * Page boxes are all the same size, so the position is arithmetic rather
 * than a walk over every page: two measurements give the step, and the page
 * under the middle of the screen follows.
 */

/** A4 is 1.414 tall for every unit wide. A landscape box would crop pages. */
export const PAGE_RATIO = 1.414;

/**
 * Which page sits at the middle of the screen.
 *
 * @param start top of page 1, in viewport coordinates
 * @param step  page height plus the gap between pages
 * @param middle the viewport's middle, in viewport coordinates
 * @param pages how many pages the document has
 */
export const pageAtMiddle = (
  start: number,
  step: number,
  middle: number,
  pages: number,
): number => {
  if (pages <= 1 || step <= 0) return 1;
  const page = Math.floor((middle - start) / step) + 1;
  return Math.min(pages, Math.max(1, page));
};
