---
type: reference
title: Library Reader Mini App
description: The React library reader in src/web — page boxes, the twelve-page window and why pages are dropped, the zoom geometry, the touch gestures, the remembered position and the Telegram back button.
tags: [library, react, reader, svg, zoom, mobile]
sources:
  - id: openwiki-source-a7cc3bce3c9730332b62de43
    resource: repo://src/web/src/AppShell.tsx
  - id: openwiki-source-7eaff86001c42e80b5bd13cd
    resource: repo://src/web/src/backButton.ts
  - id: openwiki-source-2569a53265dd0948512396cc
    resource: repo://src/web/src/index.css
  - id: openwiki-source-e25041d02a0c96eda353d552
    resource: repo://src/web/src/pagePosition.ts
  - id: openwiki-source-3ef4377324141036639854b3
    resource: repo://src/web/src/reader/ReaderPage.tsx
  - id: openwiki-source-56b756727dbd9888348f8302
    resource: repo://src/web/src/reader/useReaderGestures.ts
  - id: openwiki-source-2dc47d07279c3fb5f23a010f
    resource: repo://src/web/src/reader/useReaderViewport.ts
  - id: openwiki-source-73209936fc6edb7dfe8fc83e
    resource: repo://src/web/src/telegram.ts
  - id: openwiki-source-6790efc761dabf796dc8a963
    resource: repo://src/web/src/useLibrary.ts
  - id: openwiki-source-ce8684690bae1b6907a286e2
    resource: repo://src/web/src/usePageWindow.ts
  - id: openwiki-source-a5b7b675cc1feb110b1cb540
    resource: repo://src/web/src/views/DocumentReader.tsx
  - id: openwiki-source-eaddaf398932b4a18de1234b
    resource: repo://src/web/src/views/LibraryView.tsx
  - id: openwiki-source-ef460c62687db1503bf61332
    resource: repo://src/web/src/zoom.ts
generated: { by: "opencode", at: "2026-10-24T11:41:29.189Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-24T11:41:29.189Z
---

# Library Reader Mini App

The reader is the deepest screen of the app (`app.html` → `AppShell.tsx`), built by `vite.library.config.ts` and served from `/library` by the same Express host as its API. It opens from the shelf (`views/LibraryView.tsx`): the shelf hands over, the shell hides its band and tab rail, and the reader takes the sheet. It is split into modules so each part can be held in the head on its own.

| Module | Owns |
|---|---|
| `views/DocumentReader.tsx` | The reading experience: which pages to draw, the counter, the head, the end card |
| `reader/useReaderViewport.ts` | Geometry and zoom: page-at-a-point, `applyZoom`, the zoom buttons, the label |
| `reader/useReaderGestures.ts` | Pinch, double tap, wheel and the mouse double click |
| `reader/ReaderPage.tsx` | One page box: its shape, its skeleton, its image |
| `usePageWindow.ts` | The page cache: fetch, hold, draw, drop |
| `backButton.ts` | The Telegram arrow, as a stack: the reader closes before the section does |

## The shelf

`views/LibraryView.tsx` walks the states in order: loading, a closed shelf (the API refused because `LIBRARY_ACCESS` is still `admin`), unregistered (a roll form that posts to the same `/api/register` the profile page uses), and ready. Every state is printed under the shell's page head, so the states cannot drift apart; in the ready state the shelf publishes its ready-subject count into the band stamp.

A subject opens to its units, and a unit opens the reader with the subject name, the unit and the page count. `useLibrary` does one request pair — open the session, then read the shelf — and `retry` re-runs both, because a session can go stale between two looks. A "not open yet" refusal is a state, not an error: it renders as "The library opens soon".

## Why a page window

A unit is a hundred-odd pages. Holding them all would keep every blob in memory and let anyone pull the lot out of the network tab. `usePageWindow` therefore keeps at most twelve pages:

- The reader says which pages it wants — the ones on screen plus a screen and a half either side, reported by an `IntersectionObserver` with `rootMargin: "120% 0px"`.
- A page outside the wanted set is dropped: its object URL is revoked and its image loses its `src`.
- The window never drops a page the reader is looking at. A page cleared while still in view is never redrawn — the observer has nothing to report — and that was the bug that left blank frames on the screen.
- When the app goes into the background (`visibilitychange` → `hidden`), everything is released, so the Telegram app switcher cannot keep a readable snapshot.

Each page is fetched once, with one retry after 700 ms on a flaky line, and has a 15-second render timeout so a page that never decodes is dropped instead of blocking the window. A failed page leaves its box tappable, and tapping retries it.

## Page boxes

`ReaderPage` draws the box before the page exists: the aspect ratio (`1 / 1.414`, A4) gives the column its height from the first frame, so the scrollbar is honest and a student can jump to page ninety before page two has arrived. The box holds the page number and a "Loading" label; once the SVG draws, the box gets `reader__page--loaded` and the skeleton is hidden — it has to be hidden, because an SVG page is transparent where the PDF has no ink and the skeleton would otherwise show through the text.

The image is not draggable, not selectable and has no context menu, so a long press cannot save a page out of the reader.

## Zoom

Zoom is a change of size, not of pixels: the page is a vector, so the browser redraws it sharp at any size without the server sending anything else.

- The zoom lives in a ref, not in state, and is written onto the column as a `--zoom` custom property. A pinch changes it every frame; the page list must not re-render for that. Only the label (`100%`, `150%`, …) is state, because it is printed.
- `applyZoom(next, focal)` holds the point under the finger still: it measures that point in fit-width pixels before the zoom, then scrolls by the distance the point travelled (`pointInPage`, `scrollToHold` in `zoom.ts`).
- The buttons walk a fixed ladder (`0.8 … 3` in `zoom.ts`) rather than multiplying, and they anchor on the middle of the screen, not the page corner, so the words being read stay under the eyes.

`useReaderViewport` also answers "which page is at the middle of the screen": every box is the same size, so two measurements give the step and the page is arithmetic (`pageAtMiddle` in `pagePosition.ts`) instead of a walk over a hundred elements on every scroll frame. Both the page counter and the zoom anchor use that same measurement.

## Gestures

`useReaderGestures` attaches its listeners natively rather than through React, because React listens to touch move passively and a passive listener cannot stop the document scrolling under a pinch.

- **Pinch** — two fingers anywhere on the reader. The zoom is the starting zoom times the change in finger distance, anchored at the midpoint.
- **Double tap** — two taps within 400 ms and 48 px, on the pages only, so a double tap on the way back does not zoom. It zooms to 250% on the spot, or back to fit if already zoomed in.
- **Ctrl/⌘ + wheel** — the browser's own zoom is taken over and mapped onto the reader's zoom, anchored at the cursor.
- **Mouse double click** — the same as a double tap, ignored for 500 ms after a touch so the browser's synthetic events do not zoom twice.

## Position and the back button

The reader remembers where the student stopped per document in `sessionStorage` (`nbk:read:{docId}`), restoring anything past page one on open and writing the current page as they scroll. That survives a phone call or the app switcher within the session, and leaves nothing behind afterwards.

`useBackHandler` (`src/web/src/backButton.ts`) registers the reader on the app's back stack while it is mounted, so the Telegram arrow closes the reader first and only then leaves the library section; the button hides itself when the stack is empty, and outside Telegram there is nothing to wire. The reader's own "Back" button and the end card's "Back to units" call the same `onClose`.

## Related pages

- [Library Subsystem](overview.md)
- [Library API and Session](api.md)
- [Web Mini Apps](../web/leaderboard.md)
