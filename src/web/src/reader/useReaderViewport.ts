import { useCallback, useRef, useState, type RefObject } from "react";
import { pageAtMiddle as pageAt } from "../pagePosition";
import {
  FIT_ZOOM,
  clampZoom,
  pointInPage,
  scrollToHold,
  stepZoom,
  zoomLabel,
  type Point,
} from "../zoom";

/**
 * Where the reader is looking, and how big the page is.
 *
 * Every page box is the same size, so the geometry is arithmetic rather than
 * a walk over a hundred elements: two measurements give the step, and the
 * page under a point follows. The zoom lives here too, because a zoom is a
 * change of that same geometry — it has to hold the point under the finger.
 *
 * The zoom is the truth in a ref, not in state: a pinch changes it every
 * frame, and the page list must not re-render for that. The label is state,
 * because it is printed.
 */
export interface ReaderViewport {
  /** The scrollable column the pages live in. */
  columnRef: RefObject<HTMLDivElement | null>;
  /** Registers a page box, by page number. */
  setPlaceholder: (page: number, element: HTMLDivElement | null) => void;
  /** The page at the middle of the screen: what the counter shows. */
  pageAtMiddle: () => number;
  /** The page under a screen y. */
  pageAtClientY: (y: number) => number;
  /** Scrolls a page box to the top of the screen, if it is on the page. */
  jumpTo: (page: number) => void;
  /** The zoom, as the reader set it. */
  currentZoom: () => number;
  /** The zoom, as the button prints it. */
  zoomText: string;
  /** Change the zoom, holding the point under the finger (or the middle). */
  applyZoom: (next: number, focal?: Point) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomFit: () => void;
}

export const useReaderViewport = (pages: number): ReaderViewport => {
  const placeholders = useRef(new Map<number, HTMLDivElement>());
  const columnRef = useRef<HTMLDivElement>(null);
  const zoom = useRef(FIT_ZOOM);
  const [zoomText, setZoomText] = useState(zoomLabel(FIT_ZOOM));

  /** The top of page 1 and the distance between page tops. */
  const measure = useCallback((): { start: number; step: number } | null => {
    const first = placeholders.current.get(1);
    const second = placeholders.current.get(2);
    if (!first || !second) return null;
    return {
      start: first.getBoundingClientRect().top,
      step: second.getBoundingClientRect().top - first.getBoundingClientRect().top,
    };
  }, []);

  const pageAtMiddle = useCallback(() => {
    if (pages <= 1) return 1;
    const geometry = measure();
    if (!geometry) return 1;
    return pageAt(geometry.start, geometry.step, window.innerHeight / 2, pages);
  }, [pages, measure]);

  const pageAtClientY = useCallback(
    (y: number) => {
      if (pages <= 1) return 1;
      const geometry = measure();
      if (!geometry) return 1;
      return pageAt(geometry.start, geometry.step, y, pages);
    },
    [pages, measure],
  );

  /**
   * Change the zoom, and hold the point under the finger where it is.
   *
   * The zoom is written straight onto the column as a custom property, so a
   * pinch can change it every frame without the page list re-rendering.
   */
  const applyZoom = useCallback(
    (next: number, focal?: Point) => {
      const column = columnRef.current;
      if (!column) return;

      const before = zoom.current;
      const after = clampZoom(next);
      if (after === before) return;

      // the point under the finger, measured in fit-width pixels, so it can
      // be held still through this zoom and every one after it
      let held: Point | null = null;
      let page: HTMLElement | null = null;
      if (focal) {
        const box = placeholders.current.get(pageAtClientY(focal.y));
        if (box) {
          held = pointInPage(focal, box.getBoundingClientRect(), before);
          page = box;
        }
      }

      zoom.current = after;
      column.style.setProperty("--zoom", String(after));
      setZoomText(zoomLabel(after));

      if (!held || !page || !focal) return;
      const delta = scrollToHold(
        held,
        after,
        page.getBoundingClientRect(),
        focal,
      );
      column.scrollLeft += delta.x;
      window.scrollBy(0, delta.y);
    },
    [pageAtClientY],
  );

  /**
   * The middle of what the student is looking at.
   *
   * The zoom buttons anchor here, not at the page's corner: a zoom that grows
   * from the corner walks the text under the eyes out of the screen, and then
   * the student has to hunt for the spot they were reading before the next
   * zoom. Anchoring at the middle holds the page still.
   */
  const screenCentre = useCallback((): Point => {
    const rect = columnRef.current?.getBoundingClientRect();
    return {
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: window.innerHeight / 2,
    };
  }, []);

  const zoomIn = useCallback(
    () => applyZoom(stepZoom(zoom.current, 1), screenCentre()),
    [applyZoom, screenCentre],
  );
  const zoomOut = useCallback(
    () => applyZoom(stepZoom(zoom.current, -1), screenCentre()),
    [applyZoom, screenCentre],
  );
  const zoomFit = useCallback(
    () => applyZoom(FIT_ZOOM, screenCentre()),
    [applyZoom, screenCentre],
  );

  const jumpTo = useCallback((page: number) => {
    placeholders.current.get(page)?.scrollIntoView({ block: "start" });
  }, []);

  const currentZoom = useCallback(() => zoom.current, []);

  const setPlaceholder = useCallback(
    (page: number, element: HTMLDivElement | null) => {
      if (element) placeholders.current.set(page, element);
      else placeholders.current.delete(page);
    },
    [],
  );

  return {
    columnRef,
    setPlaceholder,
    pageAtMiddle,
    pageAtClientY,
    jumpTo,
    currentZoom,
    zoomText,
    applyZoom,
    zoomIn,
    zoomOut,
    zoomFit,
  };
};
