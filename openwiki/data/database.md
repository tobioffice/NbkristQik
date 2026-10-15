---
type: reference
title: Database Schema and Models
description: Complete libSQL/SQLite schema reference for NbkristQik — twelve tables created by src/db/init.ts over an embedded database (LOCAL_DB_URL) or Turso Cloud, their indexes, composite key conventions, the report-thread tables, backups, and the model modules that query each.
tags: [database, turso, schema, sqlite, persistence]
sources:
  - id: openwiki-source-c6b335367a1f46dd2f428811
    resource: repo://scripts/backup-db.sh
  - id: openwiki-source-865237b1d816f433f23630f8
    resource: repo://scripts/import-turso-snapshot.mjs
  - id: openwiki-source-1904030dfb49db04cb06af5b
    resource: repo://src/db/db.ts
  - id: openwiki-source-27353b7693abd731710d1b72
    resource: repo://src/db/fallback/response.model.ts
  - id: openwiki-source-51ebf01a6987b9612a7dd707
    resource: repo://src/db/init.ts
  - id: openwiki-source-e2d605fc24401a4f2602626d
    resource: repo://src/db/registration.model.ts
  - id: openwiki-source-e1e7c83fe5cbc0aa6334cb23
    resource: repo://src/db/report.model.ts
  - id: openwiki-source-40646dc6b42fe5872ce25e48
    resource: repo://src/db/student_stats.model.ts
  - id: openwiki-source-bb916d406342a6553647f81f
    resource: repo://src/db/student.model.ts
  - id: openwiki-source-0be99d3f1664956f03d52278
    resource: repo://src/services/uptime.ts
generated: { by: "opencode", at: "2026-10-15T21:12:57.495Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-15T21:12:57.495Z
---

# Database Schema and Models

All persistence lives in a single libSQL/SQLite database accessed through one shared client, `turso` (`src/db/db.ts:13-20`). With `LOCAL_DB_URL` set (e.g. `file:/home/ubuntu/nbkristqik/data/qik.db`) it is an embedded file on the same box — no network hop and no read quota; with it unset the client talks to Turso Cloud using `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`. Every module imports the same client, so switching modes needs no code change. Tables are created idempotently by `initDatabase()` (`src/db/init.ts:12-133`) — the single schema entry point — which `src/bot/index.ts` awaits before any handler or the API starts; it also replays legacy reports into the thread tables once (`backfillReportThreads`, `src/db/init.ts:141-173`).

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
| `action` | TEXT NOT NULL | e.g. `roll_lookup`, `attendance`, `register` |
| `detail` | TEXT | e.g. the roll number |
| `created_at` | TEXT NOT NULL | Default `datetime('now')`, pruned after 95 days |

### `admin_sessions`

Server-side admin login sessions.

| Column | Type | Notes |
|---|---|---|
| `token_hash` | TEXT PRIMARY KEY | HMAC of the session token keyed with the admin password |
| `created_at` | TEXT | Default `datetime('now')` |
| `expires_at` | TEXT NOT NULL | Checked with `> datetime('now')`; expired rows pruned on logout and by the daily uptime prune |

### `reports`

One row per filed issue — the inbox head the admin panel lists.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | Displayed as the `QIK-####` issue id |
| `user_id` | INTEGER NOT NULL | Reporter |
| `message` | TEXT NOT NULL | The opening message |
| `status` | TEXT NOT NULL | Default `open`; `answered` / `resolved` as the admin works it |
| `admin_reply` / `replied_at` | TEXT | Latest admin reply, kept for older clients and Telegram notices |
| `created_at` | TEXT NOT NULL | Default `datetime('now')` |

### `report_messages`

One row per message in a report's conversation, oldest first. The thread is the source of truth; the `reports` row keeps the opening message and latest reply so pre-thread clients and the Telegram notices keep working.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | |
| `report_id` | INTEGER NOT NULL | References `reports.id` |
| `author` | TEXT NOT NULL | `user` or `admin` |
| `body` | TEXT NOT NULL | |
| `created_at` | TEXT NOT NULL | Default `datetime('now')` |

### `report_reads`

How far each side has read a thread, driving the unread counts in the admin drawer and the student's report list.

| Column | Type | Notes |
|---|---|---|
| `report_id` / `reader` | INTEGER / TEXT | Composite primary key; reader is `user` or `admin` |
| `last_seen_id` | INTEGER NOT NULL | Default 0; advanced with `MAX()` so it never moves backwards |
| `seen_at` | TEXT NOT NULL | Default `datetime('now')` |

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
| `idx_report_messages` | `report_messages (report_id, id)` | Thread reads in order |
| `idx_activity_created` | `activity_log (created_at)` | 30-day / 30-hour admin aggregates and retention deletes |
| `idx_activity_user` | `activity_log (user_id, created_at)` | Per-student drill-down |
| `idx_reports_created` | `reports (created_at)` | Issue inbox ordering |
| `idx_reports_user` | `reports (user_id, created_at)` | A student's own report list |
| `idx_reports_status` | `reports (status, id)` | Inbox filtered by status |
| `idx_studentsnew_filters` | `studentsnew (year, branch, section)` | Leaderboard filtering |
| `idx_uptime_component_time` | `uptime_log (component, created_at)` | Uptime summaries and daily buckets |

## Query safety

All queries pass values through libSQL parameter placeholders (`?`) or batch `args` arrays. The two intentional string interpolations are non-user input:

- `getUptimeDailyBuckets` interpolates a day count after clamping it with `Math.max(1, Math.min(365, Math.floor(Number(days) || 90)))` (`src/db/student_stats.model.ts:327`).
- The uptime prune interpolates the module constant `RETENTION_DAYS` (95) into a `datetime()` modifier (`src/services/uptime.ts:131-136`).

Leaderboard `whereClause` fragments are built from fixed allowlisted column names and `?` placeholders, never from raw filter strings (`src/db/student_stats.model.ts:60-102`).

## Backups and migration

With the embedded database the file itself matters, so two scripts guard it:

- `scripts/backup-db.sh` — a nightly `VACUUM INTO` copy (consistent under WAL while the bot runs, unlike copying the file directly), keeping the 7 newest `qik-*.db` in `/home/ubuntu/backups` (cron `15 2 * * *`). An off-box copy goes to oracle2's `/home/ubuntu/qik-backups`; an unreachable or failing remote only warns — the local backup still counts.
- `scripts/import-turso-snapshot.mjs` — merges a `turso db export` file into the local database if the old Turso data ever becomes readable (quota reset or overages enabled): `reports`/`report_messages` are copied verbatim only while the local tables are still empty (local ids are `AUTOINCREMENT`, so old `QIK-####` ids must not collide with newly filed reports), `report_reads`/`registrations`/`tgusers`/`botusers` use `INSERT OR IGNORE` so local rows win, and `uptime_log` rows are deduplicated on `(component, created_at)`. `student_stats`, `admin_sessions`, and `activity_log` are deliberately skipped. Every statement is idempotent, so a rerun is safe.

## Related pages

- [Registration and Profile](../registration.md)
- [Caching and Leaderboard Stats](caching-and-stats.md)
- [Semester Sync](../bot/checkin-and-syncdb.md)
- [Admin Panel](../api/admin-panel.md)
