# NbkristQik REST API

The API is served by the Express app in `src/api/server.ts`, started in-process
by the bot entry point. It binds `HOST` (default `127.0.0.1`) on `PORT`
(default `3000`); production is reached through nginx at
`https://checker.tobioffice.online`. The app trusts one proxy hop (`trust proxy`
= 1) so `req.ip` and the rate limits see the real client address.

CORS allows the origins in `CORS_ORIGINS` (comma-separated, default
`https://checker.tobioffice.online`). The shipped app and status page are
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
| `GET /api/games/board` | allowed; a verified student's roll (masked when they hid the leaderboard), else chosen display name, Telegram name or @username. Each player row carries `points` and `plays` (finished daily runs this week; a duel is a match and adds neither a run nor any points). `page`/`limit` page the player board (default 50, cap 100) and the payload carries the full count and `hasMorePlayers` | same payload |
| `GET /api/games/live` | allowed; `me` is `null` | `me` carries whether a roll is saved and today's run state (`open`, `playing`, `done`) |
| `POST /api/games/five/start`, `POST /api/games/five/answer` | `401` | the daily run; `start` may create today's attempt and `answer` is checked against the question on screen |
| `GET /api/me` | `401` | allowed |
| `/api/profile`, `/api/register`, `/api/report`, `/api/thread/*`, `/api/rank/share`, `/api/rank/card`, `/api/rank/card/send`, `POST /api/papers` | `401` | allowed |
| `GET /api/rank/card/:name` | allowed; random token, 30-minute TTL | same |
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
| `POST /api/rank/share` | 30 / 15 min per account |
| `POST /api/rank/card` | 10 / 15 min per account |
| `POST /api/rank/card/send` | 5 / 15 min per account |
| `GET /api/rank/card/:name` | 1,200 / min per network address (mounted before the API limiter) |
| `/api/thread/*` | 120 / 15 min per account, plus a 3 s per-user gate on follow-ups |
| `POST /api/papers` | 10 / hour per account |
| `POST /api/library/session` | 20 / hour per account (other library calls use the global limit) |
| `/internal/*` | 120 / 15 min (on top of the global limit) |
| Admin `POST {base}/login` | 20 requests / 10 min burst, plus a 5-failure / 10 min lockout |

`/health` has no dedicated limiter but is mounted after the global API
middleware, so it shares the account/IP limit. `/api/status` and `/api/stats`
also use the global limit. The static `/status` and `/stats` pages are mounted
before the API middleware and carry their own 120 requests/minute limiter
each; the `/library/` bundle is not rate-limited.

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
- A caller with no Telegram identity but a live `nbq_lib` session cookie gets
  the session user's flags; this keeps a PC-opened library available after a
  reload. With neither identity nor session, the answer is
  `{ "libraryOpen": false, "admin": false }`.

The response is `Cache-Control: no-store` because it depends on the caller.
The web shell treats the library as closed until this route answers, and hides
the library tab and route when `libraryOpen` is `false`.

### `GET /api/games/live`

The home screen's league banner: the IST week's label and, for a signed-in
caller, where today's run stands. No identity is required; a presented but
invalid one is `401`, like `/api/games/board`.

```json
{
  "success": true,
  "weekLabel": "Week of 17 Nov",
  "me": {
    "registered": true,
    "run": { "state": "playing", "questions": 10, "question": 4 }
  }
}
```

- `me` is `null` for an anonymous caller.
- `me.registered` is `false` when the account has not saved a roll; `run` is
  then `null` and the banner opens the play screen, which asks for the roll.
- `run.state` is `open` (no attempt today), `playing` (`question` is the
  1-based question to resume) or `done` (with the season `points` the run
  earned). The route reads the attempt the bot already wrote; it never builds
  the day's question round, so it stays cheap on every home visit.
- Anonymous answers are `Cache-Control: public, max-age=30`; signed-in answers
  are `private, no-store`.

### `POST /api/games/five/start`

Opens today's run in the Mini App. A Telegram identity is required; an anonymous
request or an invalid one is `401`. This is a write: it may create today's
attempt and it starts the first question's clock.

```json
{
  "success": true,
  "state": "playing",
  "attemptId": 41,
  "score": 0,
  "question": {
    "index": 0,
    "total": 10,
    "prompt": "Which memory is volatile?",
    "options": ["RAM", "ROM", "SSD", "HDD"],
    "limitMs": 10000
  }
}
```

