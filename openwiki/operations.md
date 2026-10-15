---
type: operations
title: Deployment and Operations
description: Build, lint, test, and deploy workflows for NbkristQik — pnpm scripts, environment variables, the local-build deploy script to the systemd service, CI workflows, and the Vitest test suites for backend and web.
tags: [deployment, operations, ci, testing, environment]
sources:
  - id: openwiki-source-5f5b95b3d6a215fa02ceb945
    resource: repo://.env.example
  - id: openwiki-source-6d4b4e707b8d60b6ccfa3425
    resource: repo://.github/workflows/openwiki-update.yml
  - id: openwiki-source-4f2678f93d3fd3835f9f2909
    resource: repo://.github/workflows/test.yml
  - id: openwiki-source-7c03237a6b57ffb3e526a51b
    resource: repo://.nvmrc
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-c6b335367a1f46dd2f428811
    resource: repo://scripts/backup-db.sh
  - id: openwiki-source-76f3d337b59570f380794dd4
    resource: repo://scripts/deploy.sh
  - id: openwiki-source-865237b1d816f433f23630f8
    resource: repo://scripts/import-turso-snapshot.mjs
  - id: openwiki-source-f11b9279af821abdb3463e06
    resource: repo://src/config/environmentals.ts
  - id: openwiki-source-87c47a793c4a631e2439348f
    resource: repo://src/constants/webapp.ts
  - id: openwiki-source-1904030dfb49db04cb06af5b
    resource: repo://src/db/db.ts
  - id: openwiki-source-e9ea5e902b3d8efac528eb9f
    resource: repo://src/web/package.json
  - id: openwiki-source-7e315a43077168014ec4df6d
    resource: repo://src/web/vitest.config.ts
  - id: openwiki-source-81d8bdbf06dc4a693cea0d3c
    resource: repo://tests/integration/profileRoutes.test.ts
  - id: openwiki-source-cc18f7c982b54a9643a61d74
    resource: repo://tests/README.md
  - id: openwiki-source-38c5618a2cc9c0570859d522
    resource: repo://tests/setup.ts
  - id: openwiki-source-fbadcd8591b65031efaaedce
    resource: repo://vitest.config.ts
