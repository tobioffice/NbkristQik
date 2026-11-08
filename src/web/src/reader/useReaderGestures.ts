import { useEffect, type RefObject } from "react";
import {
  FIT_ZOOM,
  pinchZoom,
  touchDistance,
  touchMidpoint,
  wheelZoom,
  type Point,
} from "../zoom";

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
 *
 * Three rules keep a pinch smooth in a webview:
 *
 *   - one zoom per animation frame, so a 120 Hz touch stream cannot force
 *     two layouts into one frame;
 *   - the ratio is always measured from the distance the fingers started at,
 *     so errors cannot accumulate over a long gesture;
 *   - every finger change re-anchors instead of ending the pinch, so a third
 *     finger, or lifting one of two, does not stop the zoom dead.
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

/**
 * How long a tap is ignored after a pinch ends. Without this, the half of a
 * double tap that came before the pinch pairs with the first tap after it and
 * the zoom jumps on its own.
 */
const PINCH_ECHO_MS = 350;

interface GestureOptions {
  /** The column the pages scroll in; wheel and double click land here. */
  column: RefObject<HTMLDivElement | null>;
  /** The zoom as it stands right now. */
  currentZoom: () => number;
  applyZoom: (next: number, focal?: Point) => void;
}

interface Pinch {
  /** Distance between the fingers when this gesture last anchored. */
  distance: number;
  /** The zoom at that same moment. */
  zoom: number;
}

export const useReaderGestures = ({
  column,
  currentZoom,
  applyZoom,
}: GestureOptions): void => {
  useEffect(() => {
    const element = column.current;
    if (!element) return;

    let pinch: Pinch | null = null;
    let tap: { x: number; y: number; at: number } | null = null;
    let touched = 0;
    let pinchedAt = 0;

    // The zoom is applied once per frame. A touch stream can deliver several
    // moves per frame, and each apply is a style write plus a layout read.
    let frame = 0;
    let pending: { zoom: number; focal: Point } | null = null;

    const flush = () => {
      frame = 0;
      const job = pending;
      pending = null;
      if (job) applyZoom(job.zoom, job.focal);
    };

    const schedule = (next: number, focal: Point) => {
      pending = { zoom: next, focal };
      if (!frame) frame = requestAnimationFrame(flush);
    };

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pending = null;
    };

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

    /** Start measuring the ratio from where the fingers are now. */
    const anchor = (touches: TouchList) => {
      const distance = distanceBetween(touches);
      if (distance <= 0) return;
      pinch = { distance, zoom: currentZoom() };
    };

    /** A double tap zooms in on the spot, and back out to fit if already in. */
    const toggleZoom = (focal: Point) => {
      applyZoom(currentZoom() > FIT_ZOOM ? FIT_ZOOM : READING_ZOOM, focal);
    };

    const onTouchStart = (e: TouchEvent) => {
      touched = Date.now();
      if (e.touches.length >= 2) {
        // a pinch is never the second half of a double tap
        tap = null;
        anchor(e.touches);
        return;
      }
      // a finger down on its own ends any pinch that was under way
      pinch = null;
    };

    const onTouchMove = (e: TouchEvent) => {
      const touches = e.touches;

      if (touches.length >= 2) {
        // a finger added mid-gesture anchors a fresh ratio rather than ending
        // the pinch; `e.touches.length` is 2..n
        if (!pinch) anchor(touches);
        if (!pinch || pinch.distance <= 0) return;

        // the document must not scroll under a pinch
        e.preventDefault();
        schedule(
          pinchZoom(pinch.zoom, pinch.distance, distanceBetween(touches)),
          midpointBetween(touches),
        );
        return;
      }

      // one finger that has travelled is a scroll, not half a double tap
      const finger = touches[0];
      if (tap && finger) {
        const drift = Math.hypot(
          finger.clientX - tap.x,
          finger.clientY - tap.y,
        );
        if (drift > DOUBLE_TAP_SLOP) tap = null;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        // still pinching: the pair that remains is the new baseline
        anchor(e.touches);
        return;
      }

      if (pinch) {
        // land the final frame before the fingers leave
        if (frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
        const job = pending;
        pending = null;
        if (job) applyZoom(job.zoom, job.focal);

        pinch = null;
        touched = Date.now();
        pinchedAt = Date.now();
        return;
      }

      const t = e.changedTouches[0];
      if (!t) return;
      // the double tap is a page gesture: a tap on the way back must not zoom,
      // and it must not leave half a double tap behind either
      if (!(e.target instanceof Node) || !element.contains(e.target)) {
        tap = null;
        return;
      }

      const now = Date.now();
      // the first tap after a pinch is not the second half of a double tap
      if (now - pinchedAt < PINCH_ECHO_MS) {
        tap = null;
        return;
      }

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
      stop();
      pinch = null;
      tap = null;
      touched = Date.now();
      pinchedAt = Date.now();
    };

    const onWheel = (e: WheelEvent) => {
      // an ordinary wheel scrolls the document; the browser's own zoom is
      // the reader's zoom, so it is taken over
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // line-based wheels report lines, not pixels
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      applyZoom(wheelZoom(currentZoom(), delta), {
        x: e.clientX,
        y: e.clientY,
      });
    };

    const onDoubleClick = (e: MouseEvent) => {
      if (Date.now() - touched < TOUCH_ECHO_MS) return;
      toggleZoom({ x: e.clientX, y: e.clientY });
    };

    // Safari's own gesture events zoom the whole page under a two-finger
    // pinch; the reader owns that gesture here
    const stopSafariGesture = (e: Event) => e.preventDefault();

    // the pinch is two fingers anywhere on the reader; the double tap and
    // the wheel are page gestures, so they stay on the pages
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: false });
    document.addEventListener("touchcancel", onTouchCancel, { passive: true });
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("dblclick", onDoubleClick);
    element.addEventListener("gesturestart", stopSafariGesture, {
      passive: false,
    });
    element.addEventListener("gesturechange", stopSafariGesture, {
      passive: false,
    });

    return () => {
      stop();
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchCancel);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("dblclick", onDoubleClick);
      element.removeEventListener("gesturestart", stopSafariGesture);
      element.removeEventListener("gesturechange", stopSafariGesture);
    };
  }, [column, currentZoom, applyZoom]);
};
