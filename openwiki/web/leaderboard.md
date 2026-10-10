---
type: frontend
title: Web Leaderboard
description: The React + Vite + Tailwind Telegram Web Apps in src/web — the leaderboard page with infinite scroll and Telegram identity, plus the standalone profile page, sharing one identity hook and API base.
tags: [frontend, react, vite, tailwind, telegram-web-app]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-09T23:13:13.880Z
sources:
  - id: openwiki-source-e9ea5e902b3d8efac528eb9f
    resource: repo://src/web/package.json
  - id: openwiki-source-aaa8426155484904025fc71f
    resource: repo://src/web/register.html
  - id: openwiki-source-682d93863f1b38058baba098
    resource: repo://src/web/src/api.ts
  - id: openwiki-source-b5c981b81097f116a5f0a03c
    resource: repo://src/web/src/components/Podium.tsx
  - id: openwiki-source-09b79904e1465aba03a49169
    resource: repo://src/web/src/constants.ts
  - id: openwiki-source-9871b4132baee0eb322fc134
    resource: repo://src/web/src/format.ts
  - id: openwiki-source-091363086d146719f4c5f3fc
    resource: repo://src/web/src/Leaderboard.tsx
  - id: openwiki-source-0bbeaa20c8800f737c91820c
    resource: repo://src/web/src/register-main.tsx
  - id: openwiki-source-16af679f49cabaa02bc32312
    resource: repo://src/web/src/useLeaderboard.ts
  - id: openwiki-source-db479441b27a5f3da1be68f7
    resource: repo://src/web/src/useTelegramIdentity.ts
  - id: openwiki-source-4b4ffafa2b80a042014fafbc
    resource: repo://src/web/src/useTelegramUser.ts
  - id: openwiki-source-73d3563b23c926309c9b707d
    resource: repo://src/web/vite.config.ts
generated: { by: "opencode", at: "2026-10-09T23:13:13.880Z" }
---

# Web Leaderboard

`src/web/` is a self-contained React 19 + Vite + Tailwind package serving **two Telegram Mini App pages** from one build:

- `index.html` → the leaderboard (`Leaderboard.tsx`), registered in BotFather as the `nbkristqik_leaderboard` mini app
- `register.html` → the standalone registration/profile form (`ProfileApp.tsx`), documented in [Registration and Profile](../registration.md)

The package has its own `package.json`, lockfile, tests, and Vitest config, and is built and deployed separately from the backend.

## API base and dev proxy

`API_BASE` (`src/web/src/api.ts`) resolves as:

1. `VITE_API_URL` if set — always wins.
2. In dev (`import.meta.env.DEV`) an empty string, making requests same-origin; `vite.config.ts` proxies `/api` to `http://localhost:3000` so a locally running backend needs no CORS or env juggling.
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

`src/web/src/useTelegramIdentity.ts` is the shared identity source for both pages: it reads the Telegram WebApp SDK once via a lazy `useState` initializer (the SDK is injected before the bundle runs), exposing `tgUser` (the raw id) and `initData`; both are null outside the Telegram webview.

`src/web/src/useTelegramUser.ts` builds on it for the leaderboard's "You are #N":

1. No Telegram user → returns immediately — outside the webview there is no "you" to find.
2. Fetches `/api/me` with `userId` and `initData`; when the payload reports `found`, it sets `myRoll` and both ranks (attendance and midmarks, each nullable).

The server only trusts the `userId` because it is carried inside cryptographically verified `initData` (see the API page).

## UI composition

`Leaderboard.tsx` is the shell: it owns `sortBy`, the three filters, and a debounced search input (400 ms). A `useMemo` keeps the filters object identity stable so the fetch effect only fires on real filter changes.

Layout, top to bottom:

- Header with a gradient "Leaderboard" title and the total student count.
- `SearchBar` — controlled input bound to the raw search text.
- **"You are #N" banner** — shown only when `myRoll` and a rank for the active sort exist and no filter or search is active (the rank is global).
- `SortTabs` — Attendance / Mid Marks toggle styled with indigo vs emerald gradients.
- `FilterBar` — three selects: year (11/21/31/41 + all), branch (from a local `BRANCHES` copy), and section (A–J plus `-`).
- `Podium` — the top three cards, hidden while searching.
- The infinite-scroll list of `StudentRow`s, with `FeedbackStates` handling skeletons, spinner, error state with retry, empty state, and end note.
- A floating **"👤 My profile"** link that opens the separate profile page (`PROFILE_URL` in `constants.ts`).

`Podium.tsx` holds `VARIANTS` for gold/silver/bronze (with `strikeWhenRank` used to strike through a tied rank on the silver/bronze cards) and shows the attendance percentage or the mid-marks average with the matching accent color. `StudentRow.tsx` highlights the current user (`isMe`), wires the sentinel ref on the last row, and uses `rankBadgeClass` from `format.ts` so **identical ranks share the same badge color** — mirroring the tie-aware ranks computed by the backend. `formatScore` renders two decimals for attendance and one for mid-marks, with `-` for missing values.

The `isMe` call site is guarded as `myRoll != null && stat.roll_no === myRoll`: without the guard, an unidentified viewer (`myRoll = null`) would match every ghost row (`roll_no = null`) via `null === null` and highlight them all as "You". The backend's inner join now excludes ghost rows too, so the guard is belt-and-braces.

`constants.ts` duplicates the backend branch map (`BRANCHES`) with a comment explaining the copy — the web build must not reach into backend source layout — and derives the two mini app URLs (`WEBAPP_URL`, `PROFILE_URL`) from a `PAGES_ROOT` that defaults to the GitHub Pages origin.

## Build and deployment

`src/web/package.json` scripts: `dev` (Vite), `build` (`tsc -b && vite build`), `lint`, `test` (Vitest over `src/web/tests`), `preview`, and `deploy` (`gh-pages -d dist`). The Vite config declares both HTML entries in `build.rollupOptions.input`. Built assets land in `src/web/dist/` and both pages publish to GitHub Pages; the site origin (`https://tobioffice.github.io`) is in the API's CORS allowlist (`CORS_ORIGINS` default).

## Related pages

- [REST API and Security](../api/server.md)
- [Registration and Profile](../registration.md)
- [Admin Panel](../api/admin-panel.md)
- [Caching and Leaderboard Stats](../data/caching-and-stats.md)
