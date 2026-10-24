import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PAGE_RATIO, pageAtMiddle as pageAt } from "../pagePosition";
import { usePageWindow } from "../usePageWindow";
import {
  FIT_ZOOM,
  clampZoom,
  pointInPage,
  scrollToHold,
  stepZoom,
  touchDistance,
  touchMidpoint,
  zoomLabel,
  type Point,
} from "../zoom";

interface DocumentReaderProps {
  docId: string;
  title: string;
  unit: string | null;
  pages: number;
  onClose: () => void;
}

/** Where the reader last stopped, per document. */
const stopKey = (docId: string) => `nbk:read:${docId}`;

/** The zoom a double tap lands on: close enough to read a formula. */
const READING_ZOOM = 2.5;

/** Two taps closer together than this, in milliseconds, are one double tap. */
const DOUBLE_TAP_MS = 400;

/** How far a tap may drift and still count as a double tap, in pixels. */
const DOUBLE_TAP_SLOP = 48;

/**
 * The reader.
 *
 * Pages are fetched as the student scrolls and dropped as they scroll away,
 * so only the pages on screen are held in memory. Each page is a vector SVG
 * drawn by the browser: the layout is the PDF's own page, and there is no
 * text layer to select and nothing to save.
 *
 * A page is a vector, so it can be made bigger or smaller without the server
 * sending anything else, and the ink stays sharp at every zoom the reader
 * allows.
 */
