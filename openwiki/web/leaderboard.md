---
type: frontend
title: Web Leaderboard
description: The React + Vite + Tailwind Telegram Mini Apps in src/web — the leaderboard register with infinite scroll and Telegram identity, plus the standalone profile and report pages, sharing one identity hook and API base.
tags: [frontend, react, vite, tailwind, telegram-web-app]
sources:
  - id: openwiki-source-ca9eabc24825e6ff0edc2967
    resource: repo://DESIGN.md
  - id: openwiki-source-e9ea5e902b3d8efac528eb9f
    resource: repo://src/web/package.json
  - id: openwiki-source-aaa8426155484904025fc71f
    resource: repo://src/web/register.html
  - id: openwiki-source-3304a6e6fe2640bcda3332b9
    resource: repo://src/web/report.html
  - id: openwiki-source-682d93863f1b38058baba098
    resource: repo://src/web/src/api.ts
  - id: openwiki-source-65389bbfdc75168642d5f2ba
    resource: repo://src/web/src/App.tsx
  - id: openwiki-source-d426ef2e050352d2dd0d4e09
    resource: repo://src/web/src/components/Band.tsx
  - id: openwiki-source-b5c981b81097f116a5f0a03c
    resource: repo://src/web/src/components/Podium.tsx
  - id: openwiki-source-2f59ce522e230684cf349681
    resource: repo://src/web/src/components/TheLine.tsx
  - id: openwiki-source-09b79904e1465aba03a49169
    resource: repo://src/web/src/constants.ts
  - id: openwiki-source-9871b4132baee0eb322fc134
    resource: repo://src/web/src/format.ts
  - id: openwiki-source-091363086d146719f4c5f3fc
    resource: repo://src/web/src/Leaderboard.tsx
  - id: openwiki-source-0bbeaa20c8800f737c91820c
    resource: repo://src/web/src/register-main.tsx
  - id: openwiki-source-0e9611183fa0a84356f7bdd2
    resource: repo://src/web/src/report-main.tsx
  - id: openwiki-source-b968bb7a54de8ad3566b2b15
    resource: repo://src/web/src/ReportApp.tsx
  - id: openwiki-source-16af679f49cabaa02bc32312
    resource: repo://src/web/src/useLeaderboard.ts
  - id: openwiki-source-db479441b27a5f3da1be68f7
    resource: repo://src/web/src/useTelegramIdentity.ts
  - id: openwiki-source-4b4ffafa2b80a042014fafbc
    resource: repo://src/web/src/useTelegramUser.ts
  - id: openwiki-source-73d3563b23c926309c9b707d
    resource: repo://src/web/vite.config.ts
