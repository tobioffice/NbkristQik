---
type: workflow
title: Registration and Profile
description: Optional user registration — the registrations table, profile/register API endpoints with shared initData identity, registered-only /attendance /midmarks /bunk shortcuts, and the standalone Telegram Web App profile page.
tags: [registration, profile, telegram-web-app, api, commands]
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
  - id: openwiki-source-c0fc486d88e5845eb0be7e75
    resource: repo://src/bot/commands/register.ts
  - id: openwiki-source-c86189a5f8e6fd33c86b338e
    resource: repo://src/bot/commands/registered.ts
  - id: openwiki-source-87c47a793c4a631e2439348f
    resource: repo://src/constants/webapp.ts
  - id: openwiki-source-51ebf01a6987b9612a7dd707
    resource: repo://src/db/init.ts
  - id: openwiki-source-e2d605fc24401a4f2602626d
    resource: repo://src/db/registration.model.ts
  - id: openwiki-source-aaa8426155484904025fc71f
    resource: repo://src/web/register.html
  - id: openwiki-source-09b79904e1465aba03a49169
    resource: repo://src/web/src/constants.ts
  - id: openwiki-source-111de05988dad8539a084233
    resource: repo://src/web/src/ProfileApp.tsx
  - id: openwiki-source-015b703aef696b45b61ab9e4
    resource: repo://src/web/src/useProfile.ts
  - id: openwiki-source-efd9c0c6d9d834c3b9e533d4
    resource: repo://src/web/src/views/Profile.tsx
  - id: openwiki-source-73d3563b23c926309c9b707d
    resource: repo://src/web/vite.config.ts
generated: { by: "opencode", at: "2026-10-09T23:13:13.880Z" }
---

# Registration and Profile

Registration is **optional**. It pins a default roll number (plus an optional display name) to a Telegram user so `/attendance`, `/midmarks`, and `/bunk` answer instantly without typing a roll. Unregistered students keep the original flow: send a roll number, get the inline menu. Registration is entered only through the standalone Telegram Web App profile page; there is no conversational fallback, and there is deliberately **no delete** — editing overwrites.

## Data model

`src/db/registration.model.ts`, backed by the `registrations` table created in `src/db/init.ts:69-76`:

| Column | Type | Notes |
|---|---|---|
| `userId` | TEXT PRIMARY KEY | Telegram user id |
| `roll_no` | TEXT NOT NULL | Uppercased registered roll |
| `display_name` | TEXT | Optional free-form name (max 40 chars at the API) |
| `registered_at` | TEXT NOT NULL | Default `datetime('now')`; preserved across edits |
| `updated_at` | TEXT NOT NULL | Refreshed on every upsert |

`upsertRegistration(userId, rollNo, displayName)` inserts or updates on the `userId` conflict, keeping `registered_at` intact and refreshing `updated_at`; `getRegistration(userId)` returns the row or null.

