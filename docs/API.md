# NbkristQik REST API

> **Note:** The generated wiki is authoritative for endpoint behavior; see
> [`openwiki/api/server.md`](openwiki/api/server.md) and
> [`openwiki/api/admin-panel.md`](openwiki/api/admin-panel.md). If this file
> disagrees with the code, the code wins.

The API is served by the Express app in `src/api/server.ts`, started in-process
by the bot entry point. It binds `HOST` (default `127.0.0.1`) on `PORT`
(default `3000`); production is reached through nginx at
`https://checker.tobioffice.dev`. The app trusts one proxy hop (`trust proxy`
= 1) so `req.ip` and the rate limits see the real client address.

CORS allows the origins in `CORS_ORIGINS` (comma-separated, default
`https://checker.tobioffice.dev`). The shipped app and status page are
same-origin, so they need no CORS entry; add another origin only for a
separate frontend. Public routes pass through a security middleware stack:
suspicious-request logging, body sanitization, and an IP rate limit of 600
requests / 15 minutes.

## Authentication and identity

Routes that need a caller identity accept signed Telegram WebApp `initData`
in the **`X-Telegram-Init-Data`** header. This is the preferred form: a header
does not land in URLs, nginx access logs, browser history or `Referer`.

For compatibility, the server still reads the first present source in this
order:

1. `X-Telegram-Init-Data` header
2. `initData` query parameter (legacy)
3. `initData` in a JSON body (legacy POST shape)

Only the first source that is present is used. A bad header is a bad identity
even when a valid query string is also attached. `initData` longer than 4096
characters is rejected.

`POST /api/library/session` is the one exception to the header preference: it
reads `initData` from its JSON body only, because its job is to mint the
library session cookie. Every later library call uses that cookie instead of
`initData`.

A **presented but invalid** identity is never downgraded to anonymous: the
request fails with `401` on `/api/leaderboard`, `/api/config`, `/api/me` and
the other identity routes. Anonymous callers are allowed only where the route
is explicitly public. Signed `initData` is checked against the bot token with
HMAC-SHA256, a 24-hour `auth_date` replay window and a 5-minute future-skew
allowance.

The unsigned numeric `userId` query/body shortcut is a development convenience
only. It requires `ALLOW_DEV_IDENTITY=1` (or `ENV=test` for the test suite);
`ENV=development` alone is not enough. `ENV` defaults to `production`, so a
deployment that forgets to set it does not inherit the shortcut.

| Route | Anonymous | Verified Telegram identity |
|---|---|---|
| `GET /api/leaderboard` | allowed; `name` is `null`, search matches rolls only | names; search matches rolls and names |
| `GET /api/config` | allowed; both flags `false` | flags reflect the caller |
| `GET /api/me` | `401` | allowed |
| `/api/profile`, `/api/register`, `/api/report`, `/api/thread/*` | `401` | allowed |
| `POST /api/library/session` | `401` without signed `initData` in the body | sets the `nbq_lib` session cookie |
| other `/api/library/*` | `401` without that cookie | cookie from the session exchange |

## Rate limits

The API limiter is per Telegram account when the caller proved an identity,
and per network address for anonymous callers. A shared campus NAT no longer
puts every student on one 600-request budget; a generous per-IP backstop still
caps anonymous abuse. Identity-scoped pacing (the report 60-second gate, the
library read-burst check) lives in the service that knows the caller.

| Scope | Limit |
|---|---|
| Global API middleware | 600 / 15 min per account, plus a 10,000 / 15 min per-IP backstop |
| `POST /api/register` | 20 / 15 min per account (on top of the global limit) |
| `POST /api/report` | 5 / 15 min per account, plus a 60 s per-user gate in the service |
| `/api/thread/*` | 120 / 15 min per account, plus a 3 s per-user gate on follow-ups |
| `POST /api/library/session` | 20 / hour per account (other library calls use the global limit) |
| `/internal/*` | 120 / 15 min (on top of the global limit) |
| Admin `POST {base}/login` | 20 requests / 10 min burst, plus a 5-failure / 10 min lockout |

