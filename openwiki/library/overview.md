---
type: overview
title: Library Subsystem
description: The library behind /library — how a Telegram student is resolved to a semester and the documents that belong to it, who may open the shelf, and how access, watermarking and reading fit together.
tags: [library, access-control, syllabus, documents, watermark]
sources:
  - id: openwiki-source-2e8d5982dd5829d5c5ceb46c
    resource: repo://src/api/library.ts
  - id: openwiki-source-714e0c91fd122c36f3217aa4
    resource: repo://src/api/server.ts
  - id: openwiki-source-4619143558848c5c520eb41f
    resource: repo://src/bot/commands/library.ts
  - id: openwiki-source-f11b9279af821abdb3463e06
    resource: repo://src/config/environmentals.ts
  - id: openwiki-source-87c47a793c4a631e2439348f
    resource: repo://src/constants/webapp.ts
  - id: openwiki-source-d48b28fa13d406f02f40a97e
    resource: repo://src/services/library/access.ts
  - id: openwiki-source-10c65da185d300a2891bac91
    resource: repo://src/services/library/catalog.ts
  - id: openwiki-source-37db9f34338f3f0cee99af9e
    resource: repo://src/services/library/entitlement.ts
  - id: openwiki-source-93f5087b498e326c58cc1fa0
    resource: repo://src/services/library/paths.ts
  - id: openwiki-source-e9b157817dec0321b67b1935
    resource: repo://src/tools/ingestLibrary.ts
  - id: openwiki-source-a7cc3bce3c9730332b62de43
    resource: repo://src/web/src/AppShell.tsx
  - id: openwiki-source-6790efc761dabf796dc8a963
    resource: repo://src/web/src/useLibrary.ts
  - id: openwiki-source-eaddaf398932b4a18de1234b
    resource: repo://src/web/src/views/LibraryView.tsx
generated: { by: "opencode", at: "2026-10-24T11:41:29.189Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-24T11:41:29.189Z
---

# Library Subsystem

The library is the study material surface: a student opens `/library` from the bot, and reads the syllabus units of their own semester as paged documents in a Telegram mini app. It is built around one rule — a student sees the material of their own department, regulation and year-sem, and nothing else — and one promise — every page served is marked with an opaque token that can be traced back to the account it was served to.

## The pieces

| Piece | Where | Job |
|---|---|---|
| Access flag | `src/services/library/access.ts` | Who may open the shelf and who gets the admin preview |
| Student resolution | `src/services/library/entitlement.ts` | Telegram id → roll → year-sem, branch, department, regulation |
| Catalogue | `src/services/library/catalog.ts` | Which subjects a semester has (a committed snapshot) |
| Registry | `src/db/library.model.ts` | One row per held document, plus the read audit |
| API | `src/api/library.ts` | Session cookie, subject shelf, page delivery |
| Reader | `src/web/src/views/DocumentReader.tsx` | The paged SVG reader in the mini app |
| Bot entry | `src/bot/commands/library.ts` | `/library` and the `?start=library` deep link |
| App shell | `src/web/src/AppShell.tsx` | The library as a section of the app, at `#/library` |
| Ingest | `src/tools/*` | Catalogue sync, PDF ingest, watermark resolution |

Each has its own page: [Library API and Session](api.md), [Library Reader Mini App](reader.md), [Catalogue and Document Ingest](ingest.md).

## Who may open it

`access.ts` holds two questions and both are read per request, so opening the library is an environment change and a restart:

- `libraryOpenToAll()` — true when `LIBRARY_ACCESS=all` (default `admin`).
- `canOpenLibrary(userId)` — true for the admin, and for anyone once the library is open. The bot keeps `/library` and the menu button to the admin's chat, and the API refuses every other account even if one reaches the URL.
- `canPreviewEverything(userId)` — true only for the admin *while the library is closed*. This is how the shelf gets reviewed before students can see it: the admin sees every live document, not just their own semester.

The library ships before the material does. Until the shelf is filled, only the admin can open it, so a half-empty shelf is never shown to students. The app makes that a calm state rather than a fault: a refused session is rendered as "The library opens soon" with a "Check again" button, not as an error page.

## Who is this student

`resolveStudentContext(userId)` is the only place that answers it, and it is deliberately narrow:

1. `getRegistration(userId)` gives the roll number the student saved. No registration means no context, and the app asks for a roll instead of showing an empty shelf.
2. `getStudentCached(roll)` gives the college's own record — name, year-sem code (`11` … `42`), branch id.
3. The roll gives the entry year (`23CS1042` → 2023), which gives the regulation (R23, R20, …), and the branch id gives the college site's department folder (`5` → `CSE`, `23` → `AIDS`, …).

The result is a `StudentContext`. Both lookups are best-effort: a registration or student record that cannot be read is treated as "not registered" rather than as an error page.

## What the student sees

The shelf is our corpus, not the syllabus. `listSubjectsForStudent` reads the live documents of the student's department, regulation and year-sem, and `groupByCode` folds them into one row per subject with one entry per unit. The catalogue supplies the subject's proper name when it still lists the code; the document's own title is the fallback. A semester we have not reached gets an empty shelf, not a list of promises.

`listAllLiveSubjects` is the same grouping over every live document, used only by the admin preview.

## Inside the app

The library is one section of the app, not a page of its own. `views/LibraryView.tsx` renders the three states inside the shell's printed page head — shelf, subject units, reader — and publishes the number of ready subjects into the band's stamp. The shelf takes the `?start=library` deep link and `/library` button as `#/library`.

When a unit opens, the reader takes the whole sheet: it calls `onImmersiveChange(true)`, the shell hides the band and the tab rail, and the reader's own head takes over. Closing it restores the shell.

## Reading a page

The reader asks for one page at a time. The server loads the rendered SVG, draws the reader's watermark into it as vector elements and sends it with no-store headers; the reader holds a small window of pages and drops the rest. Nothing clean ever leaves the box, and the copy a student holds is a copy that names them.

The token is derived from the Telegram id and a server secret, so it is stable for one reader, different for every reader, and not reversible from the page. `resolveWatermark` turns a token back into a student when a page turns up somewhere it should not.

## Configuration

| Variable | Effect |
|---|---|
| `LIBRARY_ACCESS` | `admin` (default) keeps the shelf to the admin; `all` opens it to every registered student |
| `LIBRARY_WATERMARK_SECRET` | Secret behind the tokens; falls back to the bot token, and a dedicated value keeps old marks resolvable across a token change |
| `LIBRARY_DATA_DIR` | Where `docs/` and `pages/` live (default `./data`) |
| `LIBRARY_CATALOG_PATH` | The catalogue snapshot (default `data/syllabus-catalog.json`) |
| `LIBRARY_WEB_DIR` | The built mini app served at `/library` (default `public/library`) |

## What it is not

- It is not a file server: the PDFs are the store of record and are never sent. Only rendered, stamped pages leave.
- It is not public: no session can be opened outside Telegram, and a session minted before the library closed stops working at the close.
- It is not crawled: the catalogue is a committed snapshot, so no request path touches the college site.

## Related pages

- [Library API and Session](api.md)
- [Library Reader Mini App](reader.md)
- [Catalogue and Document Ingest](ingest.md)
- [Database Schema and Models](../data/database.md)
- [Web App](../web/leaderboard.md)
- [Bot Commands and Authorization](../bot/commands-and-authorization.md)
