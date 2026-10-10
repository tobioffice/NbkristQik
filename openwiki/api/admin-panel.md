---
type: operations
title: Admin Panel
description: Private password-protected admin dashboard for bot activity tracking and service health, served by the Express API under a secret path with HMAC session auth and IST-bucketed SQL aggregations.
tags: [admin, dashboard, authentication, activity-tracking, uptime]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-09T23:13:13.880Z
sources:
  - id: openwiki-source-ea1d2fdd0d2b68c1b024e6f6
    resource: repo://src/api/admin/auth.ts
  - id: openwiki-source-8dedbd5a9c72acbade7f0b98
    resource: repo://src/api/admin/cache.ts
  - id: openwiki-source-7761c23d86d682c298b64ffd
    resource: repo://src/api/admin/feed.ts
  - id: openwiki-source-1d128f3d8b1157d4169fee6d
    resource: repo://src/api/admin/index.ts
  - id: openwiki-source-f88a777245b67f6fda15b7fc
    resource: repo://src/api/admin/login.ts
  - id: openwiki-source-72d4b67c4e7ef2f08831d318
    resource: repo://src/api/admin/overview.ts
  - id: openwiki-source-11cde84f639055a5577cbbad
    resource: repo://src/api/admin/panel.js.ts
  - id: openwiki-source-dd98b614f4f0a2fae8016a64
    resource: repo://src/api/admin/users.ts
  - id: openwiki-source-8f6c21fe62cb595911ecfa15
    resource: repo://src/api/adminPanel.ts
  - id: openwiki-source-714e0c91fd122c36f3217aa4
    resource: repo://src/api/server.ts
  - id: openwiki-source-40646dc6b42fe5872ce25e48
    resource: repo://src/db/student_stats.model.ts
generated: { by: "opencode", at: "2026-10-09T23:13:13.880Z" }
---

# Admin Panel

The admin panel is a private, password-protected dashboard for bot operators, served by the same Express app as the public API. It tracks student activity (who uses the bot, from which Telegram surface — private chat, group, or channel — and how often) and shows service health alongside a live feed. The routes live in the `src/api/admin/` module directory; the single-page frontend is composed in `src/api/adminPanel.ts` from assets in `src/api/admin/panel.css.ts` and `src/api/admin/panel.js.ts`.

## Module map

| Module | Responsibility |
|---|---|
| `src/api/admin/index.ts` | `registerAdminRoutes`: env gating, requireAdmin creation, route wiring |
| `src/api/admin/auth.ts` | Session/cookie/token primitives, login-attempt limiting, `requireAdmin` |
| `src/api/admin/login.ts` | `POST {base}/login`, `POST {base}/logout` |
| `src/api/admin/cache.ts` | Short-TTL in-memory response cache (`cached`) |
| `src/api/admin/overview.ts` | `GET {base}/api/overview` |
| `src/api/admin/users.ts` | `GET {base}/api/users`, `GET {base}/api/users/:id` |
| `src/api/admin/feed.ts` | `GET {base}/api/recent`, `GET {base}/api/health` |
| `src/api/admin/panel.css.ts` / `panel.js.ts` | Panel CSS and client JS extracted from the HTML template |

## Mounting and enable/disable behavior

`registerAdminRoutes(app)` in `src/api/admin/index.ts:22` is called from `src/api/server.ts` **before** the global security middleware stack. That ordering is deliberate: the global `sanitizeInput` middleware strips angle brackets from `req.body`, which would mangle admin passwords containing `<` or `>`. The admin panel has its own auth instead.

The panel is disabled entirely unless both environment variables are set (`src/api/admin/index.ts:23-30`):

- `ADMIN_PANEL_PATH` — an unguessable path segment, normalized by trimming leading/trailing slashes and mounted as `/{secretPath}`.
- `ADMIN_PANEL_PASSWORD` — the shared password for sign-in.

When either is missing, `registerAdminRoutes` logs that the panel is disabled and returns without registering any routes.

## Authentication and sessions

Login (`POST {base}/login`) compares the submitted password with `crypto.timingSafeEqual` (`src/api/admin/auth.ts:15-20`). On success it generates a 32-byte random token and stores **only** `HMAC-SHA256(token, ADMIN_PANEL_PASSWORD)` in the `admin_sessions` table (`tokenHash`, `src/api/admin/auth.ts:32-33`):

- The raw token never exists in the database.
- Because the HMAC key is the password, changing `ADMIN_PANEL_PASSWORD` instantly invalidates every existing session.
- The cookie `qik_admin` is `HttpOnly`, `SameSite=Strict`, `Secure` in production, scoped with `path = base`, and lives for 24 hours (`SESSION_TTL_SECONDS`, `src/api/admin/auth.ts:6`).

Login is rate-limited per IP to 5 attempts per 10-minute window (`tooManyAttempts`, `src/api/admin/auth.ts:35-63`; the attempts map is pruned past 1000 entries). `POST {base}/logout` deletes the caller's session row and opportunistically prunes expired sessions.

Every data endpoint runs through the `requireAdmin` middleware (`createRequireAdmin`, `src/api/admin/auth.ts:72-102`), which looks up the cookie token's hash in `admin_sessions` with an `expires_at > datetime('now')` guard and returns 401 otherwise.