`/health` has no dedicated limiter but is mounted after the global API
middleware, so it shares the account/IP limit. `/api/status` also uses the
global limit. The static `/status` page and the `/library/` bundle are mounted
before the API middleware and are not rate-limited.

The rate-limit response is `429 { "success": false, "error": "...", "retryAfter": <seconds> }`.

## Public endpoints

### `GET /api/leaderboard`

Paginated, filterable leaderboard rows.

| Param | Type | Default | Rules |
|---|---|---|---|
| `page` | int | 1 | 1–1000 |
| `limit` | int | 50 | 1–100 |
| `sort` | string | `attendance` | `attendance` or `midmarks` |
| `scope` | string | `me` for a verified caller, `all` otherwise | `me` or `all` |
| `year` | string | — | year digit `1`–`4` (legacy `11`/`12` also accepted) or `all` |
| `branch` | string | — | portal branch digits or `all` |
| `section` | string | — | single letter or `all` |
| `search` | string | — | 2–20 chars: letters, digits, underscores, spaces or dashes |

`scope=me` applies the caller's saved registration's year/branch/section
unless an explicit non-`all` filter overrides it. `all` means "no filter"; the
web client omits dimensions it does not want to filter. An explicit `all`
value suppresses the caller scope and is treated as a whole-register request.
Anonymous callers are always `all`.

Invalid parameters return
`400 { "success": false, "error": "Validation failed", "details": [...] }`.

The response is identity-aware:

- **Anonymous** callers get `name: null` on every row, and `search` matches
  roll numbers only. This keeps a public page from harvesting a name for every
  roll.
- **Verified Telegram identity** callers get the leaderboard name and can
  search by name as well as roll. A non-empty `display_name` saved in
  `registrations` overrides the college name for that roll.

Rows and `total` always come from the same filtered set. `total` is the number
of students actually ranked in this view, not the size of the college. Page 1
also carries the sections that exist for the chosen year/branch and the
coverage/freshness metadata; later pages return `null` for those extras.

- `coverage: { ranked, known }` — `ranked` is `total`; `known` is the number of
  students in `studentsnew` matching the same filters. It is `null` for a
  search or a page after the first. A partial register must print both.
- `freshness: { newest, oldest }` — the newest and oldest write behind the
  ranked view (per metric, UTC SQLite datetime). `oldest` matters because the
  register fills as students check.
- `scope: { year, branch, section } | null` — the effective filter context,
  not the caller's identity.
- `updated_at` remains `freshness.newest` for one release.

The payload is cached in Redis for 60 seconds per unique query. Cache keys are
segregated by identity mode (`names` vs `anon`), scope mode, and the resolved
`year:branch:section`; two `scope=me` callers in different sections can never
share a page. HTTP caching is `Cache-Control: public, max-age=30` for anonymous
responses and `private, max-age=30` for identified ones, with
`Vary: X-Telegram-Init-Data`. The anonymous default views are refreshed every
50 seconds on a remote database; the loop is disabled on the embedded database.

```json
{
  "success": true,
  "page": 1,
  "limit": 50,
  "total": 245,
  "updated_at": "2026-10-25 10:00:00",
  "freshness": { "newest": "2026-10-25 10:00:00", "oldest": "2026-10-19 08:00:00" },
  "scope": { "year": "3", "branch": "5", "section": "A" },
  "coverage": { "ranked": 245, "known": 1200 },
  "facets": { "sections": ["A", "B", "C"] },
  "data": [
    {
      "roll_no": "21B81A05E9",
      "name": null,
      "attendance_percentage": 95.5,
      "mid_marks_avg": 18.75,
      "rank": 1
    }
  ]
}
```

A verified caller receives the same envelope with the resolved name in place
of `null` and `Cache-Control: private, max-age=30`. Ranks are computed over the
full filtered set, with the rounded score the register prints (2 decimal
places for attendance, 1 for mid marks).

