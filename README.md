<div align="center">

<img src="assets/images/icon.png" alt="NbkristQik icon" width="128" height="128" />

# NbkristQik

**Attendance, mid-term marks and your syllabus — inside Telegram.**

A Telegram bot and companion web app for students of NBKRIST. Send a roll
number, get an answer in seconds. No install, no separate account.

[Bot](https://t.me/NbkristQik_bot) · [App](https://checker.tobioffice.online/library/) · [Status](https://checker.tobioffice.online/status) · [Website](https://tobioffice.github.io/NbkristQik/site/)

[![Tests](https://github.com/tobioffice/NbkristQik/actions/workflows/test.yml/badge.svg)](https://github.com/tobioffice/NbkristQik/actions/workflows/test.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22%2F24-1e2a38)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-1e2a38)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-3f6457)](LICENSE.md)

</div>

---

## Usage (verifiable)

Dated snapshot: end of IST day, 17 November 2026. New history rows are
captured around 23:30 IST.

| Metric                               | Value  | Definition                                                                      |
| ------------------------------------ | ------ | ------------------------------------------------------------------------------- |
| Users (`registered_users`)           | 3,534  | Distinct Telegram users with at least one recorded action (rows in `botusers`). |
| Daily active (`dau`)                 | 1,131  | Distinct users with an action on 17 November 2026 (IST).                        |
| Weekly active (`wau`)                | 2,967  | Distinct users with an action in the trailing 7 IST days.                       |
| Monthly active (`mau`)               | 3,485  | Distinct users with an action in the trailing 30 IST days.                      |
| Actions, last 7 days (`commands_7d`) | 60,571 | Recorded actions in the trailing 7 IST days.                                    |
| Uptime, 90 days (`uptime_90d`)       | 99.6%  | Successful uptime probes across all monitored components, last 90 days.         |

`registered_users` counts distinct Telegram users with at least one recorded
action, not roll-number registrations. The live page's `dau` is the current IST
day so far; the 1,131 above is the completed 17 November day.

Only aggregates are published; no usernames, user IDs or per-student rows leave
the database.

Live: [checker.tobioffice.online/stats](https://checker.tobioffice.online/stats) ·
JSON: [/api/stats](https://checker.tobioffice.online/api/stats) ·
Method: [publicStats.ts](src/api/publicStats.ts) and
[activityStats.model.ts](src/db/activityStats.model.ts) ·
History: [stats/history.csv](stats/history.csv)

[![30-day usage: registered, daily, weekly and monthly active users](stats/history.svg)](stats/history.csv)

The chart is regenerated daily by
[`stats-history.yml`](.github/workflows/stats-history.yml); the CSV rows are the
committed snapshots behind it.

<details>
<summary>The SQL behind the active counts</summary>

```sql
SELECT
  COUNT(DISTINCT CASE WHEN created_at >= datetime('now','start of day','-330 minutes') THEN user_id END) dau,
  COUNT(DISTINCT CASE WHEN created_at >= datetime('now','start of day','-330 minutes','-6 days') THEN user_id END) wau,
  COUNT(DISTINCT CASE WHEN created_at >= datetime('now','start of day','-330 minutes','-29 days') THEN user_id END) mau
FROM activity_log
WHERE created_at >= datetime('now','start of day','-330 minutes','-29 days');
```

`registered_users` is `SELECT COUNT(*) FROM botusers`. `commands_7d` is the
row count in `activity_log` over the same trailing 7 IST days. The full queries
live in
[`src/db/activityStats.model.ts`](src/db/activityStats.model.ts).

</details>

## Overview

NbkristQik reads the college portal so students do not have to. Attendance
percentages, mid-term marks and a "how much can I bunk?" plan arrive as a
Telegram reply, formatted for a phone held in a corridor between classes.

3,534 users have used it, 1,131 checked in on 17 November (about a third of
tracked users), and the API stayed up 99.6% over 90 days. The
[live numbers](https://checker.tobioffice.online/stats) are public.

The same service also runs a Telegram Mini App with the live leaderboard, an
optional roll-number profile, a watermarked library of semester material and a
threaded issue desk. Attendance itself is answered only in the chat. The
maintainer gets a private admin panel for activity, reports and uptime, and a
public status page for service health.

## Features

**For students**

- **Instant lookups** — send a roll number and get attendance, mid-term marks
  and a bunk plan without leaving the chat.
- **Optional registration** — save your roll once, then use `/attendance`,
  `/midmarks` and `/bunk` as one-tap commands. Edit it at any time.
- **College-email verification** — prove your roll with the mailbox the
  college gave you (`<roll>@nbkrist.org`). A verified roll belongs to one
  Telegram account, other claims on it are removed, and you choose separately
  whether to hide your name and roll in the leaderboard, refuse other accounts' lookups, or refuse
  their registrations.
- **Live leaderboard** — the attendance register ranks students by attendance
  or mid-term marks, filtered by year, branch and section. `/leaderboard` and
  the button on any card open it as a page in the app.
- **Library** — read your semester's syllabus units as paged documents,
  watermarked for the signed-in reader. Download a watermarked PDF, or open
  the shelf on a computer with a one-time link from the bot. The shelf is
  admin-first until `LIBRARY_ACCESS=all`.
- **Issue reports** — file a report with a trackable id (for example
  `QIK-0007`) and keep the whole conversation with the admin in one thread.
- **Question papers** — a hidden intake page collects photos of past papers
  with a subject and exam line. The upload is Telegram-only and the photos stay
  private to the processing team.

**For the maintainer**

- **Admin panel** — overview, student search, live activity feed, report
  threads, question-paper processing and 90-day health, behind a secret path
  and a password.
- **Uptime monitoring** — five-minute probes from a second host (monitor-host) for
  the API, database, Redis and college portal, with Telegram alerts on state
  changes and a replay spool for outages.
- **Semester sync** — `/setsem` and `/syncdb` refresh sections from the portal
  without a redeploy.

## Architecture

```mermaid
flowchart LR
    student["Student<br/>Telegram"] --> bot["Bot<br/>node-telegram-bot-api"]
    web["Mini App<br/>React + Vite"] --> api["Express API"]
    bot --> scraper["Portal scraper<br/>Axios + Cheerio"]
    scraper --> portal[("College portal")]
    bot --> redis[("Redis<br/>cache")]
    api --> redis
    bot --> db[("libSQL<br/>embedded or Turso")]
    api --> db
    api --> admin["Admin panel"]
    api --> status["Status page"]
    monitor["External monitor<br/>monitor-host"] -->|probes| api
    monitor -->|probes| portal
```

A single Node process serves the bot (long polling), the REST API, the admin
panel and the status data. The Mini App is a static React build served
alongside it at `/library/`; the status page is a single static file that
Express serves at `/status`. Uptime probes are moving to a second host, so a
dead or overloaded production VM still produces an alert; the in-process probe
still runs alongside the external monitor until the external one is verified
in production. The schema is created idempotently on boot, so a fresh database
needs no migration step.

## Technology stack

| Layer      | Choice                                                            |
| ---------- | ----------------------------------------------------------------- |
| Runtime    | Node.js 22 or 24 (Node 20 is EOL), ESM, TypeScript 5             |
| Bot        | `node-telegram-bot-api` v2, long polling                          |
| API        | Express 5 with CORS, rate limiting and input validation           |
| Database   | libSQL/SQLite via `@libsql/client` — embedded file or Turso Cloud |
| Cache      | Redis 5                                                           |
| Scraping   | Axios and Cheerio                                                 |
| Frontend   | React 19, Vite 7 and Tailwind CSS                                 |
| Testing    | Vitest, v8 coverage, ESLint and Prettier                          |
| Deployment | GitHub Actions to systemd behind nginx; app and status page served same-origin |

## Repository layout

```
.
├── src/
│   ├── api/          Express app, admin panel, API routes
│   ├── bot/          Entry point, commands and academic flows
│   ├── config/       Environment and logger
│   ├── constants/    Bot, web app and channel constants
│   ├── db/           libSQL client, schema and models
│   ├── middleware/   Request sanitisation and security
│   ├── services/     Portal scraping, caches, library, uptime, tracking
│   ├── status/       Static status and public stats pages
│   ├── tools/        Library ingest and catalogue utilities
│   └── web/          React Mini App and marketing site (own package)
├── tests/            Unit and integration tests
├── docs/             Hand-written guides
├── scripts/          Deploy, backup and import helpers
├── stats/            Dated aggregate history and generated chart
└── assets/           Brand assets
```

## Getting started

### Prerequisites

- Node.js 22 or 24 (Node 20 is EOL; `.nvmrc` pins 24)
- pnpm 10
- Rust 1.88 or newer (builds the library's PDF stamp; the production host
  receives the built binary and needs no toolchain)
- A Redis instance
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- NBKRIST portal credentials with access to attendance and marks

Turso is optional. Without it, set `LOCAL_DB_URL` and the bot uses an embedded
SQLite file.

### Installation

```bash
git clone https://github.com/tobioffice/NbkristQik.git
cd NbkristQik
pnpm install
cp .env.example .env
```

Fill in the values in `.env` (see [Configuration](#configuration)), then start
the bot and API together:

```bash
pnpm dev
```

For the Mini App, run its package separately:

```bash
cd src/web
pnpm install
pnpm dev
```

### Configuration

The full list, with defaults, lives in [`.env.example`](.env.example) and
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). The variables you will need first:

| Variable                                        | Purpose                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `ENV`                                           | `production` by default; `development` must be explicit and also needs `ALLOW_DEV_IDENTITY=1` for the unsigned `userId` shortcut |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_TOKEN_DEV` | Bot credentials                                                              |
| `N_USERNAME` / `N_PASSWORD`                     | College portal login                                                         |
| `ADMIN_ID`                                      | Telegram id allowed to run admin commands                                    |
| `REDIS_URL`                                     | Cache connection                                                             |
| `LOCAL_DB_URL`                                  | Embedded SQLite file; takes precedence over Turso                            |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`       | Turso connection when `LOCAL_DB_URL` is unset                                |
| `ADMIN_PANEL_PATH` / `ADMIN_PANEL_PASSWORD`     | Admin panel location and password; the panel is disabled unless both are set |
| `UPTIME_INGEST_SECRET`                          | Shared secret for the external monitor's private `/internal/*` routes        |
| `CORS_ORIGINS`                                  | Comma-separated allowlist for the API                                        |
| `PORTAL_BASE_URL`                               | Optional portal override; plain HTTP by default                              |
| `HOST` / `PORT`                                 | API bind address and port; keep `HOST=127.0.0.1` behind nginx                 |
| `LIBRARY_ACCESS`                                | `admin` (default) or `all`                                                   |

## Commands

### Student

| Command        | What it does                                         |
| -------------- | ---------------------------------------------------- |
| `/start`       | Open the bot and its menu button                     |
| `/attendance`  | Attendance for your saved roll number                |
| `/midmarks`    | Mid-term marks for your saved roll number            |
| `/bunk`        | How many classes you can skip and stay above 75%     |
| `/register`    | Save your roll number once, edit it any time         |
| `/leaderboard` | Open the attendance register in the app              |
| `/library`     | Open your semester's library, when the shelf is open |
| `/report`      | File an issue, or `/report <message>` directly       |
| `/help`        | How the bot works                                    |

Sending a roll number such as `99KB9A9999` works for everyone, registered or
not.

### Admin

| Command                    | What it does                                        |
| -------------------------- | --------------------------------------------------- |
| `/reply QIK-0007 <answer>` | Append to a report thread and notify the reporter   |
| `/close QIK-0007`          | Resolve a report and close its thread               |
| `/setsem 1\|2`             | Set the semester used by the next sync              |
| `/syncdb`                  | Refresh student sections from the portal            |
| `/postopen`                | Repost the "open me in private" card to the channel |

Admin commands are accepted only from `ADMIN_ID` and are not listed in the
public command menu.

## Web surfaces

| Surface        | Location                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| Mini App       | [`/library/`](https://checker.tobioffice.online/library/) — hash routes `#/` (my attendance), `#/rank`, `#/profile`, `#/library`, `#/issues` (reports), `#/issues/new` (the report form), and the hidden `#/papers` intake |
| Status page    | [`/status`](https://checker.tobioffice.online/status) — Express-served, live health and 90-day bars per component     |
| Admin panel    | `/<ADMIN_PANEL_PATH>` — Overview, Students, Verified, Library, Reports, Papers, Live, Health                       |
| Marketing site | [NbkristQik site](https://tobioffice.github.io/NbkristQik/site/)                                                    |

API routes and their validation rules are documented in
[`docs/API.md`](docs/API.md). The Mini App authenticates with signed Telegram
`initData`; the admin panel uses a 24-hour HttpOnly session cookie and a
rate-limited login.

The status page is served by Express at `/status`. It is a single static file
with no external font or script request, and each 90-day bar exposes the day's
status as text with a keyboard and tap detail line.

## Development

| Script                 | What it does                        |
| ---------------------- | ----------------------------------- |
| `pnpm dev`             | Run the bot and API from TypeScript |
| `pnpm build`           | Compile to `dist/`                  |
| `pnpm run build:pdfstamp` | Build the native PDF stamp        |
| `pnpm run check:prod`  | Check the production install         |
| `pnpm start`           | Run the compiled build              |
| `pnpm lint`            | ESLint over `src/` and `tests/`     |
| `pnpm typecheck`       | Type-check without emitting         |
| `pnpm format`          | Format with Prettier                |
| `pnpm exec vitest run` | Run the test suite once             |
| `pnpm test:coverage`   | Run tests with a coverage report    |

`pnpm test` starts Vitest in watch mode; use `pnpm exec vitest run` in scripts
and CI.

The library's whole-PDF stamp is `bin/pdfstamp` (Rust). A 100-page text PDF
stamps in about 3.5 ms at a 14 MB peak, against about 37 ms and 67 MB of
marginal memory for the retired pdf-lib path; the full comparison is in
[`docs/PDF-DELIVERY.md`](docs/PDF-DELIVERY.md).

Continuous integration runs lint, type-check (sources and tests), the native
stamp tests, a production dependency audit and coverage on Node 22 and 24, and
a separate job for the web package's lint, test type-check, unit tests and the
same-origin `/library/` build. Every pull request to `main` or `develop`
runs the same checks, and a scheduled weekly run keeps the audit current
when the repository is quiet.

## Deployment

The bot runs as the `nbkristqik` systemd service. A push to `main` runs
`.github/workflows/deploy.yml`, which executes `scripts/deploy.sh` on a GitHub
runner with its SSH, database and smoke-check values taken from GitHub secrets.
Only `dist/`, `bin/pdfstamp` and the static surfaces are shipped, because the
production host has little memory. The same script still deploys from a
developer shell:

```bash
scripts/deploy.sh
```

The deploy refuses a dirty working tree (staged, unstaged or untracked files;
`ALLOW_DIRTY_DEPLOY=1` is the documented hotfix escape), then runs typecheck,
lint and the tests before building. On the server it stages the new build as
`dist.new`, keeps the replaced build as `dist.old` until the smoke checks pass,
then promotes it to `dist.prev`; takes a `VACUUM INTO` backup when
`DEPLOY_DB_URL` is set; ships `dist/`, the manifests, ops scripts,
`src/status` → `public/status`, the library bundle and the syllabus catalogue;
installs production dependencies with a frozen lockfile; restarts the service;
and smoke-checks `/health`, `/status`, `/stats`, `/api/stats`, `/library/` and
a hashed asset. A failed check restores `dist.old`, restarts the old build and
exits non-zero. `DEPLOY_HOST` (the ssh alias) is required; the rest default to
directory
`/home/ubuntu/nbkristqik`, service `nbkristqik` and loopback
`http://127.0.0.1:3000`, overridable with `DEPLOY_DIR`, `DEPLOY_SERVICE` and
`DEPLOY_BASE_URL`. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the backup and internal-check
variables. The host must run Node 22 or 24; Node 20 is EOL.

The web app is one Vite build, served at `/library/` and shipped by the deploy
script:

```bash
cd src/web
pnpm build        # same build as build:library
```

The app talks to the API same-origin (the dev server proxies `/api` to
`localhost:3000`). Only a deployment that splits the app and the API onto
different origins needs
[`VITE_API_URL`](src/web/README.md#build-time-configuration); it is a build
variable for `src/web`, not a server environment variable.

The marketing site has its own Pages-only deploy:

```bash
cd src/web
pnpm deploy:site  # stages public/site/ and publishes it with gh-pages
```

`build`/`build:library` build only the `/library/` app. The old standalone app
entry points and the old `pnpm deploy` command are gone; `deploy:site` is now
the only gh-pages deploy.

The uptime monitor deploys separately to monitor-host as the
`nbkristqik-uptime` systemd service; it needs only
`dist/monitor/index.js`, a root-owned environment file and a writable state
directory. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the hardened
unit and the one-time setup. The in-process probe stays enabled alongside the
external monitor until fresh external heartbeats have been verified in the
90-day history.

## Documentation

| Document                                           | Contents                                    |
| -------------------------------------------------- | ------------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)     | Runtime, data flow and module map           |
| [`docs/API.md`](docs/API.md)                       | REST endpoints, parameters and responses    |
| [`docs/DATABASE.md`](docs/DATABASE.md)             | Schema, models and caching                  |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)         | Environment, build and production           |
| [`docs/LIBRARY.md`](docs/LIBRARY.md)               | Library, reader and watermarking            |
| [`docs/DOCUMENTS.md`](docs/DOCUMENTS.md)           | Document ingest and catalogue               |
| [`docs/SITE.md`](docs/SITE.md)                     | Marketing site                              |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)               | Decided but unbuilt work                    |
| [`DESIGN.md`](DESIGN.md)                           | Design system for the app, admin, status and stats pages; binding before any UI change |
| [`PRODUCT.md`](PRODUCT.md)                         | Product brief, users and principles         |

If a hand-written guide and the code disagree, the code wins.

## Contributing

Contributions are welcome. Read
[`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) for the workflow, coding
standards and commit conventions. Before opening a pull request, run:

```bash
pnpm lint
pnpm typecheck
pnpm exec vitest run
```

## License

Released under the [MIT License](LICENSE.md).
