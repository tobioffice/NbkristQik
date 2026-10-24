import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * The page window.
 *
 * A subject unit is a hundred-odd pages. The reader must not hold them: the
 * browser would keep every blob, and a student could pull the lot out of the
 * network tab. So the reader keeps a small window of pages around the one
 * being read, and everything outside it is dropped and its image released.
 *
 * The reader says which pages it wants (the ones on screen, plus a screen
 * either side so pages arrive before they are needed). The window never
 * drops a page the reader is looking at: that was the bug that left blank
 * frames on the screen, because a page that is cleared while it is still in
 * view is never redrawn — the observer has nothing to report.
 */

/** Pages kept in memory at once: what is on screen, plus spares. */
const HELD_PAGES = 12;

/** A page that never finishes decoding is dropped, not waited on forever. */
const RENDER_TIMEOUT_MS = 15_000;

/** One more try before the reader is told the page failed. */
const RETRY_AFTER_MS = 700;

export interface PageWindow {
  /** Tell the window which pages the reader wants held. */
  setWanted: (pages: Set<number>) => void;
  /** Register the image element that will show a page. */
  attach: (page: number, image: HTMLImageElement) => void;
  /** Forget an image element, when its box leaves the screen. */
  detach: (page: number) => void;
  /**
   * Fetch a page if it is not held yet and draw it. Resolves false when the
   * page could not be shown, so the reader can offer a retry instead of
   * leaving a blank frame.
   */
  load: (page: number) => Promise<boolean>;
  /** Release everything. Used when the app goes into the background. */
  releaseAll: () => void;
}

interface HeldPage {
  blob: Blob;
  url: string;
}

/** Resolves when the image has drawn, rejects when it never will. */
const waitForRender = (
  image: HTMLImageElement,
  page: number,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      image.removeEventListener("load", done);
      image.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      clearTimeout(timer);
      image.removeEventListener("load", done);
      image.removeEventListener("error", fail);
      reject(new Error(`page ${page} did not render`));
    };
    // the load event may already have fired between the check and this call
    const timer = setTimeout(() => fail(), RENDER_TIMEOUT_MS);
    image.addEventListener("load", done);
    image.addEventListener("error", fail);
  });

export const usePageWindow = (docId: string): PageWindow => {
  const held = useRef(new Map<number, HeldPage>());
  const inflight = useRef(new Set<number>());
  const images = useRef(new Map<number, HTMLImageElement>());
  const wanted = useRef(new Set<number>());
  const alive = useRef(true);

  /**
   * Drop a page: the object URL goes, and the image gives its memory back.
   *
   * The box goes back to its skeleton, because a page that comes back later
   * has to draw again — the browser has nothing left to show, and a blank
   * sheet with no loading state reads as a broken document.
   */
  const forget = useCallback((page: number) => {
    const entry = held.current.get(page);
    if (entry) URL.revokeObjectURL(entry.url);
    held.current.delete(page);

    const image = images.current.get(page);
    if (image) {
      image.removeAttribute("src");
      image.closest(".reader__page")?.classList.remove("reader__page--loaded");
    }
  }, []);

  /** Show the held bytes in the page's image and wait for the render. */
  const draw = useCallback(
    async (page: number): Promise<boolean> => {
      const entry = held.current.get(page);
      const image = images.current.get(page);
      if (!entry || !image) return false;

      const box = image.closest(".reader__page");
      try {
        if (image.getAttribute("src") !== entry.url) image.src = entry.url;
        if (!image.complete || image.naturalWidth === 0) {
          await waitForRender(image, page);
        }

        const drawn = image.naturalWidth > 0;
        // the skeleton must go, or it shows through the page's empty space
        box?.classList.toggle("reader__page--loaded", drawn);
        if (!drawn) forget(page);
        return drawn;
      } catch {
        // a page that will not decode is dropped rather than left half drawn
        forget(page);
        return false;
      }
    },
    [forget],
  );

  const setWanted = useCallback(
    (pages: Set<number>) => {
      // anything that dropped out of the window is let go
      for (const page of [...wanted.current]) {
        if (!pages.has(page)) forget(page);
      }
      wanted.current = pages;
    },
    [forget],
  );

  const attach = useCallback((page: number, image: HTMLImageElement) => {
    images.current.set(page, image);
  }, []);

  const detach = useCallback((page: number) => {
    images.current.delete(page);
  }, []);

  const load = useCallback(
    async (page: number): Promise<boolean> => {
      if (held.current.has(page)) return draw(page);
      // a fetch for this page is already running and will report its result
      if (inflight.current.has(page)) return true;
      inflight.current.add(page);

      /** Keeps the window small: the pages furthest from this one go first. */
      const releaseDistant = (page: number) => {
        const over = held.current.size - HELD_PAGES;
        if (over <= 0) return;

        const candidates = [...held.current.keys()]
          .filter((other) => other !== page && !wanted.current.has(other))
          .sort((a, b) => Math.abs(b - page) - Math.abs(a - page));
        for (const old of candidates.slice(0, over)) forget(old);
      };

      const fetchPage = async (): Promise<boolean> => {
        try {
          const res = await fetch(`/api/library/page/${docId}/${page}`);
          if (!res.ok) throw new Error(`page ${page} failed`);
          const blob = await res.blob();

          // the page may have scrolled away while it was loading
          if (!wanted.current.has(page)) return true;

          held.current.set(page, { blob, url: URL.createObjectURL(blob) });
          releaseDistant(page);
          return await draw(page);
        } catch {
          return false;
        }
      };

      try {
        let ok = await fetchPage();

        // a page that failed on a flaky line must not stay blank
        if (!ok && wanted.current.has(page) && alive.current) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
          ok = await fetchPage();
        }

        if (!alive.current) return false;
        if (!ok) held.current.delete(page);
        return ok;
      } finally {
        inflight.current.delete(page);
      }
    },
    [docId, draw, forget],
  );

  const releaseAll = useCallback(() => {
    for (const page of [...held.current.keys()]) forget(page);
    wanted.current = new Set();
  }, [forget]);

  // a document change must not leave the last one's pages in memory
  useEffect(() => {
    alive.current = true;
    const pages = held.current;
    const pageImages = images.current;
    const pageWanted = wanted.current;
    return () => {
      alive.current = false;
      for (const entry of pages.values()) URL.revokeObjectURL(entry.url);
      pages.clear();
      pageImages.clear();
      pageWanted.clear();
    };
  }, [docId]);

  return useMemo(
    () => ({ setWanted, attach, detach, load, releaseAll }),
    [setWanted, attach, detach, load, releaseAll],
  );
};