### `GET /api/config`

Public, identity-aware feature flags. No identity is required; a provided but
invalid one is `401`, so a broken Telegram client does not silently look
anonymous.

```json
{ "libraryOpen": true, "admin": false }
```

- `libraryOpen` is `true` for the admin while `LIBRARY_ACCESS=admin` (the
  default), and for every caller once `LIBRARY_ACCESS=all`.
- `admin` is `true` only for the admin while the library is still admin-only
  (the preview affordance). It is `false` for everyone once the library is
  open to all.
- Anonymous callers get `{ "libraryOpen": false, "admin": false }`.

The response is `Cache-Control: no-store` because it depends on the caller.
The web shell treats the library as closed until this route answers, and hides
the library tab and route when `libraryOpen` is `false`.

### `GET /api/me`

Returns the caller's saved roll and global ranks, each with the rounded score
the register prints (`value`) so the personal strip and the row agree. A
verified identity is required; an anonymous request or an invalid one is
`401 { "found": false, "error": "..." }`.

Identity is the registration, never the last lookup. `tgusers` is auto-upserted
by every roll lookup, including a friend's, so it is returned separately as a
suggestion:

- Registered: `{ found: true, source: "registered", roll_no, attendance, midmarks }`.
- Not registered: `{ found: false, lastLookup: "<roll>|null" }`; no rank queries
  run.

```json
{
  "found": true,
  "source": "registered",
  "roll_no": "21B81A05E9",
  "attendance": { "rank": 12, "total": 245, "value": 95.5 },
  "midmarks": { "rank": 30, "total": 245, "value": 18.8 }
}
```

Ranks are global over all ranked students in the register, not over the
current filters. `Cache-Control: private, no-store`.

`DELETE /api/me/last-lookup` removes the caller's suggestion row; the
registration is untouched.

### `GET /api/me/academics`

Structured JSON for the app's first screen. A verified identity and a saved
registration are required; an unregistered caller gets
`200 { ok: false, registered: false }` (not an error). `type` is
`attendance` (default) or `midmarks`.

```json
{
  "ok": true,
  "registered": true,
  "type": "attendance",
  "rollNo": "23KB1A0599",
  "data": {
    "rollno": "23KB1A0599",
    "year_branch_section": "3_CSE_A",
    "percentage": 82.22,
    "totalClasses": { "attended": 148, "conducted": 180 },
    "subjects": [
      { "subject": "DBMS", "attended": 22, "conducted": 30, "lastUpdated": "12-10-2025" }
    ]
  },
  "freshness": { "notice": null, "source": "live" }
}
```

`freshness.source` is `live`, `cached`, or `fallback`; `notice` is the
human-readable line to show. Success is
`Cache-Control: private, max-age=60`; errors are `private, no-store`. Expected
portal failures return `404 NO_DATA`/`NO_STUDENT` or `503
SERVER_DOWN`/`REPORT_BLOCKED` with `{ ok: false, registered, type, rollNo,
error, code }`.

### `GET /health`

Liveness probe with no dedicated limiter (it still passes the global API
limit):

```json
{
  "status": "ok",
  "timestamp": "2026-11-04T12:00:00.000Z",
  "uptime": 12345.6,
  "version": "1.0.0"
}
```

### `GET /api/status`

90-day uptime summary per component with daily buckets. A component is
`current: "up"` only when its newest heartbeat says `up` and is under 15
minutes old. `stale: true` means the monitor has not reported recently, which
is different from a recorded outage. The assembled payload is cached in memory
for 5 minutes.

Each component carries `component`, `uptimePct`, `pings`, `lastPing`,
`lastPingAgeSec`, `avgLatencyMs`, `current`, `stale` and `buckets`, where each
bucket is `{ day, pings, ups, avgLatencyMs }` in IST calendar days.

### `GET /status`

