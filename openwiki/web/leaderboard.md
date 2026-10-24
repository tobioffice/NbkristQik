---
type: reference
title: Web App
description: The one app in src/web — the index page, the tab rail and hash routes, the shared cloth band and its stamp, the Telegram accessor, the back-button stack, and the standalone pages kept for compatibility.
tags: [web, react, app-shell, routing, telegram, design]
sources:
  - id: openwiki-source-ca9eabc24825e6ff0edc2967
    resource: repo://DESIGN.md
  - id: openwiki-source-87c47a793c4a631e2439348f
    resource: repo://src/constants/webapp.ts
  - id: openwiki-source-d44d4e21369fc6c9f6881c2c
    resource: repo://src/web/app.html
  - id: openwiki-source-e9ea5e902b3d8efac528eb9f
    resource: repo://src/web/package.json
  - id: openwiki-source-aaa8426155484904025fc71f
    resource: repo://src/web/register.html
  - id: openwiki-source-682d93863f1b38058baba098
    resource: repo://src/web/src/api.ts
  - id: openwiki-source-65389bbfdc75168642d5f2ba
    resource: repo://src/web/src/App.tsx
  - id: openwiki-source-a7cc3bce3c9730332b62de43
    resource: repo://src/web/src/AppShell.tsx
  - id: openwiki-source-7eaff86001c42e80b5bd13cd
    resource: repo://src/web/src/backButton.ts
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
  - id: openwiki-source-8f388db48606a2a9e7334d65
    resource: repo://src/web/src/http.ts
  - id: openwiki-source-091363086d146719f4c5f3fc
    resource: repo://src/web/src/Leaderboard.tsx
  - id: openwiki-source-1658283cd619b2587565b508
    resource: repo://src/web/src/libraryApi.ts
  - id: openwiki-source-0bbeaa20c8800f737c91820c
    resource: repo://src/web/src/register-main.tsx
  - id: openwiki-source-b968bb7a54de8ad3566b2b15
    resource: repo://src/web/src/ReportApp.tsx
  - id: openwiki-source-73209936fc6edb7dfe8fc83e
    resource: repo://src/web/src/telegram.ts
  - id: openwiki-source-16af679f49cabaa02bc32312
    resource: repo://src/web/src/useLeaderboard.ts
  - id: openwiki-source-db479441b27a5f3da1be68f7
    resource: repo://src/web/src/useTelegramIdentity.ts
  - id: openwiki-source-4b4ffafa2b80a042014fafbc
    resource: repo://src/web/src/useTelegramUser.ts
  - id: openwiki-source-cb5080bf9bcf17079fed94ab
    resource: repo://src/web/src/views/Issues.tsx
  - id: openwiki-source-efd9c0c6d9d834c3b9e533d4
    resource: repo://src/web/src/views/Profile.tsx
  - id: openwiki-source-73d3563b23c926309c9b707d
    resource: repo://src/web/vite.config.ts
  - id: openwiki-source-59f07d98abf990760d48298c
    resource: repo://src/web/vite.library.config.ts
