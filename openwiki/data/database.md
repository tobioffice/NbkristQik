---
type: reference
title: Database Schema and Models
description: Complete Turso (libSQL) schema reference for NbkristQik — nine tables created by src/db/init.ts, their indexes, composite key conventions, and the model modules that query each.
tags: [database, turso, schema, sqlite, persistence]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-09T23:13:13.880Z
sources:
  - id: openwiki-source-27353b7693abd731710d1b72
    resource: repo://src/db/fallback/response.model.ts
  - id: openwiki-source-51ebf01a6987b9612a7dd707
    resource: repo://src/db/init.ts
  - id: openwiki-source-e2d605fc24401a4f2602626d
    resource: repo://src/db/registration.model.ts
  - id: openwiki-source-40646dc6b42fe5872ce25e48
    resource: repo://src/db/student_stats.model.ts
  - id: openwiki-source-bb916d406342a6553647f81f
    resource: repo://src/db/student.model.ts
  - id: openwiki-source-0be99d3f1664956f03d52278
    resource: repo://src/services/uptime.ts
generated: { by: "opencode", at: "2026-10-09T23:13:13.880Z" }
---

# Database Schema and Models

All persistence lives in a single Turso (libSQL/SQLite) database accessed through one shared client, `turso` (`src/db/db.ts`), built from `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Tables are created idempotently by `initDatabase()` (`src/db/init.ts:12-86`) — the single schema entry point — which `src/bot/index.ts` awaits before any handler or the API starts.

## Tables

### `fallbackResponses`

Raw portal HTML kept as a last-resort fallback when the college portal is unreachable.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PRIMARY KEY | `CHECK(LENGTH(id) \<= 50)`; composite of year, branch, section, and type |
| `content` | TEXT | Full HTML response |

`buildResponseId` (`src/db/fallback/response.model.ts`) formats the key as `<year>-<branch>-<section>-<type>` where type is `att` or `mid`. `storeResponse` uses `INSERT OR REPLACE`; `getResponse` throws "No fallback response found." when absent, which the scraper turns into `ServerDownError`.

### `tgusers`

Maps a Telegram user to their student record for the web leaderboard's "You are #N" lookup.

| Column | Type | Notes |
|---|---|---|
| `userId` | TEXT PRIMARY KEY | Telegram user id as text |
| `rollNo` | TEXT | Uppercased roll |
| `semester` / `department` / `section` | TEXT | Copied from the student record |

Written by `upsertTgUser` on every roll lookup and refreshed by the registered shortcut commands (fire-and-forget), read by `getTgUserRoll`.

### `registrations`

Optional user registration pinning a default roll for the registered shortcut commands.

| Column | Type | Notes |
|---|---|---|
| `userId` | TEXT PRIMARY KEY | Telegram user id |
| `roll_no` | TEXT NOT NULL | The registered roll, uppercased |
| `display_name` | TEXT | Optional, max 40 chars at the API layer |
| `registered_at` | TEXT NOT NULL | Default `datetime('now')`; preserved across edits |
| `updated_at` | TEXT NOT NULL | Default `datetime('now')`; refreshed on every upsert |

Kept separate from `tgusers` deliberately: `tgusers` is auto-upserted on every roll lookup (including friend lookups) and would silently overwrite an explicit registration. See [Registration and Profile](../registration.md) for the full flow; the model lives in `src/db/registration.model.ts`.

### `studentsnew`

The student master table, populated exclusively by `/syncdb`.

| Column | Type | Notes |
|---|---|---|
| `roll_no` | TEXT PRIMARY KEY | Uppercased roll |
| `name` | TEXT | Fetched from the portal's name endpoint; nullable |
| `section` / `branch` / `year` | TEXT | `year` holds the portal session code (e.g. `"41"`) |

Created in `init.ts` even on a fresh database so the leaderboard indexes below cannot fail before a first sync (`src/db/init.ts:28-38`). `getStudent` selects by uppercased roll; `findSimilarRolls` suggests up to three nearby rolls by prefix match on the first 8 characters, ranked by numeric distance of the trailing sequence.

### `botusers`

Per-user activity profile for the admin panel.

| Column | Type | Notes |
|---|---|---|
| `user_id` | INTEGER PRIMARY KEY | Telegram user id |
| `username` / `first_name` | TEXT | Kept fresh via COALESCE on conflict |
| `first_seen` / `last_seen` | TEXT | Default `datetime('now')` (UTC) |
| `private_actions` / `channel_actions` / `group_actions` / `total_actions` | INTEGER | Incremented per event |

### `activity_log`

Append-only event stream powering all admin-panel charts and feeds.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | Ordering key for the live feed |
| `user_id` | INTEGER NOT NULL | |
| `chat_type` | TEXT NOT NULL | `private` / `group` / `channel` (supergroup normalized to group) |
| `action` | TEXT NOT NULL | e.g. `roll_lookup`, `attendance`, `daily_checkin`, `register` |
| `detail` | TEXT | e.g. the roll number |
| `created_at` | TEXT NOT NULL | Default `datetime('now')`, pruned after 95 days |

### `admin_sessions`

Server-side admin login sessions.

| Column | Type | Notes |
|---|---|---|
| `token_hash` | TEXT PRIMARY KEY | HMAC of the session token keyed with the admin password |
| `created_at` | TEXT | Default `datetime('now')` |
| `expires_at` | TEXT NOT NULL | Checked with `> datetime('now')`; expired rows pruned on logout and by the daily uptime prune |

### `student_stats`

Projected scores that feed the leaderboard and rank lookups.

| Column | Type | Notes |
|---|---|---|
| `roll_no` | TEXT PRIMARY KEY | |
| `attendance_percentage` | REAL | Latest attendance % |
| `mid_marks_avg` | REAL | Latest computed mid-marks average |
| `last_updated` | TEXT | `datetime('now')` UTC format (no milliseconds), matching the other tables |

Both columns are updated independently with upserts (`updateAttendanceStat`, `updateMidMarkStat`) so writing one never clears the other. Ghost rows whose roll no longer exists in `studentsnew` are excluded from leaderboard and rank queries by an inner join.

### `uptime_log`

Heartbeat history for the status page.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | |
| `component` | TEXT NOT NULL | `api`, `turso`, `redis`, or `portal` |
| `status` | TEXT NOT NULL | `up` / `down` |
| `latency_ms` | INTEGER | Null on failure |
| `created_at` | TEXT NOT NULL | Default `datetime('now')`, pruned after 95 days |

## Indexes

| Index | Table / columns | Supports |
|---|---|---|
| `idx_activity_created` | `activity_log (created_at)` | 30-day / 30-hour admin aggregates and retention deletes |
| `idx_activity_user` | `activity_log (user_id, created_at)` | Per-student drill-down |
| `idx_studentsnew_filters` | `studentsnew (year, branch, section)` | Leaderboard filtering |
| `idx_uptime_component_time` | `uptime_log (component, created_at)` | Uptime summaries and daily buckets |

## Query safety

All queries pass values through libSQL parameter placeholders (`?`) or batch `args` arrays. The two intentional string interpolations are non-user input:

- `getUptimeDailyBuckets` interpolates a day count after clamping it with `Math.max(1, Math.min(365, Math.floor(Number(days) || 90)))` (`src/db/student_stats.model.ts:327`).
- The uptime prune interpolates the module constant `RETENTION_DAYS` (95) into a `datetime()` modifier (`src/services/uptime.ts:131-136`).

Leaderboard `whereClause` fragments are built from fixed allowlisted column names and `?` placeholders, never from raw filter strings (`src/db/student_stats.model.ts:60-102`).

## Related pages

- [Registration and Profile](../registration.md)
- [Caching and Leaderboard Stats](caching-and-stats.md)
- [Daily Check-in and Semester Sync](../bot/checkin-and-syncdb.md)
- [Admin Panel](../api/admin-panel.md)
