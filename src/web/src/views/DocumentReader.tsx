import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReaderViewport } from "../reader/useReaderViewport";
import { useReaderGestures } from "../reader/useReaderGestures";
import { useBackHandler } from "../backButton";
import ReaderPage from "../reader/ReaderPage";
import { usePageWindow } from "../usePageWindow";

interface DocumentReaderProps {
  docId: string;
  title: string;
  unit: string | null;
  pages: number;
  onClose: () => void;
}

/** Where the reader last stopped, per document. */
const stopKey = (docId: string) => `nbk:read:${docId}`;

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
 *
 * The moving parts live elsewhere: `useReaderViewport` owns the geometry and
 * the zoom, `useReaderGestures` the pinch and the wheel, `usePageWindow` the
 * pages themselves. What is left here is the reading experience.
 */
export default function DocumentReader({
  docId,
  title,
  unit,
  pages,
  onClose,
}: DocumentReaderProps) {
  const viewport = useReaderViewport(pages);
  const [current, setCurrent] = useState(1);
  const [failed, setFailed] = useState<Set<number>>(() => new Set());
  const [loaded, setLoaded] = useState<Set<number>>(() => new Set());

  /** A page whose image has drawn stops showing its skeleton. */
  const markDrawn = useCallback((page: number, drawn: boolean) => {
    setLoaded((previous) => {
      if (drawn === previous.has(page)) return previous;
      const next = new Set(previous);
      if (drawn) next.add(page);
      else next.delete(page);
      return next;
    });
  }, []);

  const pageWindow = usePageWindow(docId, markDrawn);

  const { columnRef, pageAtMiddle, setPlaceholder, jumpTo } = viewport;

  useReaderGestures({
    column: columnRef,
    currentZoom: viewport.currentZoom,
    applyZoom: viewport.applyZoom,
  });
  useBackHandler(onClose);

  /** Records whether a page drew, so a blank frame can offer a retry. */
  const mark = useCallback((page: number, ok: boolean) => {
    setFailed((previous) => {
      if (ok === !previous.has(page)) return previous;
      const next = new Set(previous);
      if (ok) next.delete(page);
      else next.add(page);
      return next;
    });
  }, []);

  const draw = useCallback(
    (page: number) => {
      void pageWindow.load(page).then((ok) => mark(page, ok));
    },
    [pageWindow, mark],
  );

  /** A failed page is retried by tapping its box. */
  const retry = useCallback(
    (page: number) => {
      mark(page, true);
      draw(page);
    },
    [draw, mark],
  );

  /** The image element for a page joins the window as its box appears. */
  const attachImage = useCallback(
    (page: number, element: HTMLImageElement | null) => {
      if (element) pageWindow.attach(page, element);
      else pageWindow.detach(page);
    },
    [pageWindow],
  );

  // which pages are wanted, and what to draw
  const onScreen = useRef<Set<number>>(new Set());
  useEffect(() => {
    const visible = onScreen.current;
    visible.clear();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (!page) continue;
          if (entry.isIntersecting) visible.add(page);
          else visible.delete(page);
        }

        // the window holds what is on screen, and lets go of what is not
        pageWindow.setWanted(new Set(visible));

        for (const page of visible) draw(page);
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

    const boxes = columnRef.current?.querySelectorAll(".reader__page");
    boxes?.forEach((box) => observer.observe(box));
    return () => observer.disconnect();
  }, [pageWindow, pageAtMiddle, draw, columnRef]);

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
      jumpTo(saved);
      setCurrent(saved);
    });
    return () => cancelAnimationFrame(frame);
  }, [docId, jumpTo]);

  // remember the place, so a call or the app switcher does not lose it
  useEffect(() => {
    sessionStorage.setItem(stopKey(docId), String(current));
  }, [docId, current]);

  // the Telegram app switcher must not keep a readable snapshot of the page
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        pageWindow.releaseAll();
        return;
      }

      // Coming back, the pages that were let go do not redraw by themselves:
      // nothing moved, so the observer has nothing to report, and the reader
      // sits in front of a screen of skeletons until it is scrolled.
      const again = new Set(onScreen.current);
      pageWindow.setWanted(again);
      for (const page of again) draw(page);
      setCurrent(pageAtMiddle());
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pageWindow, draw, pageAtMiddle]);

  /**
   * The pages.
   *
   * The list is built once and kept: a pinch changes the zoom every frame,
   * and the pages must not be rebuilt for that. Only the column's custom
   * property moves, and the browser does the rest.
   */
  const pageList = useMemo(
    () =>
      Array.from({ length: pages }, (_, index) => index + 1).map((page) => (
        <ReaderPage
          key={page}
          page={page}
          failed={failed.has(page)}
          loaded={loaded.has(page)}
          onRetry={retry}
          onBox={setPlaceholder}
          onImage={attachImage}
        />
      )),
    [pages, failed, loaded, retry, setPlaceholder, attachImage],
  );

  const progress = pages > 1 ? (current - 1) / (pages - 1) : 0;
  const unitLabel = unit ? `Unit ${unit}` : "Material";

  return (
    <div className="reader">
      <div className="reader__head">
        <button className="reader__back" onClick={onClose} aria-label="Back">
          <span aria-hidden="true">‹</span> Back
        </button>
        <div className="reader__title">
          <b>{title}</b>
          <span>
            {unitLabel} ·
            <em aria-label={`Page ${current} of ${pages}`}>
              {current} / {pages}
            </em>
          </span>
        </div>
        <div className="reader__zoom">
          <button
            className="reader__zoom-btn"
            onClick={viewport.zoomOut}
            aria-label="Zoom out"
          >
            &minus;
          </button>
          <button
            className="reader__zoom-btn reader__zoom-value"
            onClick={viewport.zoomFit}
            aria-label="Fit the page to the screen"
          >
            {viewport.zoomText}
          </button>
          <button
            className="reader__zoom-btn"
            onClick={viewport.zoomIn}
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

      <div className="reader__pages" ref={columnRef}>
        {pageList}

        <div className="reader__end">
          <span>{unit ? `End of ${unitLabel}` : "End of material"}</span>
          <button className="reader__end-btn" onClick={onClose}>
            Back to units
          </button>
        </div>
      </div>
    </div>
  );
}