The public status page itself, served by Express from
`public/status/index.html` (the deploy copies `src/status` there). It is a
single static HTML file with no external font or script request; it fetches
`/api/status` for its data. `Cache-Control: no-store`. If the file is missing,
the route answers `404 { "success": false, "error": "Not Found" }` instead of
crashing the API. `STATUS_PAGE_PATH` can point the route at another file for
development.

## Library endpoints

The library uses a session cookie, not the API identity header. Exchange
signed `initData` once, then send the `nbq_lib` cookie on every later call. The
session is HttpOnly, SameSite=Strict, `Secure` in production, and lasts 12
hours; the session exchange is additionally limited to 20 requests / hour per
IP.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/library/session` | Verify `{initData}` in the body, set the cookie, return `{ok, registered, student}`; `401` on a bad signature, `403` while `LIBRARY_ACCESS=admin` and the caller is not the admin |
| `DELETE` | `/api/library/session` | Drop the session and clear the cookie |
| `GET` | `/api/library/me` | The session's user and student summary (`registered` is false without a saved roll) |
| `GET` | `/api/library/subjects` | The student's own subjects for the running semester, with units and live status; while the shelf is admin-only, the admin may use `?view=all` for the whole shelf, `?view=roll` for exactly the registered roll's view |
| `GET` | `/api/library/document/:id` | One document's metadata: id, code, title, unit, pages, version; `404` if missing or not live, `403` if not the reader's |
| `GET` | `/api/library/page/:id/:page` | One watermarked SVG page (`Cache-Control: no-store, private`, `Content-Disposition: inline`, no text layer). `400`/`404` for a bad page, `503` when no watermark secret is configured |

## Private monitor endpoints

Registered only when `UPTIME_INGEST_SECRET` is set **and** at least 32
characters long; otherwise both routes are absent and answer `404`. They are
additionally restricted at nginx to the monitor host. Both require
`Authorization: Bearer <UPTIME_INGEST_SECRET>`; a missing or wrong secret is
`401 { "success": false, "error": "Unauthorized" }`. The secret is compared in
constant time.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/internal/health` | Deep check of the database (`SELECT 1`) and Redis (`PING`) for the external monitor |
| `POST` | `/internal/uptime` | Store 1–200 heartbeat rows from the monitor |

`GET /internal/health` answers `200` with the dependency results even when one
is down; each probe has a 3-second timeout.

```json
{
  "success": true,
  "components": [
    { "component": "database", "status": "up", "latencyMs": 3 },
    { "component": "redis", "status": "up", "latencyMs": 1 }
  ]
}
```

`POST /internal/uptime` takes `{ "rows": [ ... ] }`, with 1–200 rows shaped
`{ "component": "api|portal|database|redis", "status": "up|down", "latencyMs": <int|null>, "at": "YYYY-MM-DD HH:MM:SS" }`.
`at` is UTC in SQLite's timestamp format, no older than 95 days and no more
than 10 minutes in the future. Duplicate `(component, at)` rows are ignored,
so replaying a spooled batch after an outage is safe. Success is
`{ "success": true, "stored": <rows.length> }`; bad rows are `400`, and a write
failure is `500`.

## Admin endpoints

Mounted under the secret `ADMIN_PANEL_PATH` and disabled unless both
`ADMIN_PANEL_PATH` and `ADMIN_PANEL_PASSWORD` are set. In production the panel
refuses to mount at all when the password is shorter than 16 characters (tests
run under `ENV=test`).

The panel document is sent with a fresh per-request nonce CSP,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
`X-Content-Type-Options: nosniff` and `Cache-Control: no-store`. Sign in with
`POST {base}/login`; the session cookie `qik_admin` is HttpOnly,
SameSite=Strict, `Secure` in production, and lasts 24 h. Data endpoints require
it and are short-TTL cached in memory.

