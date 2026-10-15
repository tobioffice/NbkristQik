---
type: guide
title: Quickstart
description: Entry point to the NbkristQik wiki — orientation, quick facts, a one-line index of every page, minimal local setup, and guided reading paths for contributors, operators, and API consumers.
tags: [quickstart, navigation, setup]
sources:
  - id: openwiki-source-4f2678f93d3fd3835f9f2909
    resource: repo://.github/workflows/test.yml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-76f3d337b59570f380794dd4
    resource: repo://scripts/deploy.sh
  - id: openwiki-source-c86189a5f8e6fd33c86b338e
    resource: repo://src/bot/commands/registered.ts
  - id: openwiki-source-70ae228271bbdb1aff4dc249
    resource: repo://src/bot/index.ts
  - id: openwiki-source-1904030dfb49db04cb06af5b
    resource: repo://src/db/db.ts
  - id: openwiki-source-51ebf01a6987b9612a7dd707
    resource: repo://src/db/init.ts
  - id: openwiki-source-290cb8a0cd25881741257ea3
    resource: repo://src/services/redis/getRedisClient.ts
  - id: openwiki-source-e9ea5e902b3d8efac528eb9f
    resource: repo://src/web/package.json
  - id: openwiki-source-fbadcd8591b65031efaaedce
    resource: repo://vitest.config.ts
generated: { by: "opencode", at: "2026-10-15T21:12:57.495Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-15T21:12:57.495Z
---

# Quickstart

NbkristQik is a Telegram bot for NBKRIST students to check attendance and mid-term marks, backed by a college-portal scraper. The same process serves a live leaderboard (Telegram Web App), an optional registration profile page, a public uptime status page, and a private admin panel tracking bot usage. This wiki documents the whole system; start here and follow the page that matches your goal.

**Reading paths**

- **New contributor** — [Overview](overview.md) → [Runtime Architecture](architecture.md) → [Academic Data Flow](bot/academic-flow.md) → [College Portal Scraping](portal/scraping.md).
- **Operator** — [Deployment and Operations](operations.md) → [Admin Panel](api/admin-panel.md) → [Semester Sync](bot/checkin-and-syncdb.md).
- **API consumer / frontend dev** — [REST API and Security](api/server.md) → [Web Leaderboard](web/leaderboard.md) → [Registration and Profile](registration.md) → [Caching and Leaderboard Stats](data/caching-and-stats.md).

## Quick facts

- **One Node process** runs both the Telegram bot (long polling) and the Express API; polling starts only after schema init, handler imports, and server startup (`src/bot/index.ts`).
- **Persistence** — one libSQL/SQLite database through `@libsql/client`: an embedded file when `LOCAL_DB_URL` is set, otherwise Turso Cloud; **cache** — Redis.
- **Registered users** get `/attendance`, `/midmarks`, and `/bunk` instant commands; everyone can still just send a roll number.
- **Three mini app pages** — leaderboard (`index.html`), profile/registration (`register.html`), and issue reports (`report.html`), React 19 + Vite + Tailwind on GitHub Pages.
- **Tests** — Vitest for backend and web separately; run once with `pnpm exec vitest run` (bare `pnpm test` watches), and CI runs lint, typecheck, and coverage on Node 20.
- **Production** — `dist/` is built locally and shipped to a systemd service named `nbkristqik`.

## Pages

| Page | What it covers |
|---|---|
| [Overview](overview.md) | Product summary, stack, repository map |
| [Runtime Architecture](architecture.md) | Single-process startup order, registration pattern, shutdown, component diagram |
| [Registration and Profile](registration.md) | Optional registration, profile API, registered shortcuts, profile web page |
| [Bot Commands and Authorization](bot/commands-and-authorization.md) | Every command, the membership gate and group-use funnel, special groups |
| [Academic Data Flow](bot/academic-flow.md) | Roll lookup to formatted reply, callbacks, placeholder-then-edit UX |
| [Semester Sync](bot/checkin-and-syncdb.md) | `/setsem` + `/syncdb` portal rollover, CLI re-run, roll extraction |
| [College Portal Scraping](portal/scraping.md) | Session trick, request pipeline, parsers, fallback, error hierarchy |
| [Database Schema and Models](data/database.md) | All twelve tables, indexes, key conventions, query safety |
| [Caching and Leaderboard Stats](data/caching-and-stats.md) | Redis keys and TTLs, section caching, ranking design |
| [REST API and Security](api/server.md) | Endpoint contracts, validation, rate limits, initData verification |
| [Admin Panel](api/admin-panel.md) | Secret-path dashboard, session auth, activity endpoints, IST bucketing |
| [Web Leaderboard](web/leaderboard.md) | React apps, data hooks, filters/podium, build and deploy |
| [Deployment and Operations](operations.md) | Scripts, env vars, deploy flow, CI, test suites |

## Run locally

```bash
pnpm install
cp .env.example .env   # fill in Telegram, Redis, portal credentials
pnpm dev               # runs the bot + API from TypeScript
```

No database to install: leave `LOCAL_DB_URL` unset to use Turso Cloud, or point it at a file (for example `file:./data/qik.db`) to run fully embedded.

Tests and checks:

```bash
pnpm exec vitest run   # Vitest once (bare `pnpm test` watches)
pnpm typecheck
pnpm lint
```

The web apps are a separate package: `cd src/web && pnpm install && pnpm dev` (proxies `/api` to `localhost:3000`; `/register.html` serves the profile page and `/report.html` the issue reporter).

## Related pages

- [Overview](overview.md)
- [Runtime Architecture](architecture.md)
- [Registration and Profile](registration.md)
- [Deployment and Operations](operations.md)