generated: { by: "opencode", at: "2026-10-15T21:12:57.495Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-15T21:12:57.495Z
---

# Web Leaderboard

`src/web/` is a self-contained React 19 + Vite + Tailwind package serving **three Telegram Mini App pages** from one build:

- `index.html` → the leaderboard (`App.tsx` wrapping `Leaderboard.tsx`), registered in BotFather as the `nbkristqik_leaderboard` mini app.
- `register.html` → the standalone registration/profile form (`ProfileApp.tsx`), documented in [Registration and Profile](../registration.md).
- `report.html` → the issue reporter and thread view (`ReportApp.tsx`).

All three share the "Class Register, Open on the Desk" design language (`DESIGN.md`) and the same `Band` head band. The package has its own `package.json`, lockfile, tests, and Vitest config, and is built and deployed separately from the backend.

## API base and dev proxy

`API_BASE` (`src/web/src/api.ts`) resolves as:

1. `VITE_API_URL` if set — always wins.
2. In dev (`import.meta.env.DEV`) an empty string, making requests same-origin; `vite.config.ts:17-23` proxies `/api` to `http://localhost:3000` so a locally running backend needs no CORS or env juggling.
3. In production `https://checker.tobioffice.dev`.

`buildLeaderboardUrl` always sends `page`, `limit=20` (`PAGE_SIZE`), `sort`, and the three filters as query parameters; `search` is only appended when non-empty. `buildMeUrl` sends `userId` plus the Telegram `initData` when available. Endpoint behavior is documented in [REST API and Security](../api/server.md).

## Data layer

### `useLeaderboard`

`src/web/src/useLeaderboard.ts` owns fetching, pagination, and request lifecycle:

- State covers rows, total, page, `loading`, `initialLoading`, `error`, and `hasMore`.
- **Query changes** (sort, stable-identity filters object, debounced search) reset page/rows and refetch page 1 in an effect.
- **Pagination** — a second effect fetches whenever `page > 1`; `lastElementRef` attaches an `IntersectionObserver` so the sentinel row entering the viewport increments the page. The ref callback re-creates the observer whenever `loading` or `hasMore` changes.
- **Abort and staleness** — every fetch aborts the previous request via `AbortController` and bumps a `reqId` counter; responses and errors check the id before touching state, so a superseded page can never append stale rows or clear the loading flag. A 15-second timeout aborts hung requests.
- The response parser accepts both `data.data` (array) and `data.data.{rows,total}` shapes and marks `hasMore` false on an empty page or when fewer than `PAGE_SIZE` rows return.
- `retry()` resets to page 1 and refetches.

### `useTelegramIdentity` and `useTelegramUser`

`src/web/src/useTelegramIdentity.ts` is the shared identity source for all three pages: it reads the Telegram WebApp SDK once via a lazy `useState` initializer (the SDK is injected before the bundle runs), exposing `tgUser` (the raw id) and `initData`; both are null outside the Telegram webview.

`src/web/src/useTelegramUser.ts` builds on it for the leaderboard's own-rank bracket:

1. No Telegram user → returns immediately — outside the webview there is no "you" to find.
2. Fetches `/api/me` with `userId` and `initData`; when the payload reports `found`, it sets `myRoll` and both ranks (attendance and midmarks, each nullable).

The server only trusts the `userId` because it is carried inside cryptographically verified `initData` (see the API page).

## UI composition

`App.tsx` is the page frame: it wraps the register sheet and adds the docked **"My profile"** tab that opens the profile page on GitHub Pages (`PROFILE_URL` from `constants.ts`, `src/web/src/App.tsx:10-29`). `Leaderboard.tsx` owns `sortBy`, the three filters, and a debounced search input (400 ms); a `useMemo` keeps the filters object identity stable so the fetch effect only fires on real filter changes (`src/web/src/Leaderboard.tsx:21-37`).

Layout, top to bottom (`src/web/src/Leaderboard.tsx:92-183`):

- `Band` — the shared cloth head band: wordmark, the "Attendance register" context line, and a stamp block with the total student count.
- **Own-rank strip** — the viewer's bracketed roll and rank for the active sort, shown only when `myRoll` and a rank exist and no filter or search is active (the rank is global).
- `SortTabs` — Attendance / Mid Marks toggle.
- **Controls** — `SearchBar` bound to the raw search text, plus `FilterBar` with three selects: year (11/21/31/41 + all), branch (from a local `BRANCHES` copy), and section (A–J plus `-`).
- `Podium` — the top three merit entries, hidden while searching; the list below skips them when the podium is visible (`podiumVisible` / `listStats`, `src/web/src/Leaderboard.tsx:64-65`).
- The infinite-scroll register list with its head row (Rnk / Roll / Name / Att % or Mid avg) and one `StudentRow` per student. `TheLine` — the 75% minimum — is drawn between the last row at or above the rule and the first below it (`TheLine.tsx`).
- `FeedbackStates` pieces — `SkeletonRows`, `ErrorState` with retry, `LoadingSpinner`, `EmptyState`, and the end note.

`Podium.tsx` renders the top three as merit entries in second–left / first–center / third–right order with the active sort's score, strikes through a tied rank on the second or third card, and prints how many students tie at #1 (`src/web/src/components/Podium.tsx:12-77`). `StudentRow.tsx` highlights the current user (`isMe`), wires the sentinel ref on the last row, and uses tie-aware rank badges from `format.ts`, so identical ranks share a badge color — mirroring the backend's `RANK()` semantics. `formatScore` renders two decimals for attendance and one for mid-marks, with `-` for missing values.

The `isMe` call site is guarded as `myRoll != null && stat.roll_no === myRoll` (`src/web/src/Leaderboard.tsx:160-163`): without the guard, an unidentified viewer (`myRoll = null`) would match every ghost row (`roll_no = null`) via `null === null` and highlight them all as "You". The backend's inner join excludes ghost rows too, so the guard is belt-and-braces.

`constants.ts` duplicates the backend branch map (`BRANCHES`) with a comment explaining the copy — the web build must not reach into backend source layout — and derives the three mini app URLs (`WEBAPP_URL`, `PROFILE_URL`, `REPORT_URL`) from a `PAGES_ROOT` that defaults to the GitHub Pages origin.

## Build and deployment

`src/web/package.json` scripts: `dev` (Vite), `build` (`tsc -b && vite build`), `lint`, `test` (Vitest over `src/web/tests`), `preview`, and `deploy` (`gh-pages -d dist`). The Vite config declares the three HTML entries (`index.html`, `register.html`, `report.html`) in `build.rollupOptions.input`. Built assets land in `src/web/dist/` and all three pages publish to GitHub Pages; the site origin (`https://tobioffice.github.io`) is in the API's CORS allowlist (`CORS_ORIGINS` default).

## Related pages

- [REST API and Security](../api/server.md)
- [Registration and Profile](../registration.md)
- [Admin Panel](../api/admin-panel.md)
- [Caching and Leaderboard Stats](../data/caching-and-stats.md)