Login has two layers: a 20-request / 10-minute burst limiter, and a
5-failure / 10-minute per-IP lockout. Only wrong passwords count as failures;
checking the lock is read-only, and a successful login clears the counter.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `{base}/login` | Password sign-in |
| `POST` | `{base}/logout` | End session |
| `GET` | `{base}` | Panel UI |
| `GET` | `{base}/api/overview` | Totals, 30-day and 30-hour series, surfaces, top actions |
| `GET` | `{base}/api/users` | Searchable/sortable student table |
| `GET` | `{base}/api/users/:id` | Profile + recent activity + 30-day shape |
| `GET` | `{base}/api/recent` | Live activity feed |
| `GET` | `{base}/api/health` | Uptime health (same data as `/api/status`) |

Day and hour groupings use IST (`+330 minutes`); storage stays UTC.

## Profile / registration endpoints

Optional registration lets students pin their default roll (Telegram Web App
form via `/register`); `/attendance`, `/midmarks`, and `/bunk` resolve it.
Identity rules match `/api/me` (signed `X-Telegram-Init-Data`, with the gated
dev `userId` shortcut). `POST /api/register` is additionally limited to 20
requests / 15 min per account.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/profile` | `{found:true, registration:{roll_no, display_name,...}, student}`; `{found:true, stale:true, registration, student:null}` when the saved roll left the college master table; or `{found:false, lastLookup, suggestion}` (the same roll for one release; a suggestion, never a prefill) |
| `POST` | `/api/register` | Validate + upsert `{rollNo, displayName?}`; 400 on bad format, 404 + `suggestions` on a roll missing from college records |

A successful registration answers
`{ "ok": true, "registered": { "roll_no": "21B81A05E9", "name": "..." } }`.
A non-empty `displayName` (trimmed, max 40 chars) is the name the leaderboard
shows for that roll.

One roll belongs to one Telegram account. A second account claiming a roll
gets `409`:

```json
{
  "code": "ROLL_ALREADY_REGISTERED",
  "error": "This roll number is already saved to another Telegram account. ..."
}
```

The API never says which account holds it. A unique index on
`registrations.roll_no` backs the application guard, and boot-time dedupe
keeps the newest claim per roll. There is no delete endpoint by design;
registering again overwrites the caller's own registration.

## Issue report endpoints

Reports moved to the web form (`#/issues` in the app; `/report` opens it and
`/report <message>` still files directly). Every report gets an issue id
formatted as `QIK-0007`, and every report is a **thread**: the opening message
plus every follow-up from either side, oldest first. The admin answers from
the panel or `/reply`; the reporter answers on the thread page. Both directions
notify the other side in Telegram, and each side carries an unread stamp until
the thread is opened.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/report` | Submit `{message}` (10–1000 chars) with initData; limited 5/15min/IP + a 60s per-user gate; announces to the admin and confirms to the reporter; returns `{ok:true, issueId}` |
| `GET` | `/api/myreports` | The caller's reports, newest first: `{issueId, message, status, adminReply, repliedAt, createdAt, messageCount, lastAuthor, lastMessageAt, unread}` |
| `GET` | `/api/thread/:issue` | One conversation (`:issue` = `QIK-0007`, `QIK-7` or `7`); the caller's own only, 404 otherwise; opening it clears the caller's unread stamp |
| `POST` | `/api/thread/:issue` | The reporter adds `{message}` (1–1000 chars) to an open thread; a follow-up on an answered issue reopens it and DMs the admin. Resolved threads are closed and answer `410` — file a new report instead. Limited 120/15min/IP + a 3s per-user gate |
| `GET` | `{base}/api/reports` | Admin panel: list all reports with names and thread roll-ups, `?status=open\|answered\|resolved` |
| `GET` | `{base}/api/reports/:id` | Admin panel: the whole conversation behind one issue, and clears its unread stamp |
| `POST` | `{base}/api/reports/:id/reply` | Admin panel: append a message to the thread and DM the reporter |
| `POST` | `{base}/api/reports/:id/close` | Admin panel: mark resolved and notify the reporter |
| `POST` | `{base}/api/reports/:id/reopen` | Admin panel: put a closed issue back in the open inbox |

Bot-side admin replies: `/reply QIK-0007 <answer>` and `/close QIK-0007` —
`/reply` writes the same thread entry the panel does.