The table is **separate from `tgusers`** by design: `tgusers` is auto-upserted on every roll lookup (including lookups of friends' rolls) and would silently overwrite an explicit registration. Registration is deliberate user state that must not drift.

## Identity rules

The profile endpoints use the shared `resolveUserId` helper (`src/api/resolveUser.ts`), the same one behind `/api/me`:

- In production, the caller must present Telegram WebApp `initData` (HMAC-verified, 24-hour replay window). It is read from `req.query.initData` first, then from a JSON body field.
- Inputs longer than 4096 chars are rejected before verification.
- Outside production only, a numeric `userId` query/body value is accepted as a dev shortcut.
- Failure shapes: `null` (no identity presented) or `{userId: "", error}` (presented but invalid) both map to `401 {found:false, error}`.

## API endpoints

Both routes are defined in `src/api/profile.ts` and mounted in `src/api/server.ts:47-55` under `/api`.

### `GET /api/profile`

Returns one of four shapes:

| Condition | Response |
|---|---|
| Registered, roll in `studentsnew` | `{found:true, registration, student}` — student merged live from the master table |
| Registered, roll missing from `studentsnew` (semester rollover) | `{found:true, stale:true, registration, student:null}` so the UI can prompt an update |
| Unregistered | `{found:false, suggestion}` — the roll from past lookups (`tgusers`) as a prefill hint, or null |
| No valid identity | `401 {found:false, error}` |

The `student` object is fetched via `getStudentCached(registration.roll_no)`; a miss is treated as the stale case, never an error.

### `POST /api/register`

Create or edit. Body: `{initData?, userId?, rollNo, displayName?}`.

1. Identity via `resolveUserId` (401 on failure).
2. `rollNo` must match `ROLL_REGEX` (`src/constants/index.ts`), else `400` with "That roll number doesn't look right."
3. The roll must exist in `studentsnew` (`getStudentCached`); a `StudentNotFoundError` becomes `404 {error, suggestions}` using the model's nearby-roll suggestions so the UI can offer "Did you mean".
4. `displayName` is trimmed and capped at 40 chars; empty becomes null.
5. `upsertRegistration` runs, then a `register` activity event is recorded (with the roll as detail) for the admin panel.
6. Response: `{ok:true, registered:{roll_no, name}}`.

The route additionally sits behind `profileWriteLimit` — 20 requests / 15 minutes / IP (`src/api/server.ts:49-54`) — beyond the global API rate limit.

## Registered shortcut commands

`src/bot/commands/registered.ts` registers `/attendance`, `/midmarks`, and `/bunk`. Each resolves the caller's registered roll through the shared `resolveRegisteredRoll(userId, chatId)` and then reuses the standard `studentActions` flow (`sendAttendanceOrMidMarks` / `sendBunkPlan`), so replies keep the placeholder-then-edit UX and the same formatting/caching chain.

`resolveRegisteredRoll` behavior:

1. **No registration** → sends the register prompt with a "Register your roll" `web_app` button (`REGISTER_WEBAPP_URL`) and returns null.
2. **Registration found** → verifies the roll still exists in `studentsnew`; on success it fire-and-forgets a `tgusers` mapping refresh (keeping "You are #N" consistent) and returns the roll.
3. **Stale registration** (roll left the master table after a sync) → sends a "semester rollover?" prompt with the same register button and returns null.

The commands also enforce the existing gates before resolving anything: bot rate limiting, channel membership, and the daily check-in gate (identical to the roll-number flow), plus the chit-chat group silence.

`/register` itself (`src/bot/commands/register.ts`) posts an explainer with an "Open registration" `web_app` button pointing at the profile page.

## Standalone profile web page

The profile form is a **separate mini app page** from the leaderboard:

- `src/web/register.html` — its own Vite entry, loading `src/web/src/register-main.tsx` → `ProfileApp`
- `src/web/src/ProfileApp.tsx` — standalone layout for the form
- `src/web/src/views/Profile.tsx` — the form itself: roll input (uppercased, validated with the same `ROLL_REGEX` client-side), optional display name (max 40), save button, success/error states, suggestion chips for unknown rolls, a stale-registration banner, and the live college-record name when available
- `src/web/src/useProfile.ts` — data layer: loads `GET /api/profile`, exposes `save(rollNo, displayName)` returning `{error, suggestions?}`
- `src/web/src/useTelegramIdentity.ts` — the shared identity hook (WebApp user id + initData), also used by the leaderboard
- `src/web/vite.config.ts` — builds both entries (`index.html`, `register.html`)

Both mini apps deploy to GitHub Pages from the same `dist/`; the URLs live in `src/constants/webapp.ts` (bot side) and `src/web/src/constants.ts` (web side), consumed as `web_app` buttons so Telegram opens them full-screen with a native back button.

The leaderboard (`index.html`) links to the profile page with a floating "👤 My profile" button.

## Related pages

- [REST API and Security](api/server.md)
- [Bot Commands and Authorization](bot/commands-and-authorization.md)
- [Database Schema and Models](data/database.md)
- [Web Leaderboard](web/leaderboard.md)
