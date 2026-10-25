# NbkristQik REST API

> **Note:** The generated wiki is authoritative for endpoint behavior; see
> [`openwiki/api/server.md`](openwiki/api/server.md) and
> [`openwiki/api/admin-panel.md`](openwiki/api/admin-panel.md). If this file
> disagrees with the code, the code wins.

The API is served by the Express app in `src/api/server.ts`, started in-process
by the bot entry point. Base URL is `http://localhost:3000` in development.

CORS allows the origins in `CORS_ORIGINS` (default
`https://tobioffice.github.io`). All public routes pass through a security
middleware stack: suspicious-request logging, body sanitization, and an IP rate
limit of 600 requests / 15 minutes. The app trusts one proxy hop (`trust proxy`
= 1) for nginx.

## Public endpoints

### `GET /api/leaderboard`

Paginated, filterable leaderboard rows.

| Param | Type | Default | Rules |
|---|---|---|---|
| `page` | int | 1 | 1–1000 |
| `limit` | int | 50 | 1–100 |
| `sort` | string | `attendance` | `attendance` or `midmarks` |
| `year` | string | `all` | digits or `all` |
| `branch` | string | `all` | digits or `all` |
| `section` | string | `all` | single letter or `all` |
| `search` | string | — | 2–20 chars: letters, digits, spaces, dashes |

Responses are cached in Redis for 60 s per unique query. Invalid parameters
return `400 { "success": false, "error": "Validation failed", "details": [...] }`.

Page 1 also carries the sync freshness and the sections that exist for the
chosen year/branch. Later pages return `null` for both (the client already has
them, and each extra query costs Turso reads).

```json
{
  "success": true,
  "page": 1,
  "limit": 50,
  "total": 245,
  "updated_at": "2026-10-25 10:00:00",
  "facets": { "sections": ["A", "B", "C"] },
  "data": [
    {
      "roll_no": "21B81A05E9",
      "name": "JOHN DOE",
      "attendance_percentage": 95.5,
      "mid_marks_avg": 18.75,
      "rank": 1
    }
  ]
}
```

`updated_at` is the newest `student_stats.last_updated` (UTC, SQLite
`datetime('now')` format), for the client's "Synced 2 hours ago" line.

### `GET /api/me`

Returns the caller's roll number and global ranks, each with the rounded score
the register prints (`value`) so the personal strip and the row agree.

- In production, sends Telegram WebApp `initData` (HMAC-verified, 24 h replay
  window). Inputs longer than 4096 chars are rejected.
- Outside production only, a numeric `userId` query parameter is accepted.

```json
{
  "found": true,
  "roll_no": "21B81A05E9",
  "attendance": { "rank": 12, "total": 245, "value": 95.5 },
  "midmarks": { "rank": 30, "total": 245, "value": 18.8 }
}
```

`401 { "found": false, "error": "..." }` when identity cannot be verified, and
`{ "found": false }` when the user has no roll mapping yet.

### `GET /health`

Unrate-limited liveness probe: `{ "status": "ok", "timestamp", "uptime", "version" }`.

### `GET /api/status`

90-day uptime summary per component with daily buckets. A component is `up`
when its last ping is under 15 minutes old. The assembled payload is cached
in memory for 5 minutes.

## Admin endpoints

Mounted under the secret `ADMIN_PANEL_PATH` and disabled unless both
`ADMIN_PANEL_PATH` and `ADMIN_PANEL_PASSWORD` are set. Sign in with
`POST {base}/login`; the session cookie `qik_admin` is HttpOnly,
SameSite=Strict, and lasts 24 h. Data endpoints require it and are short-TTL
cached in memory.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `{base}/login` | Password sign-in (5 attempts / 10 min / IP) |
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
Identity rules match `/api/me` (signed initData; dev `userId` shortcut).
`POST /api/register` is additionally limited to 20 requests / 15 min / IP.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/profile` | `{found:true, registration:{roll_no, display_name,...}, student}` or `{found:false, suggestion}` (roll from past lookups) |
| `POST` | `/api/register` | Validate + upsert `{rollNo, displayName?}`; 400 on bad format, 404 + `suggestions` on a roll missing from college records |

There is no delete endpoint by design; registering again overwrites.

## Issue report endpoints

Reports moved to the web form (`report.html` mini app, opened by `/report`).
Every report gets an issue id formatted as `QIK-0007`, and every report is a
**thread**: the opening message plus every follow-up from either side, oldest
first. The admin answers from the panel or `/reply`; the reporter answers on
the thread page (`report.html?issue=QIK-0007`). Both directions notify the
other side in Telegram, and each side carries an unread stamp until the
thread is opened.

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