export default function DocumentReader({
  docId,
  title,
  unit,
  pages,
  onClose,
}: DocumentReaderProps) {
  const pageWindow = usePageWindow(docId);
  const [current, setCurrent] = useState(1);
  const [failed, setFailed] = useState<Set<number>>(() => new Set());
  const placeholders = useRef(new Map<number, HTMLDivElement>());
  const images = useRef(new Map<number, HTMLImageElement>());
  const column = useRef<HTMLDivElement>(null);
  // the zoom is the truth in a ref: a pinch changes it every frame, and the
  // page list must not re-render for that
  const zoom = useRef(FIT_ZOOM);
  const [zoomText, setZoomText] = useState(zoomLabel(FIT_ZOOM));

  /**
   * The page at the middle of the screen.
   *
   * Every page box is the same size, so two measurements give the step and
   * the whole calculation is arithmetic: no walking a hundred elements on
   * every scroll frame.
   */
  const pageAtMiddle = useCallback(() => {
    if (pages <= 1) return 1;
    const first = placeholders.current.get(1);
    const second = placeholders.current.get(2);
    if (!first || !second) return 1;
    const step =
      second.getBoundingClientRect().top - first.getBoundingClientRect().top;
    const start = first.getBoundingClientRect().top;
    return pageAt(start, step, window.innerHeight / 2, pages);
  }, [pages]);

  const mark = useCallback((page: number, ok: boolean) => {
    setFailed((prev) => {
      if (ok === !prev.has(page)) return prev;
      const next = new Set(prev);
      if (ok) next.delete(page);
      else next.add(page);
      return next;
    });
  }, []);

  /**
   * The page under a point on the screen.
   *
   * Every page box is the same size, so two measurements give the step and
   * the page follows, the same way the counter does.
   */
  const pageAtClientY = useCallback(
    (y: number) => {
      if (pages <= 1) return 1;
      const first = placeholders.current.get(1);
      const second = placeholders.current.get(2);
      if (!first || !second) return 1;
      const step =
        second.getBoundingClientRect().top - first.getBoundingClientRect().top;
      const start = first.getBoundingClientRect().top;
      return pageAt(start, step, y, pages);
    },
    [pages],
  );

  /**
   * Change the zoom, and hold the point under the finger where it is.
   *
   * The zoom is written straight onto the column as a custom property, so a
   * pinch can change it every frame without the page list re-rendering.
   */
  const applyZoom = useCallback(
    (next: number, focal?: Point) => {
      const el = column.current;
      if (!el) return;
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
          const rect = box.getBoundingClientRect();
          held = pointInPage(focal, { left: rect.left, top: rect.top }, before);
          page = box;
        }
      }

      zoom.current = after;
      el.style.setProperty("--zoom", String(after));
      setZoomText(zoomLabel(after));

      if (!held || !page || !focal) return;
      const rect = page.getBoundingClientRect();
      const delta = scrollToHold(
        held,
        after,
        { left: rect.left, top: rect.top },
        focal,
      );
      el.scrollLeft += delta.x;
      window.scrollBy(0, delta.y);
    },
    [pageAtClientY],
  );

  // which pages are wanted, and what to draw
  useEffect(() => {
    const onScreen = new Set<number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (!page) continue;
          if (entry.isIntersecting) onScreen.add(page);
          else onScreen.delete(page);
        }

        // the window holds what is on screen, and lets go of what is not
        pageWindow.setWanted(new Set(onScreen));

        for (const page of onScreen) {
          const image = images.current.get(page);
          if (image) void pageWindow.load(page, image, (ok) => mark(page, ok));
        }

        setCurrent(pageAtMiddle());
      },
      {
        root: null,
        // a screen and a half either side: pages arrive before they are
        // needed and leave after they are read
        rootMargin: "120% 0px",
        threshold: 0,
      },
    );

    for (const el of placeholders.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [pageWindow, pages, pageAtMiddle, mark]);

  // the counter follows the scroll itself, not only the moment a page enters
  // or leaves the window: otherwise it freezes while you read the last page
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setCurrent(pageAtMiddle());
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pageAtMiddle]);

  // open where the student stopped last time
  useEffect(() => {
    const saved = Number(sessionStorage.getItem(stopKey(docId)) ?? "0");
    if (!saved || saved < 2) return;
    const frame = requestAnimationFrame(() => {
      placeholders.current.get(saved)?.scrollIntoView({ block: "start" });
      setCurrent(saved);
    });
    return () => cancelAnimationFrame(frame);
  }, [docId]);

  // remember the place, so a call or the app switcher does not lose it
  useEffect(() => {
    sessionStorage.setItem(stopKey(docId), String(current));
  }, [docId, current]);

  // the Telegram app switcher must not keep a readable snapshot of the page
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") pageWindow.releaseAll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pageWindow]);

  // the Telegram back button closes the reader
  useEffect(() => {
    const tg = (
      window as unknown as {
        Telegram?: {
          WebApp?: {
            BackButton?: {
              show: () => void;
              hide: () => void;
              onClick: (f: () => void) => void;
              offClick: (f: () => void) => void;
            };
          };
        };
      }
    ).Telegram?.WebApp;
    const back = tg?.BackButton;
    if (!back) return;
    back.show();
    const close = () => onClose();
    back.onClick(close);
    return () => {
      back.offClick(close);
      back.hide();
    };
  }, [onClose]);

  /**
   * The middle of what the student is looking at.
   *
   * The zoom buttons anchor here, not at the page's corner: a zoom that grows
   * from the corner walks the text under the eyes out of the screen, and then
   * the student has to hunt for the spot they were reading before the next
   * zoom. Anchoring at the middle holds the page still.
   */
  const screenCentre = useCallback((): Point => {
    const el = column.current;
    const rect = el?.getBoundingClientRect();
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

  /**
   * Pinch, double tap, and the wheel.
   *
   * These are attached natively rather than through React, because React
   * listens to touch move passively, and a passive listener cannot stop the
   * document from scrolling under a pinch. The reader has to be the one that
   * moves.
   *
   * The pinch listens on the whole document, not only on the pages: two
   * fingers are the gesture, and a student who starts one on the head band
   * still means it. The double tap stays on the pages, so a double tap on the
   * way back does not zoom.
   */
  useEffect(() => {
    const el = column.current;
    if (!el) return;

    let pinch: { distance: number; zoom: number } | null = null;
    let tap: { x: number; y: number; at: number } | null = null;
    let touched = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const a = e.touches[0];
        const b = e.touches[1];
        pinch = {
          distance: touchDistance(
            { x: a.clientX, y: a.clientY },
            { x: b.clientX, y: b.clientY },
          ),
          zoom: zoom.current,
        };
        touched = Date.now();
        return;
      }
      // a finger down on its own ends any pinch that was under way
      if (pinch) pinch = null;
      touched = Date.now();
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch) return;
      // the document must not scroll under a pinch
      e.preventDefault();
      const a = e.touches[0];
      const b = e.touches[1];
      const distance = touchDistance(
        { x: a.clientX, y: a.clientY },
        { x: b.clientX, y: b.clientY },
      );
      if (pinch.distance <= 0) return;
      const focal = touchMidpoint(
        { x: a.clientX, y: a.clientY },
        { x: b.clientX, y: b.clientY },
      );
      applyZoom(pinch.zoom * (distance / pinch.distance), focal);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length >= 2) return;
      if (pinch) {
        pinch = null;
        touched = Date.now();
        return;
      }
      const t = e.changedTouches[0];
      if (!t) return;
      // the double tap is a page gesture: a tap on the way back must not zoom
      if (!(e.target instanceof Node) || !el.contains(e.target)) return;
      const now = Date.now();
      if (
        tap &&
        now - tap.at < DOUBLE_TAP_MS &&
        Math.hypot(t.clientX - tap.x, t.clientY - tap.y) < DOUBLE_TAP_SLOP
      ) {
        // a second tap: zoom in on the spot, or back to fit
        e.preventDefault();
        applyZoom(zoom.current > FIT_ZOOM ? FIT_ZOOM : READING_ZOOM, {
          x: t.clientX,
          y: t.clientY,
        });
        tap = null;
        return;
      }
      tap = { x: t.clientX, y: t.clientY, at: now };
    };

    const onTouchCancel = () => {
      pinch = null;
      touched = Date.now();
    };

    const onWheel = (e: WheelEvent) => {
      // an ordinary wheel scrolls the document; the browser's own zoom is
      // the reader's zoom, so it is taken over
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      applyZoom(zoom.current * factor, { x: e.clientX, y: e.clientY });
    };

    const onDoubleClick = (e: MouseEvent) => {
      // a touch double tap has already zoomed, and the browser sends a
      // double click along with it; only the mouse gets this one
      if (Date.now() - touched < 500) return;
      applyZoom(zoom.current > FIT_ZOOM ? FIT_ZOOM : READING_ZOOM, {
        x: e.clientX,
        y: e.clientY,
      });
    };

    // the pinch is two fingers anywhere on the reader; the double tap and
    // the wheel are page gestures, so they stay on the pages
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: false });
    document.addEventListener("touchcancel", onTouchCancel, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("dblclick", onDoubleClick);
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchCancel);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("dblclick", onDoubleClick);
    };
  }, [applyZoom]);

  const progress = pages > 1 ? (current - 1) / (pages - 1) : 0;

  const retry = useCallback(
    (page: number) => {
      const image = images.current.get(page);
      if (!image) return;
      mark(page, true);
      void pageWindow.load(page, image, (ok) => mark(page, ok));
    },
    [pageWindow, mark],
  );

  const setPlaceholder = useCallback(
    (page: number, el: HTMLDivElement | null) => {
      if (el) placeholders.current.set(page, el);
      else placeholders.current.delete(page);
    },
    [],
  );

  const setImage = useCallback((page: number, el: HTMLImageElement | null) => {
    if (el) images.current.set(page, el);
    else images.current.delete(page);
  }, []);

  /**
   * The pages.
   *
   * The list is built once and kept: a pinch changes the zoom every frame,
   * and the pages must not be rebuilt for that. Only the column's custom
   * property moves, and the browser does the rest.
   */
  const pageList = useMemo(
    () =>
      Array.from({ length: pages }, (_, i) => i + 1).map((page) => {
        const isFailed = failed.has(page);
        return (
          <div
            className={`reader__page${isFailed ? " reader__page--failed" : ""}`}
            key={page}
            data-page={page}
            ref={(el) => setPlaceholder(page, el)}
            style={{ aspectRatio: `1 / ${PAGE_RATIO}` }}
            onClick={isFailed ? () => retry(page) : undefined}
          >
            <div className="reader__skeleton">
              <b>{page}</b>
              <span>
                {isFailed ? "Did not load · tap to try again" : "Loading"}
              </span>
            </div>
            <img
              className="reader__canvas"
              ref={(el) => setImage(page, el)}
              alt=""
              onContextMenu={(e) => e.preventDefault()}
              draggable={false}
            />
          </div>
        );
      }),
    [pages, failed, retry, setPlaceholder, setImage],
  );

  return (
    <div className="reader">
      <div className="reader__head">
        <button className="reader__back" onClick={onClose} aria-label="Back">
          <span aria-hidden="true">‹</span> Back
        </button>
        <div className="reader__title">
          <b>{title}</b>
          <span>
            {unit ? `Unit ${unit}` : "Material"} ·
            <em aria-label={`Page ${current} of ${pages}`}>
              {current} / {pages}
            </em>
          </span>
        </div>
        <div className="reader__zoom">
          <button
            className="reader__zoom-btn"
            onClick={zoomOut}
            aria-label="Zoom out"
          >
            &minus;
          </button>
          <button
            className="reader__zoom-btn reader__zoom-value"
            onClick={zoomFit}
            aria-label="Fit the page to the screen"
          >
            {zoomText}
          </button>
          <button
            className="reader__zoom-btn"
            onClick={zoomIn}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
        <span
          className="reader__progress"
          style={{ transform: `scaleX(${progress})` }}
          aria-hidden="true"
        />
      </div>

      <div className="reader__pages" ref={column}>
        {pageList}

        <div className="reader__end">
          <span>{unit ? `End of Unit ${unit}` : "End of material"}</span>
          <button className="reader__end-btn" onClick={onClose}>
            Back to units
          </button>
        </div>
      </div>
    </div>
  );
}
