# NbkristQik Architecture

> **Note:** Deep, source-grounded documentation is generated in [`openwiki/`](openwiki/quickstart.md)
> and refreshed by CI. This file is a concise hand-maintained overview; if the two
> disagree, the code and `openwiki/` are authoritative.

## Overview

NbkristQik is a Telegram bot that lets NBKRIST students check attendance and
mid-term marks by scraping the college portal. One Node process serves:

- the Telegram bot (long polling),
- an Express REST API and the same-origin web app at `/library/`,
- the public status page at `/status`,
- a private, password-protected admin panel for activity tracking and health.

A second, standalone program on another host (oracle2) probes the production
API, the college portal and the private deep-health endpoint, then posts the
results back.

```
Telegram users ──> bot handlers ──> portal scraper ──> college portal
                       │                 │
                       ├──> Redis <──────┘
                       ├──> SQLite / Turso
                       └──> activity tracker ──> SQLite / Turso
Students ──> Express /library/ + /api/* ──> Redis + SQLite / Turso
Operator ──> Admin panel (Express, session cookie)
Monitor (oracle2) ──> /health, /internal/health, portal
                       └──> POST /internal/uptime ──> SQLite / Turso
```

## Runtime

- **Entry point:** `src/bot/index.ts`. It awaits `initDatabase()` (connection
  pragmas, schema version check, tables), sets up the Telegram command menu,
  imports every handler module (registration is an import side effect), starts
  the in-process uptime probe during the monitor transition, starts daily
  maintenance and the Express server, and only then calls
  `bot.startPolling()`.
- **Shutdown:** `SIGINT`/`SIGTERM` stop polling, disconnect Redis, and exit 0.
- **Bot:** `node-telegram-bot-api`; see `src/bot/` for commands, the academic
  menu flow, the channel-membership gate, the daily check-in post, and
  `/syncdb`. The check-in post records the day for engagement; nothing is
  gated on it. Channel membership remains the gate for non-admin students.
- **Web shell:** one shipped app at `/library/` with hash routes `#/rank`,
  `#/profile`, `#/library` and `#/issues`. `/api/config` decides whether the
  library tab exists for this caller; the server enforces the same gate on the
  library API. The legacy GitHub Pages app build is retired; the marketing site
  remains a separate static surface.

## HTTP surface

- **Bind:** `src/api/server.ts` listens on `HOST` (default `127.0.0.1`) and
  `PORT` (default `3000`). nginx terminates TLS and proxies to loopback; the
  API is not meant to be reachable directly. One trusted proxy hop
  (`trust proxy` = 1) gives Express the real client IP.
- **CORS:** `CORS_ORIGINS` is a comma-separated allowlist, default
  `https://checker.tobioffice.dev`. The app and status page are same-origin and
  need no entry.
- **Static first:** `/library` is mounted before the API security middleware
  from `LIBRARY_WEB_DIR` (default `public/library`). HTML is `no-cache`;
  hashed `/assets/*` are `public, max-age=31536000, immutable`; other files
  get a one-hour cache. `/status` sends the file from `public/status/index.html`
  with `Cache-Control: no-store` and a clean JSON 404 if the deploy did not
  copy it.
- **API:** `/health`, `/api/*` including `/api/config`, `/api/leaderboard`,
  `/api/me`, profile/registration, reports and library endpoints. They pass
  through suspicious-request logging, body sanitization and an IP rate limit;
  validation and route-specific limits sit on top.
- **Admin:** mounted at the secret `ADMIN_PANEL_PATH`, before the global API
  sanitizer and limiter. The panel document carries a fresh nonce CSP,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `nosniff`; data
  endpoints require the `qik_admin` session cookie.
- **Private monitor routes:** `/internal/health` and `/internal/uptime` exist
  only when `UPTIME_INGEST_SECRET` is at least 32 characters, require a
  constant-time bearer check, and are additionally restricted to oracle2 at
  nginx.

## Identity flow

`resolveOptionalIdentity()` in `src/api/resolveUser.ts` distinguishes
"nothing presented" (anonymous) from "something presented but invalid"
(invalid):

1. `X-Telegram-Init-Data` header (preferred, and what the shipped web client
   sends).
2. `initData` query parameter (legacy).
3. `initData` in a JSON body (legacy POST shape).

Only the first present source is used. A bad header is not rescued by a valid
query string. `verifyInitData()` checks the HMAC against the bot token, a
24-hour `auth_date` window and a 5-minute future-skew allowance. A presented
but invalid identity is `401` on `/api/leaderboard`, `/api/config`, `/api/me`
and the other identity routes; it is never silently downgraded to anonymous.

The unsigned numeric `userId` shortcut requires `ALLOW_DEV_IDENTITY=1` or
`ENV=test`; `ENV=development` alone is not enough. `ENV` defaults to
`production`.

The same identity decision drives the leaderboard's privacy:

- Anonymous: `name` is `NULL`, search matches rolls only, HTTP cache is public.
- Verified: names and name search, HTTP cache is private.
- Redis keys include the `names`/`anon` mode, so the two payloads are never
  mixed.