## Response caching

The panel polls, so every request must not become a Turso query — the server has a low read quota and little RAM. `cached(key, ttlMs, produce)` (`src/api/admin/cache.ts`) is a small in-memory `Map` cache with a 200-entry eviction cap that fronts the read-heavy endpoints. TTLs are chosen per endpoint (below).

## Endpoints

| Method | Path | Auth | Cache | Response |
|---|---|---|---|---|
| `POST` | `{base}/login` | — | — | `{ok:true}` or `{error}` |
| `POST` | `{base}/logout` | yes | — | `{ok:true}` |
| `GET` | `{base}` | — | — | panel HTML shell (data endpoints all require auth) |
| `GET` | `{base}/api/overview` | yes | 60 s | totals, `daily`, `hourly`, `surfaces`, `topActions` |
| `GET` | `{base}/api/users` | yes | 20 s | `{users:[…]}` searchable/sortable table |
| `GET` | `{base}/api/users/:id` | yes | — | `{profile, recent, daily}` |
| `GET` | `{base}/api/recent` | yes | 5 s | `{events:[…]}` live feed (polled every 10 s) |
| `GET` | `{base}/api/health` | yes | 300 s | uptime components with 90-day daily buckets |

### Overview

`/api/overview` runs a single `turso.batch(…, "read")` of nine queries (`computeOverview`, `src/api/admin/overview.ts`) producing:

- **Totals** — all users, active today, active 7 d, active 30 d, and summed `total_actions`.
- **`daily`** — a 30-day series of actions, distinct users, and daily check-ins per IST day.
- **`hourly`** — a 30-hour series of actions, users, and check-ins per IST hour (used by the pulse chart and the client-side "check-ins today" count).
- **`surfaces`** — a 30-day split of activity by chat surface, normalizing `supergroup` to `group`.
- **`topActions`** — the top 8 action names over 7 days, excluding `roll_lookup`.

### Users and user detail

`/api/users` accepts `q` (trimmed and capped at 40 chars), `sort` (`recent` by `last_seen` or `total` by `total_actions`), and `limit` (1–500, default 200). It joins `botusers` to `tgusers` on `CAST(u.user_id AS TEXT) = t.userId` so each row also carries the student's roll number (`registerUsersRoutes`, `src/api/admin/users.ts`). Each keystroke lands here (debounced 250 ms client-side), hence the 20 s cache keyed by `users:{q}:{sort}:{limit}`.

`/api/users/:id` returns the profile plus the 60 most recent `activity_log` rows and a 30-day daily count series for the drawer view.

### Live feed and health

`/api/recent` returns the newest activity rows joined to `botusers` for display names (`registerRecentRoute`, `src/api/admin/feed.ts`). `/api/health` reuses `getUptimeSummary` and `getUptimeDailyBuckets` from the stats model — the same data as the public status page — and caches for 5 minutes because uptime data only changes on the 5-minute probe.

## IST time bucketing

Activity is stored in UTC (`datetime('now')` defaults). All day and hour grouping shifts timestamps by `+330 minutes` — IST is UTC+5:30 — so charts and "today" counters follow Indian wall-clock boundaries, including a calendar-day boundary at 18:30 UTC:

- Day buckets: `date(created_at, '+330 minutes')`
- Hour buckets: `strftime('%Y-%m-%d %H', created_at, '+330 minutes')`
- "Today": `last_seen >= datetime('now', 'start of day', '-330 minutes')`

The client mirrors this: `istTime` / `istDate` use `Intl.DateTimeFormat` with `timeZone: "Asia/Kolkata"`, and "check-ins today" is summed from the hourly buckets whose IST date prefix matches today.

## The panel client

`adminPanelHtml()` (`src/api/adminPanel.ts`) returns one self-contained HTML document, composing CSS from `src/api/admin/panel.css.ts` and client JS from `src/api/admin/panel.js.ts` into the template. The extracted assets keep the served HTML byte-identical to the previous single-template version. No external assets beyond the Outfit webfont with a system fallback.

Four views are navigated by tab buttons (`switchView`):

- **Overview** — hero counters with a count-up animation, a 30-day / 30-hour pulse chart (SVG), the surface split bar, and top-action weight bars.
- **Students** — debounced search, sort toggle, and a clickable table row per student opening a detail drawer with a 30-day mini chart and recent activity.
- **Live** — a 10-second poll of `/api/recent` while the tab is active and the document is visible.
- **Health** — one row per component with 90 day-bars colored green (all up), red (some down), or missing.

Client-side staleness checks (`STALE_MS = {overview: 60000, students: 30000, live: 0, health: 300000}`) mirror the server-side cache TTLs so tab switches do not re-query unnecessarily. The live view refetches on every switch. A 401 from any endpoint drops the client back to the login screen.

All user-supplied strings rendered into the DOM pass through an `esc()` helper, and the page sets `noindex,nofollow`.

## Related pages

- [REST API and Security](server.md)
- [Database Schema and Models](../data/database.md)
- [Caching and Leaderboard Stats](../data/caching-and-stats.md)
