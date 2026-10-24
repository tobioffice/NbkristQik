import { useEffect, type RefObject } from "react";
import { FIT_ZOOM, touchDistance, touchMidpoint, type Point } from "../zoom";

/**
 * Pinch, double tap and the wheel.
 *
 * These are attached natively rather than through React, because React
 * listens to touch move passively, and a passive listener cannot stop the
 * document from scrolling under a pinch. The reader has to be the one that
 * moves.
 *
 * The pinch listens on the whole document, not only on the pages: two fingers
 * are the gesture, and a student who starts one on the head band still means
 * it. The double tap stays on the pages, so a double tap on the way back does
 * not zoom.
 */

/** The zoom a double tap lands on: close enough to read a formula. */
const READING_ZOOM = 2.5;

/** Two taps closer together than this, in milliseconds, are one double tap. */
const DOUBLE_TAP_MS = 400;

/** How far a tap may drift and still count as a double tap, in pixels. */
const DOUBLE_TAP_SLOP = 48;

/**
 * How long after a touch the browser's synthetic click and double click keep
 * arriving: a touch double tap has already zoomed, so the mouse handler has
 * to ignore them.
 */
const TOUCH_ECHO_MS = 500;

/** The wheel's step: one notch is ten per cent. */
const WHEEL_STEP = 1.1;

interface GestureOptions {
  /** The column the pages scroll in; wheel and double click land here. */
  column: RefObject<HTMLDivElement | null>;
  /** The zoom as it stands right now. */
  currentZoom: () => number;
  applyZoom: (next: number, focal?: Point) => void;
}

export const useReaderGestures = ({
  column,
  currentZoom,
  applyZoom,
}: GestureOptions): void => {
  useEffect(() => {
    const element = column.current;
    if (!element) return;

    let pinch: { distance: number; zoom: number } | null = null;
    let tap: { x: number; y: number; at: number } | null = null;
    let touched = 0;

    const distanceBetween = (touches: TouchList): number =>
      touchDistance(
        { x: touches[0].clientX, y: touches[0].clientY },
        { x: touches[1].clientX, y: touches[1].clientY },
      );

    const midpointBetween = (touches: TouchList): Point =>
      touchMidpoint(
        { x: touches[0].clientX, y: touches[0].clientY },
        { x: touches[1].clientX, y: touches[1].clientY },
      );

    /** A double tap zooms in on the spot, and back out to fit if already in. */
    const toggleZoom = (focal: Point) => {
      applyZoom(currentZoom() > FIT_ZOOM ? FIT_ZOOM : READING_ZOOM, focal);
    };

    const onTouchStart = (e: TouchEvent) => {
      touched = Date.now();
      if (e.touches.length === 2) {
        pinch = { distance: distanceBetween(e.touches), zoom: currentZoom() };
        return;
      }
      // a finger down on its own ends any pinch that was under way
      pinch = null;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch || pinch.distance <= 0) return;
      // the document must not scroll under a pinch
      e.preventDefault();
      const scale = distanceBetween(e.touches) / pinch.distance;
      applyZoom(pinch.zoom * scale, midpointBetween(e.touches));
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
      if (!(e.target instanceof Node) || !element.contains(e.target)) return;

      const now = Date.now();
      const isDoubleTap =
        tap !== null &&
        now - tap.at < DOUBLE_TAP_MS &&
        Math.hypot(t.clientX - tap.x, t.clientY - tap.y) < DOUBLE_TAP_SLOP;

      if (!isDoubleTap) {
        tap = { x: t.clientX, y: t.clientY, at: now };
        return;
      }

      e.preventDefault();
      toggleZoom({ x: t.clientX, y: t.clientY });
      tap = null;
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
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      applyZoom(currentZoom() * factor, { x: e.clientX, y: e.clientY });
    };

    const onDoubleClick = (e: MouseEvent) => {
      if (Date.now() - touched < TOUCH_ECHO_MS) return;
      toggleZoom({ x: e.clientX, y: e.clientY });
    };

    // the pinch is two fingers anywhere on the reader; the double tap and
    // the wheel are page gestures, so they stay on the pages
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: false });
    document.addEventListener("touchcancel", onTouchCancel, { passive: true });
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("dblclick", onDoubleClick);

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchCancel);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("dblclick", onDoubleClick);
    };
  }, [column, currentZoom, applyZoom]);
};