generated: { by: "opencode", at: "2026-10-24T11:41:29.189Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-24T11:41:29.189Z
---

# Web App

`src/web/` holds one app and, beside it, the older single-purpose pages. The app is `app.html` → `src/app-main.tsx` → `AppShell.tsx`, built by `vite.library.config.ts` into `dist-library/index.html` and served from `/library/` by the Express host.

## One sheet, four sections

The app is the register metaphor made literal: a cloth band at the head, a printed index page, and index tabs at the foot of the sheet.

- **The band** says where you are — `Student register`, `Attendance register`, `Library`, `Student profile`, `Issue reports` — plus one stamp for the figure that belongs there. It is drawn by the shell (`components/Band.tsx`), never by a section.
- **The index page** (`#/`) is the front matter: a Zilla Slab title, one note, the viewer's own entry bracketed in red (roll and attendance rank from `/api/me`), and the four sections as ruled index rows with their numbers in the margin.
- **The tab rail** carries five stamps — Index, Ranks, Library, Profile, Issues. Each is a 19px single-stroke icon over an 11px tracked label; the open tab fills ink with paper text. It is fixed to the foot of the sheet on phones and centred with the 560px sheet on desktop.
- **Sections** start with a printed page head (eyebrow, title, note, 1.5px rule) and then their own content; the leaderboard keeps its register rows, its merit entries and its 75% line, the shelf its subject rows, the issue desk its threads.

The design rules for all of this are in `DESIGN.md` (§ App shell).

## Routes

The hash is the router, so every screen survives a reload and can be linked from the chat:

| Route | Screen |
|---|---|
| `#/` | the index page |
| `#/rank` | the attendance register (leaderboard) |
| `#/library` | the shelf, then a subject's units, then the reader |
| `#/profile` | the roll form |
| `#/issues` | report an issue |
| `#/issues/reports` | the reporter's own list |
| `#/issues/QIK-0007` | one conversation |

`parseRoute` reads the hash on mount and on `hashchange`; anything unrecognised falls back to the index. `go()` writes the hash, sets the route and clears any immersive state, and `src/constants/webapp.ts` builds the same strings for the bot's buttons — a link that does not match `parseRoute` is silently treated as the index.

## The band stamp

A section cannot draw a head, so it publishes one figure instead: `useBandStamp({value, label})` from `src/web/src/bandStamp.ts`. The shell renders the stamp in the band and clears it when the section unmounts. The shelf publishes its ready-subject count, the register publishes the total students, the issue list publishes its open count.

## Telegram, in one place

`src/web/src/telegram.ts` holds the only read of the injected SDK (`telegramWebApp()`), typed with the two pieces this app uses: `initData`/`initDataUnsafe` for identity, and `BackButton` for navigation.

`useTelegramIdentity` reads it once in a lazy initializer and exposes `tgUser` and `initData` to every section. In dev builds only, it also accepts `?devUser=<telegram id>` so the app can be opened in a plain browser; the branch is folded away in production builds.

`backButton.ts` keeps a stack of handlers. The section registers "back to the index" and the reader pushes "close the reader" on top, so the Telegram arrow closes the innermost screen first and hides itself when nothing is stacked.

## What each section reuses

- **Register** — `Leaderboard.tsx` takes `showBand={false}` inside the app: it drops the band and publishes the student count as the band's stamp instead. On its standalone page the band is drawn as before.
- **Shelf** — `views/LibraryView.tsx`, detailed in [Library Reader Mini App](../library/reader.md).
- **Roll** — `views/Profile.tsx` with `compact`, so the shell's page head is not repeated, and `onReportIssue`, which switches to the Issues tab.
- **Issues** — `views/Issues.tsx` is a pure view over an `IssuesRoute`; `ReportApp.tsx` wraps it for `report.html` with query-string routes, and the shell maps `IssuesRoute` onto the hash.

## The standalone pages

`index.html` (leaderboard, `App.tsx`), `register.html` (profile, `ProfileApp.tsx`) and `report.html` (issues, `ReportApp.tsx`) are still built by the default `vite.config.ts` and deployed to GitHub Pages. The bot no longer links to them; they exist so old links and bookmarks keep working. The app is the front door because the library's session cookie must be first-party.

## Build

`src/web/package.json`:

- `build` — `tsc -b && vite build`, the three GitHub Pages entries.
- `build:library` — `tsc -b && vite build --config vite.library.config.ts`, the app; Vite emits `app.html`, and a `closeBundle` hook renames it to `index.html` so `/library/` serves it.
- `dev` — Vite with `/api` proxied to `localhost:3000`.

`scripts/deploy.sh` copies `dist-library/` to the server's `public/library/`. See [Deployment and Operations](../operations.md).

## Related pages

- [Library Reader Mini App](../library/reader.md)
- [Registration and Profile](../registration.md)
- [REST API and Security](../api/server.md)
- [Deployment and Operations](../operations.md)