- A non-empty `display_name` from `registrations` overrides the college name
  for that roll.

The library has a second step: `POST /api/library/session` verifies signed
`initData` and exchanges it for an HttpOnly, SameSite=Strict session cookie.
The app is served from the same origin as the API, so that cookie stays
first-party and survives iOS WKWebView. Only a registered roll can see
subjects, and every page request re-checks entitlement.

## Data layer

- **SQLite (embedded) or Turso** — all persistence. `LOCAL_DB_URL` selects a
  local file; otherwise `TURSO_DATABASE_URL` selects Turso. The embedded
  database enables `WAL`, `busy_timeout=5000`, `synchronous=NORMAL` and
  `foreign_keys=ON`. `PRAGMA user_version = 1` versions the schema; a database
  newer than the build refuses to start.
- **Schema:** `studentsnew`, `tgusers`, `registrations`, `student_stats`,
  `fallbackResponses`, `botusers`, `activity_log`, `reports`,
  `report_messages`, `report_reads`, `library_documents`, `library_reads`,
  `admin_sessions`, `uptime_log`.
- **Redis** — caches student records (7d), attendance (1h), midmarks (2h) per
  roll, leaderboard responses (60s), membership (1d), the tracker's per-user
  write throttle, and library sessions. Leaderboard stats are written to the
  database independently of Redis, so a cache outage cannot stop ranking data
  from landing.
- **Retention:** a startup prune plus a daily job removes
  `uptime_log`, `activity_log` and `library_reads` rows older than 95 days, and
  expired `admin_sessions`.

## Scraping

`src/services/student.utils/` contains the portal integration: a generated
`PHPSESSID` session, login/renewal, retry on transient network errors, parse
helpers for attendance and midmarks, fallback to the last cached section
response, and typed errors (`ServerDownError`, `BlockedReportError`,
`NoDataFoundError`, `InvalidCredentialsError`, `StudentNotFoundError`).
`/syncdb` shares the same login and parsing helpers; its scrape is fail-closed,
and its upsert is an atomic batch per chunk.

## Leaderboard ranking

Scores are projected into `student_stats` when a section response is cached.
Ranks use `RANK()` over the **rounded** score only; the deterministic tiebreak
(`roll_no`) is applied in the outer `ORDER BY`. Adding a tiebreaker inside the
window `ORDER BY` makes Turso compute ranks over the full composite and collapse
ties — see the notes in `src/db/student_stats.model.ts`.

The displayed name is `COALESCE` of the newest non-empty registration
`display_name` for the roll and the `studentsnew` college name. The name is
selected as a scalar subquery, not by joining `registrations`, so duplicate
historical rows cannot duplicate leaderboard rows.

## Deployment topology

- **oracle3** runs the `nbkristqik` systemd service: bot, Express on
  `127.0.0.1:3000`, admin panel and status data. nginx terminates TLS for
  `checker.tobioffice.dev`, serves nothing itself beyond the proxy, and can
  restrict `/internal/` to the monitor host.
- **Static surfaces:** `src/status` → `public/status`, and the
  `src/web/dist-library` bundle → `public/library`; both are synced by
  `scripts/deploy.sh`. The app's HTML revalidates on every open and its hashed
  assets are immutable, so a deploy is picked up without pinning an old bundle.
- **Deploy:** `scripts/deploy.sh` refuses a dirty tree unless
  `ALLOW_DIRTY_DEPLOY=1`, runs typecheck/lint/tests and builds locally, keeps
  the previous server build at `dist.prev`, takes a `VACUUM INTO` backup when
  `DEPLOY_DB_URL` is set, syncs the build and static surfaces, restarts the
  service, and smoke-checks `/health`, `/status`, `/library/` and optionally
  the authenticated `/internal/health`. Any failure restores `dist.prev`,
  restarts the previous build and exits non-zero.
- **oracle2** runs `nbkristqik-uptime` with `src/monitor/index.ts`: it probes
  the public API, the portal and `/internal/health`, spools heartbeats locally
  while the API is unreachable, and posts them when it returns. It alerts only
  on a state transition (including a fresh-state down), and never invents
  database or Redis downtime it did not observe.
- **Transition:** the older in-process probe in `src/services/uptime.ts` is
  still restored and started until the external monitor has produced fresh
  heartbeats in the 90-day history. Both sources write `uptime_log`.
- **GitHub Pages** hosts the separate static marketing site under `/site/`.
  The old Pages app build and its standalone pages are retired; the only web
  app is the same-origin `/library/` build.

## Further reading

- [`openwiki/quickstart.md`](openwiki/quickstart.md) — wiki entry point
- [`openwiki/architecture.md`](openwiki/architecture.md) — runtime topology
- [`openwiki/portal/scraping.md`](openwiki/portal/scraping.md) — portal details
- [`openwiki/data/caching-and-stats.md`](openwiki/data/caching-and-stats.md) — caches and ranking
- [`openwiki/api/admin-panel.md`](openwiki/api/admin-panel.md) — admin panel
