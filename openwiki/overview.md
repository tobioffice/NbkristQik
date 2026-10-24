---
type: overview
title: Overview
description: NbkristQik is a Telegram bot and companion web apps letting college students check attendance and mid-term marks, with optional registration for instant commands, a watermarked library of their own syllabus units, issue reports with admin replies, a live leaderboard, a service status page, and a private activity admin panel.
tags: [overview, telegram, attendance, leaderboard, registration, library]
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-9628533565ba429ce21df54f
    resource: repo://src/bot/authorization.ts
  - id: openwiki-source-4619143558848c5c520eb41f
    resource: repo://src/bot/commands/library.ts
  - id: openwiki-source-c86189a5f8e6fd33c86b338e
    resource: repo://src/bot/commands/registered.ts
  - id: openwiki-source-308f6e34ec7631b1d21bdb80
    resource: repo://src/bot/commands/report.ts
  - id: openwiki-source-70ae228271bbdb1aff4dc249
    resource: repo://src/bot/index.ts
  - id: openwiki-source-1d45088626f10df0fdd2b150
    resource: repo://src/bot/replies.ts
  - id: openwiki-source-a2138ded0dee8ee4f9165d66
    resource: repo://src/bot/setup.ts
  - id: openwiki-source-2c2f76c1ef875a091a93cc02
    resource: repo://src/bot/syncdb.ts
  - id: openwiki-source-f3a065ecee23ee5a53fe9d83
    resource: repo://src/constants/index.ts
  - id: openwiki-source-1904030dfb49db04cb06af5b
    resource: repo://src/db/db.ts
  - id: openwiki-source-e2d605fc24401a4f2602626d
    resource: repo://src/db/registration.model.ts
  - id: openwiki-source-e1e7c83fe5cbc0aa6334cb23
    resource: repo://src/db/report.model.ts
  - id: openwiki-source-d48b28fa13d406f02f40a97e
    resource: repo://src/services/library/access.ts
  - id: openwiki-source-9b164d771bbcef79db2bdcd4
    resource: repo://src/services/student.utils/formatters.ts
  - id: openwiki-source-0be99d3f1664956f03d52278
    resource: repo://src/services/uptime.ts
  - id: openwiki-source-d44d4e21369fc6c9f6881c2c
    resource: repo://src/web/app.html
  - id: openwiki-source-e9ea5e902b3d8efac528eb9f
    resource: repo://src/web/package.json
  - id: openwiki-source-a7cc3bce3c9730332b62de43
    resource: repo://src/web/src/AppShell.tsx
  - id: openwiki-source-73d3563b23c926309c9b707d
    resource: repo://src/web/vite.config.ts
  - id: openwiki-source-59f07d98abf990760d48298c
    resource: repo://src/web/vite.library.config.ts