- `state` is `playing`, `done`, `needs-roll` (no saved roll, the bot asks for
  one) or `not-ready` (the day's set could not be built).
- `done` carries `alreadyPlayed: true` and the same `result` object the answer
  endpoint returns.
- `index` is 0-based; the screen prints it + 1. The correct option is never in
  the payload.
- The run's ten questions are ones the caller has never been shown. The day's
  shared pool is the first source; the rest of the active bank fills the gap
  when the player has already seen too much of the pool. Only an exhausted
  bank can repeat a question, and then the questions seen longest ago come
  back first.
- The answer endpoint, and the clock it starts for each question, treats the
  attempt as one run per account per IST day, shared with the bot's `/quiz`.

### `POST /api/games/five/answer`

Records one pick on the displayed question and returns the next question, or
the finished result. A Telegram identity is required; the attempt must belong
to the caller and be the daily five run.

```json
{
  "success": true,
  "state": "playing",
  "attemptId": 41,
  "score": 300,
  "question": { "index": 3, "total": 10, "prompt": "…", "options": ["…"], "limitMs": 10000 },
  "feedback": { "correct": true, "timedOut": false, "earned": 150 }
}
```

Body: `{ "attemptId": 41, "index": 2, "option": 1 }`. `index` must be the
question the browser showed; a stale browser (or a second tab) gets
`409 { "success": false, "state": "stale" }` instead of answering the next
question by accident. A malformed body is `400`, another account's attempt is
`404`.

The last answer finishes the run on the server (streak and season points
included) and returns `state: "done"` with the result; a duplicate tap after
the finish answers the same result with `alreadyPlayed: true`. `feedback`
reports the previous answer only, never the correct option.

### `GET /api/me`

Returns the caller's saved roll and global ranks, each with the rounded score
the register prints (`value`) so the personal strip and the row agree. A
verified identity is required; an anonymous request or an invalid one is
`401 { "found": false, "error": "..." }`.

The same scan also returns the caller's **section** ranks, so the section
board's strip uses the same number as its row badge. `section.year` is the
leaderboard's year digit (`"3"`), not the portal's year-semester code (`"31"`).

Identity is the registration, never the last lookup. `tgusers` is auto-upserted
by every roll lookup, including a friend's, so it is returned separately as a
suggestion:

- Registered: `{ found: true, source: "registered", roll_no, attendance, midmarks, section }`.
- Not registered: `{ found: false, lastLookup: "<roll>|null" }`; no rank queries
  run.

```json
{
  "found": true,
  "source": "registered",
  "roll_no": "21B81A05E9",
  "attendance": { "rank": 12, "total": 245, "value": 95.5 },
  "midmarks": { "rank": 30, "total": 245, "value": 18.8 },
  "section": {
    "year": "3",
    "branch": "5",
    "section": "A",
    "attendance": { "rank": 4, "total": 63, "value": 95.5 },
    "midmarks": { "rank": 7, "total": 63, "value": 18.8 }
  }
}
```

Global ranks are over all ranked students in the register, not over the
current filters; the `section` ranks are over the caller's own year/branch/
section. `section` is `null` when the master row has no section context.
`Cache-Control: private, no-store`.

`DELETE /api/me/last-lookup` removes the caller's suggestion row; the
registration is untouched.

### `POST /api/rank/share`

Stores a prepared inline message for the caller's own rank. The Mini App hands
its `id` to `Telegram.WebApp.shareMessage`, and Telegram's native sheet asks
the student which chat to send it to. The bot never posts the card itself.

Body: `{ "sort": "attendance" | "midmarks", "scope": "section" | "all", "cardId"?: "<id>" }`.
`sort` defaults to `attendance`; `scope` defaults to `all`. With `scope=section`
the server resolves the caller's own section through the registration and
master row and ranks over the same filters the register uses; if the section
cannot be resolved it falls back to the whole register. A `cardId` is honoured
only when it is the caller's current card.

`400` without a registration, `404` before the student has a ranked figure.
The message carries the roll, rank and score, never a name, and its button is a
`startapp=rank` direct link. With a card, the prepared result is a photo
(JavaScript 1080×1920 JPEG) with the card's caption; without one, or when
Telegram cannot fetch the photo, it is the text article.

```json
{ "ok": true, "id": "prepared-message-id", "expiresAt": 1763000000 }
```

`Cache-Control: private, no-store`.

### `POST /api/rank/card`

Uploads the JPEG the phone drew for a share card. Identity required; the body
is raw `image/jpeg`, at most 1.5 MB, checked by magic bytes. The caller's
previous card is replaced, and the bytes live for 30 minutes. The response is
the public URL Telegram fetches:

```json
{ "ok": true, "id": "<32-char token>", "url": "https://.../api/rank/card/<token>.jpg" }
```

### `GET /api/rank/card/:name`

Serves a live card as `image/jpeg` from an unguessable URL, with
`Cache-Control: private, max-age=1800`, `X-Content-Type-Options: nosniff`,
`X-Robots-Tag: noindex` and `Content-Security-Policy: default-src 'none'`.
No identity is required: Telegram's servers fetch it for a photo message or a
story. `?download=1` switches to `Content-Disposition: attachment` and allows
`https://web.telegram.org` for `WebApp.downloadFile`. Unknown or expired tokens
are `404`.

### `POST /api/rank/card/send`

Sends the caller's current card to the caller's own chat with a short
"Long-press it to save it to your photos" caption and an `Open the register`
button. Body: `{ "cardId": "<id>" }`. This is the reliable Instagram hand-off:
Telegram webviews do not implement the Web Share API. `404` when the token is
not the caller's live card; `502` when Telegram refuses the send.
`Cache-Control: private, no-store`.

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
`lastStatus`, `lastPingAgeSec`, `avgLatencyMs`, `current`, `stale` and
`buckets`, where each bucket is `{ day, pings, ups, avgLatencyMs }` in IST
calendar days.

### `GET /api/stats`

Aggregate-only usage counts for the public `/stats` page. Every number comes
from the same `getOverviewTotals()` queries as the admin Overview, so the two
surfaces cannot drift. The JSON is cached in Redis for five minutes, with a
five-minute in-process fallback when Redis is unavailable. HTTP caching is
`public, max-age=300, stale-while-revalidate=60`; `X-Stats-Cache` is `hit` or
`miss`. A database failure is
`500 { "success": false, "error": "Internal Server Error" }`.

```json
{
  "generated_at": "2026-11-18T10:30:00+05:30",
  "registered_users": 3538,
  "dau": 477,
  "wau": 2876,
  "mau": 3478,
  "commands_7d": 51471,
  "uptime_90d": "99.6%",
  "method": "users = rows in botusers ...; aggregates only, no identifiers."
}
```

- `registered_users` — rows in `botusers`: distinct Telegram users with at
  least one recorded action. It is not the number of saved roll
  registrations.
- `dau`, `wau`, `mau` — distinct `activity_log.user_id` in the trailing
  1/7/30 IST calendar days, including today.
- `commands_7d` — `activity_log` rows in the trailing 7 IST days.
- `uptime_90d` — successful `uptime_log` probes divided by all probes across
  components over the last 90 days, one decimal place; `"n/a"` before the
  first probe.
- `generated_at` — server time in IST (`+05:30`), seconds precision.
- `method` — the same definitions as one sentence.

Only aggregates are published: no user ids, names or per-student rows.

### `GET /status`

The public status page itself, served by Express from
`public/status/index.html` (the deploy copies `src/status` there). It is a
single static HTML file with no external font or script request; it fetches
`/api/status` for its data. `Cache-Control: no-store`. If the file is missing,
the route answers `404 { "success": false, "error": "Not Found" }` instead of
crashing the API. `STATUS_PAGE_PATH` can point the route at another file for
development.

### `GET /stats`

The public usage page itself, served by Express from
`public/status/stats.html` (the deploy copies `src/status` there). It reads
`/api/stats` for its figures. `Cache-Control: no-cache` so a deploy is picked
up immediately. The route is mounted before the global API middleware with its
own 120 requests/minute limiter. `STATS_PAGE_PATH` can point it at another
file for development or tests; a missing file answers
`404 { "success": false, "error": "Not Found" }`.

## Library endpoints

The library uses a session cookie, not the API identity header. Exchange
signed `initData` once, then send the `nbq_lib` cookie on every later call. The
session is HttpOnly, SameSite=None with `Partitioned`, `Secure` in
production (local http dev uses SameSite=Lax), and lasts 12 hours for Telegram
or 1 hour for a PC link; the session exchange is additionally limited to 20
requests / hour per account or PC token. `None` + `Partitioned` exists for
Telegram Web, which runs the mini app in a cross-site iframe where a Strict
cookie is never sent back.

A computer gets in through a one-time `pcToken` minted by the bot in private
for five minutes. It is consumed by `POST /api/library/session`; it cannot be
reused, and a bad token is a `401` with no fallback to `initData`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/library/session` | Verify `{initData}` or `{pcToken}` in the body, set the cookie, return `{ok, registered, student}`; `401` on a bad signature/expired link, `403` while `LIBRARY_ACCESS=admin` and the caller is not the admin |
| `DELETE` | `/api/library/session` | Drop the session and clear the cookie |
| `GET` | `/api/library/me` | The session's user and student summary (`registered` is false without a saved roll) |
| `GET` | `/api/library/subjects` | The student's own subjects for the running semester, with units and live status; while the shelf is admin-only, the admin may use `?view=all` for the whole shelf, `?view=roll` for exactly the registered roll's view |
| `GET` | `/api/library/document/:id` | One document's metadata: id, code, title, unit, pages, version; `404` if missing or not live, `403` if not the reader's |
| `GET` | `/api/library/page/:id/:page` | One watermarked SVG page (`Cache-Control: private, max-age=300`, `Content-Disposition: inline`, no text layer). `400`/`404` for a bad page, `503` when no watermark secret is configured |
| `POST` | `/api/library/document/:id/send` | Sends the stamped PDF to the reader's own Telegram chat as a document and returns `{ ok, fileName }`. Kept as the fallback for clients without `openLink`. Rate limited to 6 per reader per hour (`429` with `Retry-After`); `502` when Telegram refuses the upload (usually "user never pressed Start") |
| `POST` | `/api/library/document/:id/open` | Mints the short-lived link the platform's native PDF viewer opens: `{ ok, url, fileName }`. The URL is `/api/library/document/:id/pdf?link=…`; the token is opaque, bound to one reader and one document, and lasts an hour. Same session/registration/entitlement checks as a page; `503` when no link can be stored |
| `GET` | `/api/library/document/:id/pdf` | A whole PDF stamped with the reader's token (`application/pdf`, inline, `private, max-age=3600`, Range-capable). Authenticated by the session cookie, or by `?link=` from `/open` when the platform viewer opens it in another browser. Same registration/entitlement checks as a page; `401` for an expired/unknown link, `503` if the watermark secret is missing or the generation queue is full |

The session cookie is `SameSite=None` (the Telegram webview runs the app in a
cross-site iframe), so the mutating routes above refuse a request that names
a foreign origin: a `POST` or `DELETE` with an `Origin` outside the
deployment's host/`CORS_ORIGINS`, or a `Sec-Fetch-Site` other than
`same-origin`/`same-site`/`none`, answers
`403 { "error": "This request came from another site." }`. Header-less
callers (old webviews, non-browser tools) are unaffected — a browser's
cross-site POST always carries one of the two.

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
| `GET` | `{base}/api/users/:id` | Profile + recent activity + 30-day shape + duel record |
| `GET` | `{base}/api/users/:id/quiz` | One student's quiz attempts with every question, chosen option, correctness, timing and points |
| `GET` | `{base}/api/recent` | Live activity feed |
| `GET` | `{base}/api/papers` | Question-paper intake: newest first, with uploader, subject, exam, note and page count |
| `GET` | `{base}/api/paper-images/:name` | One stored paper page; admin session only |
| `DELETE` | `{base}/api/papers/:id` | Remove a paper and every page file |
| `GET` | `{base}/api/league` | The week's player and section boards, plus the duel queue and recent matches |
| `GET` | `{base}/api/health` | Uptime health (same data as `/api/status`) |
| `GET` | `{base}/api/moderation` | Chat rule, blocked words, muted/banned users, counts and recent actions |
| `POST` | `{base}/api/moderation/settings` | Save the rule switches and mute length |
| `POST` | `{base}/api/moderation/keywords` | Add one blocked word or phrase |
| `DELETE` | `{base}/api/moderation/keywords/:id` | Remove one blocked word |
| `POST` | `{base}/api/moderation/check` | Dry-run a message against the word list (nothing is removed) |
| `POST` | `{base}/api/moderation/users/:id/:action` | Ban, mute, kick, purge, unban or unmute one user in the regulated chat |

Day and hour groupings use IST (`+330 minutes`); storage stays UTC.

### Student quiz history

`GET {base}/api/users/:id/quiz` backs the student drawer's quiz section. It
returns the newest 200 stored attempts (`truncated` says whether older ones
exist; the store prunes attempts after 180 days) and a summary across them:
`attempts`, `completed`, `dailyRuns`, `duels`, `bestScore` (highest single-run
score), `bestPoints`, `correct`, `answered`, `accuracy` and `avgMs`.

Each attempt carries its game (`five` or `duel`), status, day/week/season,
score, points, streak, start/finish timestamps and `durationMs`, plus a
`questions` array in the order shown: `prompt`, `options`, `correctIndex`,
`chosenIndex`, `correct`, `ms` (time from the question appearing to the tap)
and `points`. An unanswered question in an active run has null
`chosenIndex`/`correct`/`ms`/`points`. The drawer sorts this client-side by
best run, best points or recent, and filters by game, date range and whether
the run contains mistakes.

### League

`GET {base}/api/league` is the operator's view of the weekly boards: every
scorer with roll, section, verification and privacy state, the verified-only
Section Wars table, and the week's counts. Its `duels` block is the only place
duels appear, because a duel is a match and never reaches a board: `stats`
carries `open` (unexpired challenges), `finishedWeek`, `expiredWeek`, `today`
(challenges created today) and `players` (distinct duelists this week);
`recent` carries the newest 20 matches with both sides, scores, winner
(`challenger`, `opponent`, `draw` or null) and timestamps. Results are cached
for 20 seconds in memory.

### Chat regulation

`GET {base}/api/moderation` returns the persisted `settings`
(`enabled`, `autoDelete`, `autoMute`, `muteSeconds`, `noticeInChat`,
`notifyUser`), one `chats` entry per `MODERATION_CHAT_IDS` id (title, member
count, and the bot's own delete/restrict rights), the `keywords` list, the
`users` currently muted or banned, the last 80 `actions`, and `counts` for the
view's four figures. The panel document and the moderation reads send
`Cache-Control: no-store`.

`POST .../settings` accepts any subset of the six setting fields; the mute
length is clamped to 60 seconds–30 days. `POST .../check` takes `{ "text" }`
and answers `{ hits, wouldAct }` without touching Telegram or the database.
A user action is one of `ban`, `mute`, `kick`, `purge`, `unban`, `unmute`; the
body may carry `reason`, `seconds` (mute, default the saved length) and
`chatId` (must be one of the configured chats). Ban, mute and kick also clear
the messages the bot remembers from that user; the bot and the panel call the
same service, so a reply command and a panel click mean the same thing. When
Telegram refuses an action, the endpoint answers `400` with a sentence the
admin can act on.

## Profile / registration endpoints

Optional registration lets students pin their default roll (Telegram Web App
form via `/register`); `/attendance`, `/midmarks`, and `/bunk` resolve it.
Identity rules match `/api/me` (signed `X-Telegram-Init-Data`, with the gated
dev `userId` shortcut). `POST /api/register` is additionally limited to 20
requests / 15 min per account.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/profile` | `{found:true, registration:{roll_no, display_name,...}, student, runs}`; `{found:true, stale:true, registration, student:null, runs}` when the saved roll left the college master table; or `{found:false, lastLookup, suggestion, runs}` (the same roll for one release; a suggestion, never a prefill) |
| `POST` | `/api/register` | Validate + upsert `{rollNo, displayName?}`; 400 on bad format, 404 + `suggestions` on a roll missing from college records, 403 when the roll's verified owner has turned on the registration lock |

`runs` is the caller's recent finished daily runs, newest first, ten at most:
`{ id, dayKey, score, points, correct, total, streak, finishedAt }`. Only
completed daily runs appear; a duel is a match, not a run, and an active
attempt has no final figure. The profile prints this as "Your runs"; the query
is best effort, so a database without the league tables still answers the
profile.

A successful registration answers
`{ "ok": true, "registered": { "roll_no": "21B81A05E9", "name": "..." } }`.
A non-empty `displayName` (trimmed, max 40 chars) is the name the leaderboard
shows for that roll.

Any number of accounts may save the same roll until its verified owner turns
on the registration lock. Schema v5 adds college-email verification: with
`blockRegistration` on, `POST /api/register` answers 403 for every other
account. A caller who has verified a different roll may still save a new roll;
the old claim and its privacy options stay on the old roll. A shared,
unverified roll still shows the newest non-empty `display_name` on the
leaderboard. There is no delete endpoint by design; registering again
overwrites the caller's own registration.

## College-email verification endpoints

The only address a code is sent to is `<roll>@nbkrist.org`. The code is six
digits, hashed with a per-code salt, single-use, expires after ten minutes and
allows five wrong tries. One code a minute and five an hour per account.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/verification` | `{verified, roll, email, blocked, hideLeaderboard, blockLookups, blockRegistration}` for the caller |
| `POST` | `/api/verification/start` | `{rollNo}`; sends the code, answers 404 for an unknown roll, 429 when rate-limited, 503 when SMTP is unset |
| `POST` | `/api/verification/confirm` | `{rollNo, code}`; claims the roll, terminates other registrations for it, answers the new state |
| `POST` | `/api/verification/options` | `{hideLeaderboard, blockLookups, blockRegistration}`, all booleans; only a verified owner |
| `POST` | `/api/verification/block` | Deprecated alias: `{blocked}` sets all three switches together |

The three switches are independent and all start off:

- `hideLeaderboard` masks the name and roll in `/api/leaderboard` rows, totals and coverage. The row still ranks and counts.
- `blockLookups` refuses the bot's attendance, mid-mark and bunk answers for every
  account except the owner and `ADMIN_ID`.
- `blockRegistration` makes `POST /api/register` answer 403 for every other
  account. With it off, another account may save the roll again.

`blocked` in the GET response is true when any of the three is on. It is kept for
older clients and is not a separate switch.

## Issue report endpoints

Reports moved to the web (`#/issues` lists your reports, `#/issues/new` is the
form; `/report` opens it and `/report <message>` still files directly). Every report gets an issue id
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
| `POST` | `{base}/api/reports/:id/reply` | Admin panel: append a message to the thread and DM the reporter. Accepts JSON `{reply}` or multipart `reply` plus up to three `screenshots` (PNG/JPEG/WebP, 5 MB each); an image can stand alone |
| `POST` | `{base}/api/reports/:id/close` | Admin panel: mark resolved and notify the reporter |
| `POST` | `{base}/api/reports/:id/reopen` | Admin panel: put a closed issue back in the open inbox |

