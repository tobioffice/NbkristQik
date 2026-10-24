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
export interface PageWindow {
  /** Tell the window which pages the reader wants held. */
  setWanted: (pages: Set<number>) => void;
  /**
   * Fetch a page if it is not held yet, and set it on its image. `onDone`
   * hears whether the page made it, so the reader can offer a retry instead
   * of leaving a blank frame.
   */
  load: (
    page: number,
    image: HTMLImageElement,
    onDone?: (ok: boolean) => void,
  ) => Promise<void>;
  /** Release everything. Used when the app goes into the background. */
  releaseAll: () => void;
  /** How many pages are held right now. */
  held: () => number;
}

/** Pages kept in memory at once: what is on screen, plus spares. */
const HELD_PAGES = 12;

interface HeldPage {
  blob: Blob;
  url: string;
}

export const usePageWindow = (docId: string): PageWindow => {
  const held = useRef(new Map<number, HeldPage>());
  const inflight = useRef(new Set<number>());
  const images = useRef(new Map<number, HTMLImageElement>());
  const wanted = useRef(new Set<number>());
  const alive = useRef(true);

  /** Drop a page: the object URL goes, and the image gives its memory back. */
  const forget = useCallback((page: number) => {
    const entry = held.current.get(page);
    if (entry) URL.revokeObjectURL(entry.url);
    held.current.delete(page);
    const image = images.current.get(page);
    if (image) {
      image.removeAttribute("src");
      // the page box was drawn: when the page comes back, show the loading
      // state again rather than an empty sheet
      image.closest(".reader__page")?.classList.remove("reader__page--loaded");
    }
    images.current.delete(page);
  }, []);

  /** Show the held bytes in the page's image and wait for the render. */
  const draw = useCallback(
    async (page: number) => {
      const entry = held.current.get(page);
      const image = images.current.get(page);
      if (!entry || !image) return false;

      try {
        if (image.getAttribute("src") !== entry.url) {
          image.src = entry.url;
        }
        if (image.complete && image.naturalWidth > 0) {
        image.closest(".reader__page")?.classList.add("reader__page--loaded");
        return true;
      }
        await new Promise<void>((resolve, reject) => {
          const done = () => {
            image.removeEventListener("load", done);
            image.removeEventListener("error", fail);
            resolve();
          };
          const fail = () => {
            image.removeEventListener("load", done);
            image.removeEventListener("error", fail);
            reject(new Error(`page ${page} did not render`));
          };
          image.addEventListener("load", done);
          image.addEventListener("error", fail);
        });
        return image.naturalWidth > 0;
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

  const load = useCallback(
    async (
      page: number,
      image: HTMLImageElement,
      onDone?: (ok: boolean) => void,
    ) => {
      images.current.set(page, image);
      if (held.current.has(page)) {
        onDone?.(await draw(page));
        return;
      }
      if (inflight.current.has(page)) return;
      inflight.current.add(page);

      const attempt = async (): Promise<boolean> => {
        try {
          const res = await fetch(`/api/library/page/${docId}/${page}`);
          if (!res.ok) throw new Error(`page ${page} failed`);
          const blob = await res.blob();

          // the page may have scrolled away while it was loading
          if (!wanted.current.has(page)) return true;

          held.current.set(page, { blob, url: URL.createObjectURL(blob) });

          // keep the window small: the pages furthest from this one go first,
          // and never one the reader is looking at
          const over = held.current.size - HELD_PAGES;
          if (over > 0) {
            const candidates = [...held.current.keys()]
              .filter((p) => p !== page && !wanted.current.has(p))
              .sort((a, b) => Math.abs(b - page) - Math.abs(a - page));
            for (const old of candidates.slice(0, over)) forget(old);
          }

          return await draw(page);
        } catch {
          return false;
        }
      };

      try {
        let ok = await attempt();

        // one more try: a page that failed on a flaky line must not stay blank
        if (!ok && wanted.current.has(page) && alive.current) {
          await new Promise((resolve) => setTimeout(resolve, 700));
          ok = await attempt();
        }

        if (!alive.current) return;
        if (!ok) held.current.delete(page);
        onDone?.(ok);
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
    () => ({
      setWanted,
      load,
      releaseAll,
      held: () => held.current.size,
    }),
    [setWanted, load, releaseAll],
  );
};