generated: { by: "opencode", at: "2026-10-24T11:41:29.189Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-24T11:41:29.189Z
---

# Overview

NbkristQik is a Telegram bot for students of NBKRIST. A student sends their roll number in chat and the bot scrapes the college portal to reply with attendance details, mid-term marks, and a "bunk plan" that shows how many classes can be skipped while staying at 75% attendance. Students can optionally register their roll once to unlock `/attendance`, `/midmarks`, and `/bunk` instant commands.

Everything visual now lives in **one app**, opened from the chat's menu button: an index page, then the attendance register, the library shelf, the roll and the issue desk as index tabs. The library section holds the syllabus units of the reader's own semester as paged, per-reader-watermarked documents once the admin opens the shelf. Students can file an issue with a trackable id and talk it through with the admin. The same scraped scores feed the register and the app's ranking, a public 90-day uptime status page, and a private admin panel for tracking bot usage.

The audience is threefold: students using the Telegram bot and leaderboard, the maintainer running the bot and its operational commands, and API consumers (effectively just the web frontend) calling the Express API.

## Technology stack

| Layer | Technology | Source |
|---|---|---|
| Runtime | Node.js >= 20 (ESM), TypeScript 5 | `package.json`, `.nvmrc` |
| Bot | `node-telegram-bot-api` (long polling) | `src/bot/bot.ts`, `package.json` |
| API | Express 5 + CORS + express-rate-limit + express-validator | `src/api/server.ts`, `package.json` |
| Database | libSQL/SQLite via `@libsql/client` — embedded file (`LOCAL_DB_URL`) or Turso Cloud | `src/db/db.ts` |
| Cache | Redis via `redis` v5 | `src/services/redis/getRedisClient.ts` |
| Scraping | Axios + Cheerio | `src/services/student.utils/Academic.ts` |
| Frontend | React 19 + Vite + Tailwind CSS | `src/web/package.json` |
| Testing | Vitest (+ v8 coverage), ESLint, Prettier | `vitest.config.ts`, `package.json` |

## Two runtime surfaces in one process

The bot and the API are started by a single entry point, `src/bot/index.ts`, which initializes the database, imports all handlers, starts the Express server, and only then begins bot polling. The API serves the leaderboard web app, the profile/registration endpoints, issue reports and their threads, the library mini app at `/library` and its API at `/api/library`, a rank lookup for the "You are #N" banner, health/status endpoints, and the admin panel under a secret path. See [Runtime Architecture](architecture.md).

## Repository map

| Area | Contents | Wiki page |
|---|---|---|
| `src/bot/` | Entry point, command handlers, the shared authorization gate, academic menu flow, registered shortcuts, the library entry, semester sync and the daily check-in | [Bot Commands and Authorization](bot/commands-and-authorization.md), [Academic Data Flow](bot/academic-flow.md), [Semester Sync and Daily Check-in](bot/checkin-and-syncdb.md) |
| `src/api/` | Express app, leaderboard/me/profile endpoints, admin route modules and panel assets | [REST API and Security](api/server.md), [Admin Panel](api/admin-panel.md) |
| `src/services/` | Portal scraping and formatting, the shared HTML escaper, Redis caches and shared key constants, stats projection, activity tracking, uptime probes, Telegram initData verification, the library services (access, entitlement, session, watermark, catalogue, ingest) | [College Portal Scraping](portal/scraping.md), [Caching and Leaderboard Stats](data/caching-and-stats.md), [Library Subsystem](library/overview.md) |
| `src/db/` | libSQL client (embedded or Turso), schema init, student/stat/registration/fallback/report models | [Database Schema and Models](data/database.md) |
| `src/web/` | React/Vite: the app (`app.html` → `AppShell.tsx`, served at `/library/`) plus the older standalone pages (`index.html`, `register.html`, `report.html`), own package + tests | [Web App](web/leaderboard.md), [Registration and Profile](registration.md), [Library Reader Mini App](library/reader.md) |
| `src/status/` | Static 90-day uptime status page | [REST API and Security](api/server.md) |
| `data/` | Committed syllabus catalogue snapshot; server-side source PDFs and rendered pages (not in git) | [Catalogue and Document Ingest](library/ingest.md) |
| `src/tools/` | CLI tools: document ingest, catalogue sync, watermark resolution | [Catalogue and Document Ingest](library/ingest.md) |
| `tests/` | Vitest unit, integration, and mock suites | [Deployment and Operations](operations.md) |
| `scripts/` | Local-build deploy script for the systemd service | [Deployment and Operations](operations.md) |
| `docs/` | Hand-written architecture, API, database, deployment, and contributing docs | — |

## Core capabilities

- **Attendance and mid-marks lookup** by roll number, with Redis caching, whole-section background caching, and fallback to the last good portal response when the portal is down.
- **Bunk plan** computing skippable classes and recovery classes against a 75% target.
- **Optional registration** via a standalone profile web page (`/register`), giving `/attendance`, `/midmarks`, and `/bunk` one-tap lookups for the registered roll; editable anytime.
- **Live leaderboard** (Telegram Web App) with server-side `RANK()` so identical scores share a stable rank.
- **Activity tracking and admin panel** covering users, surfaces (private/group/channel), actions, a live feed, a report inbox with thread replies, and multi-component uptime health, all bucketed by IST day.
- **Issue reports** filed via `/report` or the web form, each getting a `QIK-####` id and a two-way thread the admin answers from the panel.
- **One authorization gate** in front of every answer: admin bypass, channel membership, then the daily channel check-in. Repeated reply copy lives in one module so the same situation reads the same way everywhere.
- **One app** — the chat's menu button opens it; the index page lists the four sections and the tab rail turns between them. It is served from our own host so the library's session cookie stays first-party.
- **Library** — the syllabus units of the reader's own semester, served as paged SVG documents, each stamped with an opaque per-reader watermark token that can be traced back to the account it was served to; closed to non-admins until `LIBRARY_ACCESS=all`, and shown as "The library opens soon" until then.
- **Semester sync** (`/syncdb`) replacing manual rollover of the student master table, covering the portal's full academic branch list.

## Related pages

- [Quickstart](quickstart.md)
- [Library Subsystem](library/overview.md)
- [Runtime Architecture](architecture.md)
- [Registration and Profile](registration.md)
- [Database Schema and Models](data/database.md)