generated: { by: "opencode", at: "2026-10-15T21:12:57.495Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-15T21:12:57.495Z
---

# Deployment and Operations

## Package scripts

From the root `package.json`:

| Script | Command | Purpose |
|---|---|---|
| `dev` | `node --loader ts-node/esm src/bot/index.ts` | Run the bot + API from TypeScript |
| `build` | `tsc` | Compile to `dist/` (entry `dist/bot/index.js`) |
| `start` | `node dist/bot/index.js` | Run the compiled build |
| `lint` / `lint:fix` | `eslint "src/**/*.ts" "tests/**/*.ts"` | Static checks |
| `format` / `format:check` | `prettier` over the same globs | Formatting |
| `typecheck` | `tsc --noEmit` | Types only |
| `test` / `test:ui` / `test:coverage` | `vitest` variants | Tests, browser UI, coverage |

The project is ESM (`"type": "module"`), so all relative imports in source use `.js` extensions. `package.json` pins `engines.node >= 20`, and `.nvmrc` records `20` for local tooling.

## Environment variables

From `.env.example` and `src/config/environmentals.ts` / `src/constants/index.ts`:

| Variable | Consumer | Notes |
|---|---|---|
| `ENV` | `environmentals.ts` | `production` vs `development`; switches token/channel selection; defaults to development |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_TOKEN_DEV` | `bot.ts`, `telegramAuth.ts` | Production vs dev bot token; also the WebApp initData HMAC key |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | `db.ts` | Turso Cloud connection, used when `LOCAL_DB_URL` is unset |
| `LOCAL_DB_URL` | `db.ts` | Embedded libSQL/SQLite file (production: `file:/home/ubuntu/nbkristqik/data/qik.db`); takes precedence over Turso when set |
| `REDIS_URL` | `getRedisClient.ts` | Cache |
| `N_USERNAME` / `N_PASSWORD` | `portalSession.ts`, `syncdb.ts` | College portal credentials |
| `ADMIN_ID` | command handlers | Telegram user id for admin commands, report forwarding, and uptime alerts |
| `PROD_CHANNEL` / `TEST_CHANNEL` | `environmentals.ts` | Channel selected by `ENV`; used for membership checks |
| `ADMIN_PANEL_PATH` / `ADMIN_PANEL_PASSWORD` | `src/api/admin/` | Panel disabled unless both set |
| `CORS_ORIGINS` | `environmentals.ts` | Comma-separated API allowlist; default `https://tobioffice.github.io` |
| `PORTAL_BASE_URL` | `constants/index.ts` | Optional; defaults to `http://103.203.175.91` |
| `PORT` | `environmentals.ts` | API port, default 3000 |

## Deployment

The bot runs as the `nbkristqik` systemd service on the production server (`oracle3` by default). The server has very little RAM, so the TypeScript build runs locally and only `dist/` ships (`scripts/deploy.sh`):

1. `pnpm build` locally.
2. `ssh` + `rsync -az --delete dist/` and the manifests to `/home/ubuntu/nbkristqik`.
3. `pnpm install --prod --frozen-lockfile` on the server (auto-installing pnpm to `~/.local` if missing).
4. `sudo systemctl restart nbkristqik`, then verify with `systemctl is-active`.

`HOST`, `DIR`, and `SERVICE` are overridable via `DEPLOY_HOST`, `DEPLOY_DIR`, `DEPLOY_SERVICE`.

The script rsyncs `dist/` with `--delete`, so the server mirrors exactly what is in the local build directory. `tsc` does not remove outputs for source files that were deleted or renamed: run `rm -rf dist` before `pnpm build` after such changes, or the server keeps shipping the stale handler.

The web apps deploy separately as static pages to GitHub Pages: `src/web/package.json` defines `build` (`tsc -b && vite build`) and `deploy` (`gh-pages -d dist`). The Vite build has two entries — `index.html` (leaderboard) and `register.html` (profile) — and both ship in the same `dist/` payload. Bot buttons reference the direct `https://tobioffice.github.io/NbkristQik/index.html` and `.../register.html` URLs from `src/constants/webapp.ts`.

## Server operations

- The systemd service runs on `oracle3`; the embedded database lives at `/home/ubuntu/nbkristqik/data/qik.db` (WAL mode). `scripts/backup-db.sh` is installed in cron (`15 2 * * *`) and keeps 7 nightly `VACUUM INTO` snapshots in `/home/ubuntu/backups`, plus a best-effort off-box copy — see [Database Schema and Models](data/database.md) for the details.
- `oracle2` is not spare capacity: it serves LiteLLM (`:4000`) and SearXNG (`:8080`) and must not be repurposed. The only NbkristQik artifact it carries is the off-box backup copy (`/home/ubuntu/qik-backups`).
- The pre-cutover Turso data (reports, registrations, activity) is still read-blocked by the monthly quota. `scripts/import-turso-snapshot.mjs` is the idempotent merge path once Turso reads unblock, either at the quota reset or with overages enabled in the dashboard.
- Logs can carry token-bearing URLs, so journal queries stay keyword- and count-only.

## CI workflows

- **`test.yml`** — on pushes and PRs to `main`/`develop`, two jobs:
  - **test** — Node 20.x and pnpm 10: install with a frozen lockfile, then `lint`, `typecheck`, and `test:coverage` (with coverage thresholds enforced by `vitest.config.ts`); coverage uploads to Codecov with `fail_ci_if_error: false`.
  - **web** — installs `src/web` dependencies, then lints, unit-tests, and builds the web app.
- **`openwiki-update.yml`** — schedules a daily OpenWiki refresh (and supports manual dispatch). It checks out full history, installs the OpenWiki CLI, runs `openwiki code --update`, removes transient run state, and opens a `docs: update OpenWiki` pull request; if the generation fails, the PR still preserves completed pages.

## Test suite

Tests are Vitest, run from the repo root with `tests/setup.ts` as a global setup (`vitest.config.ts`). `pnpm exec vitest run` runs them once; bare `pnpm test` starts the watcher and never exits. The root config includes only `tests/**/*.test.ts` (the web app has its own package and config), enforces coverage thresholds (statements/lines 25, branches 55, functions 40 as a floor below the current baseline), and excludes `src/web/`, `.claude/`, and `scripts/` from coverage.

- **`tests/unit/`** — `academic.test.ts` (constructor normalization, error classes, academic-year calculation, request/retry paths, parsers, Redis-backed JSON getters, session validation/renewal), `academicTG.test.ts` / `academicTG-errors.test.ts` (message formatting and error mapping), `storeMidmarks.test.ts`, `student_stats.test.ts` (real in-memory SQL for leaderboard ranking and uptime buckets), `security.test.ts` (roll validation, bot rate limiter, rate-limit factory), `syncdb.test.ts` (`buildStudentRow`), `constants.test.ts`, `trustProxy.test.ts`, `telegramAuth.test.ts` (initData HMAC verification, replay window, tampering), `adminAuth.test.ts` (HMAC token hashing, cookie parsing, login-attempt limiting), `tracker.test.ts` (NX-gated profile upserts, supergroup normalization), `reportModel.test.ts` / `reportCommand.test.ts` (report threads, statuses, and the `/report` command), `groupLimit.test.ts` (private/admin bypass, the 2-answer limit with redirect, fail-open).
- **`tests/integration/`** — `academic.integration.test.ts` (fetch-to-format flows), `adminRoutes.test.ts` (panel auth gates, session lifecycle, overview/users endpoints against a mocked in-memory database client), `adminReports.test.ts` (report endpoints in the panel), `apiRoutes.test.ts` (leaderboard envelope and validation, /api/me identity paths, health, status), `profileRoutes.test.ts` (registration model upsert semantics and the profile/register endpoints), `reportRoutes.test.ts` (report submission and thread routes), `reportThreadMigration.test.ts` (the legacy-report backfill against in-memory SQL).
- **`tests/mocks/academic.mock.ts`** — canned student, attendance, and midmarks fixtures.
- **`src/web/tests/`** — `api.test.ts` and `format.test.ts`, run by the web package's own Vitest config (`src/web/vitest.config.ts`).

Safety properties matter operationally:

1. `vitest.config.ts` forces `TURSO_DATABASE_URL=file::memory:` and `tests/setup.ts` blanks `LOCAL_DB_URL`, so neither a stray production URL nor the embedded-database override can point tests at production.
2. `tests/setup.ts` seeds fake Telegram, portal, Redis, database, channel, and port values — and sets `ADMIN_PANEL_PATH`/`ADMIN_PANEL_PASSWORD` to empty (not deleted, because dotenv would re-fill deleted vars from a developer's `.env`) — so real credentials can never leak into tests. Mocks are cleared before each test.
3. External services are always mocked — no real HTTP or Redis calls.

## Related pages

- [Overview](overview.md)
- [Runtime Architecture](architecture.md)
- [Web Leaderboard](web/leaderboard.md)
- [Registration and Profile](registration.md)
