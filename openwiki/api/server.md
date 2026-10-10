---
type: reference
title: REST API and Security
description: Express API endpoints for the leaderboard, per-user rank lookup, profile registration, health, and status pages, with query validation, Redis response caching, Telegram initData verification, rate limiting, and configurable CORS.
tags: [api, express, security, rate-limiting, telegram-auth]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-09T23:13:13.880Z
sources:
  - id: openwiki-source-44d9bd7e30623f9a7e846be3
    resource: repo://src/api/profile.ts
  - id: openwiki-source-a88078296dd210c623bc0e96
    resource: repo://src/api/resolveUser.ts
  - id: openwiki-source-714e0c91fd122c36f3217aa4
    resource: repo://src/api/server.ts
  - id: openwiki-source-f11b9279af821abdb3463e06
    resource: repo://src/config/environmentals.ts
  - id: openwiki-source-4716507514d96417fd36a7bf
    resource: repo://src/middleware/security.ts
  - id: openwiki-source-a76deab33c6c7949e4c4adeb
    resource: repo://src/services/telegramAuth.ts
  - id: openwiki-source-4ccceffb43b70d8bf38d07a2
    resource: repo://src/services/tracker.ts
  - id: openwiki-source-0be99d3f1664956f03d52278
    resource: repo://src/services/uptime.ts
generated: { by: "opencode", at: "2026-10-09T23:13:13.880Z" }
---

# REST API and Security

The Express app in `src/api/server.ts` is created at module load and started from the bot process (`startServer`, `src/api/server.ts:264-272`). It serves the public leaderboard API consumed by the Telegram Web App, a per-user rank lookup, the optional profile/registration endpoints, an internal health probe, and the public status page data. Admin routes are mounted first (see [Admin Panel](admin-panel.md)); everything below runs through the shared security middleware.

## Middleware stack and trust model

The app sets `trust proxy` to `1` (`src/api/server.ts:29`): it runs behind a single nginx hop on the production server, so `req.ip` and `express-rate-limit` see the real client IP rather than `127.0.0.1`.

CORS allows the origins in `CORS_ORIGINS` (`src/config/environmentals.ts:26-30`), a comma-separated list defaulting to `https://tobioffice.github.io` — the GitHub Pages host of the web apps. Override it in `.env` for additional origins (e.g. a local dev origin).

`apiSecurityMiddlewares` (`src/middleware/security.ts`) is applied to all routes after the admin routes:

1. **`securityLogger`** — logs requests matching suspicious patterns (path traversal, `<script`, `union … select`, `eval(`) against the URL and JSON-stringified body/query, and logs every 429 response on finish.
2. **`sanitizeInput`** — strips angle brackets from **body** string values only and trims them. It deliberately does not mutate `req.query`: under Express 5, query and params come from getters, so in-place edits are unreliable; query input is constrained by the allowlist validators instead.
3. **`apiRateLimit`** — 600 requests per 15 minutes per IP (~40/min, sized for infinite scroll), via `createRateLimit`.

The leaderboard endpoints additionally apply `leaderboardValidation` + `handleValidationErrors` (`leaderboardSecurityMiddlewares`). Validators allow:

| Param | Rule |
|---|---|
| `page` | integer 1–1000 |
| `limit` | integer 1–100 |
| `sort` | `attendance` \| `midmarks` |
| `year` | 1–2 digits or `all` |
| `branch` | digits or `all` |
| `section` | single letter (any case) or `all` |
| `search` | 2–20 chars of word characters, spaces, or dashes |

Validation failures return `400 {success:false, error:"Validation failed", details:[…]}`.

## Endpoint contracts

### `GET /api/leaderboard`

Paginated, filterable student statistics. Query parsing (`parseLeaderboardQuery`, `src/api/server.ts:69-85`) defaults `page=1`, `limit=50`, `sort=attendance`; the literal `all` for `year`/`branch`/`section` becomes `undefined`, and `search` is trimmed and capped at 20 chars.

Responses are cached in Redis for 60 seconds per unique query key built via `redisKeys.leaderboard(...)` (`src/api/server.ts:87-110`). Cache read/write failures are logged and ignored — the endpoint still serves from Turso. Successful payload:

```json
{ "success": true, "page": 1, "limit": 50, "total": 245, "data": [ { "roll_no": "…", "name": "…", "attendance_percentage": 95.5, "mid_marks_avg": 18.75, "rank": 1 } ] }
```

