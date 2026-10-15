---
type: overview
title: Overview
description: NbkristQik is a Telegram bot and companion web apps letting college students check attendance and mid-term marks, with optional registration for instant commands, issue reports with admin replies, a live leaderboard, a service status page, and a private activity admin panel.
tags: [overview, telegram, attendance, leaderboard, registration]
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-c86189a5f8e6fd33c86b338e
    resource: repo://src/bot/commands/registered.ts
  - id: openwiki-source-308f6e34ec7631b1d21bdb80
    resource: repo://src/bot/commands/report.ts
  - id: openwiki-source-1248f2bddeea767a108637ab
    resource: repo://src/bot/groupLimit.ts
  - id: openwiki-source-70ae228271bbdb1aff4dc249
    resource: repo://src/bot/index.ts
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
  - id: openwiki-source-9b164d771bbcef79db2bdcd4
    resource: repo://src/services/student.utils/formatters.ts
  - id: openwiki-source-0be99d3f1664956f03d52278
    resource: repo://src/services/uptime.ts
  - id: openwiki-source-e9ea5e902b3d8efac528eb9f
    resource: repo://src/web/package.json
generated: { by: "opencode", at: "2026-10-15T21:12:57.495Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-15T21:12:57.495Z
---

# Overview

NbkristQik is a Telegram bot for students of NBKRIST. A student sends their roll number in chat and the bot scrapes the college portal to reply with attendance details, mid-term marks, and a "bunk plan" that shows how many classes can be skipped while staying at 75% attendance. Students can optionally register their roll once (via a Telegram Web App) to unlock `/attendance`, `/midmarks`, and `/bunk` instant commands. Group chats get 2 answers per student; past that the bot redirects them to DM, which stays unlimited. Students can also file an issue with a trackable id and talk it through with the admin. The same scraped scores feed a live leaderboard delivered as a Telegram Web App, a public 90-day uptime status page, and a private admin panel for tracking bot usage.

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

The bot and the API are started by a single entry point, `src/bot/index.ts`, which initializes the database, imports all handlers, starts the Express server, and only then begins bot polling. The API serves the leaderboard web app, the profile/registration endpoints, issue reports and their threads, a rank lookup for the "You are #N" banner, health/status endpoints, and the admin panel under a secret path. See [Runtime Architecture](architecture.md).

## Repository map

| Area | Contents | Wiki page |
|---|---|---|
| `src/bot/` | Entry point, command handlers, academic menu flow, registered shortcuts, group-use funnel, semester sync | [Bot Commands and Authorization](bot/commands-and-authorization.md), [Academic Data Flow](bot/academic-flow.md), [Semester Sync](bot/checkin-and-syncdb.md) |
| `src/api/` | Express app, leaderboard/me/profile endpoints, admin route modules and panel assets | [REST API and Security](api/server.md), [Admin Panel](api/admin-panel.md) |
| `src/services/` | Portal scraping and formatting, Redis caches and shared key constants, stats projection, activity tracking, uptime probes, Telegram initData verification | [College Portal Scraping](portal/scraping.md), [Caching and Leaderboard Stats](data/caching-and-stats.md) |
| `src/db/` | libSQL client (embedded or Turso), schema init, student/stat/registration/fallback/report models | [Database Schema and Models](data/database.md) |
| `src/web/` | React/Vite Telegram Web Apps: leaderboard (`index.html`) and standalone profile (`register.html`), own package + tests | [Web Leaderboard](web/leaderboard.md), [Registration and Profile](registration.md) |
| `src/status/` | Static 90-day uptime status page | [REST API and Security](api/server.md) |
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
- **Channel membership gate** to protect the bot, plus a group-use funnel: 2 answers per student in group chats, then a DM redirect; private chats stay unlimited.
- **Semester sync** (`/syncdb`) replacing manual rollover of the student master table, covering the portal's full academic branch list.

## Related pages

- [Quickstart](quickstart.md)
- [Runtime Architecture](architecture.md)
- [Registration and Profile](registration.md)
- [Database Schema and Models](data/database.md)