Bot-side admin replies: `/reply QIK-0007 <answer>` and `/close QIK-0007` —
`/reply` writes the same thread entry the panel does.

## Question-paper intake

This is a collection endpoint, not a public bank. Students open the hidden
intake page (`#/papers`, or a bot link with `?page=papers` /
`?startapp=papers`), add photos of one paper and the subject/exam line, and the
processing team reads the submissions in the private admin list. The page has
no tab and there is no public read, list or image URL.

`POST /api/papers` accepts multipart/form-data with signed Telegram identity:

| Field | Rules |
|---|---|
| `subject` | 2–60 characters after trimming and whitespace collapsing |
| `exam` | 2–60 characters |
| `note` | optional, up to 240 characters |
| `images` | 1–5 files, PNG/JPEG/WebP, 5 MB each |

The server identifies each file by its magic bytes, rejects anything that does
not parse as its container, rewrites the container without EXIF/XMP/text
metadata chunks, and stores the cleaned bytes under a random 32-hex name in `PAPER_FILES_DIR`
(`data/papers` by default). Each upload is limited to 10 per hour per account.
Success is `201 { "ok": true, "id": 12, "pageCount": 2 }`; the files have no
public URL.

The admin panel is the only read path:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `{base}/api/papers` | Newest first: `{id, subject, exam, note, createdAt, pageCount, images, userId, name, username}` |
| `GET` | `{base}/api/paper-images/:name` | One stored page; requires the admin session cookie and answers `private, max-age=300` |
| `DELETE` | `{base}/api/papers/:id` | Remove the paper, its page rows and every stored file |