Ranking semantics are documented in [Caching and Leaderboard Stats](../data/caching-and-stats.md).

### `GET /api/me`

Resolves the caller's Telegram identity to a roll number and returns their global ranks. Identity resolution is shared via `resolveUserId` from `src/api/resolveUser.ts` (see below):

- Rejects `initData` longer than 4096 chars early.
- When `initData` is present, verifies it with `verifyInitData`; failure yields `401 {found:false, error:"Invalid Telegram signature"}`.
- Outside production only, a bare `userId` query/body value matching `/^\d{1,20}$/` is accepted as a dev convenience.
- With no verifiable identity, responds `401 {found:false, error:"Telegram initData required"}`.

On success the app records a `leaderboard_webapp` activity event, looks up the roll via `getTgUserRoll`, and returns either `{found:false}` or:

```json
{ "found": true, "roll_no": "21B81A05E9",
  "attendance": {"rank": 12, "total": 245},
  "midmarks": {"rank": 30, "total": 245} }
```

Ranks are computed by `getStudentRank` for both sorts in parallel; a `null` rank (no stats yet) is returned as `null`.

### Profile / registration endpoints

Mounted from `src/api/profile.ts` at `/api` (`src/api/server.ts:47-55`):

| Method | Path | Auth | Extra limit | Purpose |
|---|---|---|---|---|
| `GET` | `/api/profile` | yes | global | registration + live student info, or an unregistered suggestion |
| `POST` | `/api/register` | yes | 20 req / 15 min / IP (`profileWriteLimit`) | validate and upsert the registration |

Both endpoints use the same `resolveUserId` identity rules (initData in query or JSON body; dev shortcut outside production). Details and response shapes are in [Registration and Profile](../registration.md).

### `GET /health`

Unrate-limited liveness probe (`src/api/server.ts:207-214`) returning `{status:"ok", timestamp, uptime, version:"1.0.0"}`. The uptime monitor probes this endpoint every 5 minutes.

### `GET /api/status`

Public status payload for the 90-day status page. It aggregates `getUptimeSummary` and `getUptimeDailyBuckets` per component, marks a component `up` when its last ping is younger than 15 minutes, and caches the assembled JSON **in memory** for 5 minutes (`STATUS_TTL_MS`, `src/api/server.ts:219-262`) because the underlying data changes only on the 5-minute probe. The static status page in `src/status/index.html` fetches this endpoint and renders 90 day-bars per component in IST.

## Shared identity resolution

`resolveUserId` (`src/api/resolveUser.ts:17-42`) authenticates every identity-based endpoint:

- Reads `initData` from `req.query` first, then `req.body` (so POST JSON bodies work).
- Enforces the 4096-character cap before verification.
- Returns `{userId}` on success, `{userId: "", error}` on a presented-but-invalid identity, or `null` when no identity was presented.
- The dev-only numeric `userId` shortcut is available from either query or body when `ENV !== "production"`.

## Telegram WebApp initData verification

`verifyInitData` (`src/services/telegramAuth.ts:16-48`) implements Telegram's spec: it removes `hash`, builds the sorted `data_check_string`, computes `HMAC-SHA256(data_check_string, HMAC-SHA256("WebAppData", botToken))`, and compares hex digests. It additionally enforces a **24-hour replay window** using `auth_date`, since Telegram initData itself never expires. Missing token, missing/stale hash, or malformed JSON all return `null`.

## Activity tracking

`trackActivity` (`src/services/tracker.ts:97-100`) is fire-and-forget by design — tracking must never delay or break a response. Each event writes one `activity_log` row for every action, while the per-user `botusers` profile upsert is gated by a Redis `SET NX` key (`redisKeys.trackProfile`, 60s) so a hot user does not rewrite their row on every action (`src/services/tracker.ts:44-95`). `supergroup` is normalized to `group` before storage.

## Uptime probing

The monitor in `src/services/uptime.ts` probes four components on a 5-minute interval: `api` (the local `/health` endpoint), `turso` (`SELECT 1`), `redis` (PING via the shared client), and `portal` (an HTTP GET of the college portal base URL). Each component's heartbeats are recorded to Turso with status and latency; transitions between up and down DM the admin.

## Related pages

- [Admin Panel](admin-panel.md)
- [Registration and Profile](../registration.md)
- [Caching and Leaderboard Stats](../data/caching-and-stats.md)
- [Runtime Architecture](../architecture.md)
