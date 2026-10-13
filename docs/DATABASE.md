# NbkristQik Database

> **Note:** The generated wiki is authoritative; see
> [`openwiki/data/database.md`](openwiki/data/database.md). If this file
> disagrees with the code, the code wins.

**Provider:** Turso (libSQL/SQLite) via `@libsql/client`.
**Client:** `src/db/db.ts` connects with `TURSO_DATABASE_URL` and
`TURSO_AUTH_TOKEN`.
**Schema owner:** `initDatabase()` in `src/db/init.ts` creates every table and
index idempotently before the bot or API starts.

## Tables

### `studentsnew` — student master (populated by `/syncdb`)

| Column | Type | Notes |
|---|---|---|
| `roll_no` | TEXT PRIMARY KEY | Uppercased roll |
| `name` | TEXT | Nullable until the name endpoint returns |
| `section` | TEXT | e.g. `A`; `-` for lateral entries |
| `branch` | TEXT | Numeric branch code as text |
| `year` | TEXT | Portal session code, e.g. `41` |

### `tgusers` — Telegram user to roll mapping

`userId` TEXT PRIMARY KEY, `rollNo`, `semester`, `department`, `section`.
Written on roll lookups; powers "You are #N" on the web leaderboard.

### `student_stats` — projected scores for ranking

| Column | Type | Notes |
|---|---|---|
| `roll_no` | TEXT PRIMARY KEY | |
| `attendance_percentage` | REAL | Latest attendance % |
| `mid_marks_avg` | REAL | Latest computed mid average |
| `last_updated` | TEXT | `datetime('now')` format (UTC) |

Both score columns are updated independently with upserts so writing one never
clears the other.

### `fallbackResponses` — last-good portal HTML

`id` TEXT PRIMARY KEY (`CHECK(LENGTH(id) <= 50)`), `content` TEXT. The id is
built as `<year>-<branch>-<section>-<type>` where type is `att` or `mid`.

### `botusers` — per-user activity profile

`user_id` INTEGER PRIMARY KEY, `username`, `first_name`, `first_seen`,
`last_seen` (UTC), and the counters `private_actions`, `channel_actions`,
`group_actions`, `total_actions`.

### `activity_log` — event stream

`id` INTEGER PRIMARY KEY AUTOINCREMENT, `user_id`, `chat_type`,
`action`, `detail`, `created_at` (UTC). Retained 95 days.

### `reports` — one row per issue (the thread's head)

`id` INTEGER PRIMARY KEY AUTOINCREMENT (rendered as `QIK-0007`), `user_id`,
`message` (the opening message), `status` (`open`/`answered`/`resolved`),
`admin_reply` + `replied_at` (the latest admin reply, mirrored from the
thread so older clients keep working), `created_at` (UTC).

### `report_messages` — the conversation itself

`id` INTEGER PRIMARY KEY AUTOINCREMENT, `report_id`, `author`
(`user`/`admin`), `body`, `created_at` (UTC). Oldest first; `createReport`
seeds it with the opening message, and `backfillReportThreads()` in
`initDatabase()` replays pre-thread reports and their single reply as the
first two entries (idempotent, runs every boot).

### `report_reads` — how far each side has read

`report_id`, `reader` (`user`/`admin`), `last_seen_id`, `seen_at`, keyed on
`(report_id, reader)`. Drives the "2 new" stamp on the report list and the
panel's unread markers; opening a thread moves the marker forward only.

### `admin_sessions` — panel sessions

`token_hash` TEXT PRIMARY KEY (HMAC of the token keyed with the admin
password), `created_at`, `expires_at`. Expired rows are pruned.

### `uptime_log` — heartbeat history

`id`, `component`, `status` (`up`/`down`), `latency_ms`, `created_at` (UTC).
Retained 95 days.

## Indexes

| Index | Table | Columns |
|---|---|---|
| `idx_activity_created` | `activity_log` | `created_at` |
| `idx_activity_user` | `activity_log` | `user_id, created_at` |
| `idx_report_messages` | `report_messages` | `report_id, id` |
| `idx_reports_created` | `reports` | `created_at` |
| `idx_reports_status` | `reports` | `status, id` |
| `idx_reports_user` | `reports` | `user_id, created_at` |
| `idx_studentsnew_filters` | `studentsnew` | `year, branch, section` |
| `idx_uptime_component_time` | `uptime_log` | `component, created_at` |

## Query safety

All queries use libSQL parameter placeholders. The only string interpolations
are a clamped day count (`getUptimeDailyBuckets`) and the retention constant
(`RETENTION_DAYS`), neither of which is user input.
