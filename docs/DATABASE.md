# NbkristQik Database

**Provider:** libSQL/SQLite via `@libsql/client`.
**Client:** `src/db/db.ts`. `LOCAL_DB_URL` (for example
`file:/home/ubuntu/nbkristqik/data/qik.db`) takes precedence and uses the
embedded SQLite file; when it is unset the client connects to Turso Cloud with
`TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
**Schema owner:** `initDatabase()` in `src/db/init.ts` creates every table and
index idempotently before the bot or API starts.

## Connection and durability

For the embedded database, `configureDatabase()` runs once at the start of
`initDatabase()`, before any table is touched:

| Pragma | Value | Why |
|---|---|---|
| `journal_mode` | `WAL` | readers never block the writer; a crash leaves a recoverable WAL |
| `busy_timeout` | `5000` | a concurrent writer waits up to 5s instead of failing with `SQLITE_BUSY` immediately |
| `synchronous` | `NORMAL` | durable across app crashes with WAL; only OS/power loss can lose the last transaction |
| `foreign_keys` | `ON` | declared relations are enforced instead of SQLite's off default |

Every pragma is best-effort: a failure is logged and boot continues. The
pragmas are a local-engine concern; a networked Turso connection skips them
and the server manages its own. The `file::memory:` database used by tests
reports `journal_mode = memory` instead of `wal`, which is expected.

## Schema versioning

The schema version lives in `PRAGMA user_version` and is currently **1**
(`SCHEMA_VERSION` in `src/db/init.ts`).

- `0` means a fresh or pre-versioning database. Every table is created first,
  then the version is stamped, so a crash mid-init leaves version 0 and the
  next boot retries the whole idempotent schema instead of claiming a version
  it never finished.
- A version **higher** than the running build refuses to start with a clear
  error, so an older build cannot write against a newer database.
- There is no migration framework. Bumping `SCHEMA_VERSION` is the signal; the
  migration itself lives next to the idempotent `CREATE`/`ALTER` statements it
  needs.
- A legacy remote Turso endpoint that does not expose `PRAGMA user_version` is
  logged and skipped; the guard is a safety net, not a connection requirement.

The schema is still created on boot, but it is versioned now: a fresh database
gets the tables and the version stamp, and the version check stops a mismatched
build from starting against a database it does not understand.

## Tables

### `studentsnew` — student master (populated by `/syncdb`)

| Column | Type | Notes |
|---|---|---|
| `roll_no` | TEXT PRIMARY KEY | Uppercased roll |
| `name` | TEXT | Nullable until the name endpoint returns |
| `section` | TEXT | e.g. `A`; `-` for lateral entries |
| `branch` | TEXT | Numeric branch code as text |
| `year` | TEXT | Portal session code, e.g. `41` |

`/syncdb` is fail-closed: if any section request failed or no students were
found, it aborts before touching this table or flushing caches. The upsert is
an atomic batch per 500-row chunk, so a failed chunk rolls back as a whole.

### `tgusers` — Telegram user to last-lookup roll mapping

`userId` TEXT PRIMARY KEY, `rollNo`, `semester`, `department`, `section`.
Written by roll lookups, including a friend's roll. `/api/me` uses it only
when the user has no explicit registration.

### `registrations` — explicit saved roll and display name

| Column | Type | Notes |
|---|---|---|
| `userId` | TEXT PRIMARY KEY | Telegram user id |
| `roll_no` | TEXT NOT NULL | Uppercased; several accounts may share a roll |
| `display_name` | TEXT | Optional; non-empty values override the college name on the leaderboard |
| `registered_at` | TEXT | `datetime('now')` (UTC) |
| `updated_at` | TEXT | `datetime('now')` (UTC) |

Several accounts may save the same roll: a shared roll is common and the
server cannot tell who owns one. Schema v4 dropped the unique index and the
boot-time dedupe that came with it, so two rows for one roll are now normal.
Lookups by roll (`getRegistrationByRoll`, the leaderboard's name subquery)
take the newest claim, `updated_at` descending then `rowid` descending.
Ownership proof is planned; see [`ROADMAP.md`](ROADMAP.md).

### `student_stats` — projected scores for ranking

| Column | Type | Notes |
|---|---|---|
| `roll_no` | TEXT PRIMARY KEY | |
| `attendance_percentage` | REAL | Latest attendance % |
| `mid_marks_avg` | REAL | Latest computed mid average |
| `last_updated` | TEXT | `datetime('now')` format (UTC) |

Both score columns are updated independently with upserts so writing one never
clears the other. The stat writes are the leaderboard's durable output: each
row is written in its own logged try/catch and is never gated on Redis. A Redis
connect failure is logged and the batch still lands, so a cache outage cannot
veto or delay the stats.

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

### `library_documents` — the shelf registry

One row per ingestable document (a subject unit, or a whole subject):
`id` TEXT PRIMARY KEY, `code`, `title`, `dept`, `regulation`, `year_sem`,
`unit`, `kind` (`material`/`assignment`), `source_path`, `page_count`, `bytes`,
`status` (`live`/`coming_soon`), `version`, `created_at`, `updated_at`, with
`UNIQUE (code, unit, kind)`. The page files themselves live on disk under
`data/pages/<docId>/`; this table is only the index.

### `library_reads` — the page-delivery audit trail

`id` INTEGER PRIMARY KEY AUTOINCREMENT, `user_id`, `doc_id`, `page`,
`token` (the opaque watermark token printed on that page), `at` (UTC). One row
per page served; it is what `resolveWatermark` reads. The live burst counter is
kept in Redis, not in this table.

### `admin_sessions` — panel sessions

`token_hash` TEXT PRIMARY KEY (HMAC of the token keyed with the admin
password), `created_at`, `expires_at`. Expired rows are pruned.

### `uptime_log` — heartbeat history

`id`, `component`, `status` (`up`/`down`), `latency_ms`, `created_at` (UTC).
Rows arrive from the external monitor through `POST /internal/uptime`, and —
while the old probe is still enabled during the transition — from the
in-process probe in `src/services/uptime.ts`. The internal route ignores a
duplicate `(component, created_at)`, so replaying a spool after an outage does
not skew the history.

## Indexes

| Index | Table | Columns |
|---|---|---|
| `idx_activity_created` | `activity_log` | `created_at` |
| `idx_activity_user` | `activity_log` | `user_id, created_at` |
| `idx_library_documents_code` | `library_documents` | `code` |
| `idx_library_reads_doc` | `library_reads` | `doc_id, at` |
| `idx_library_reads_token` | `library_reads` | `token` |
| `idx_library_reads_user` | `library_reads` | `user_id, at` |
| `idx_registrations_roll` | `registrations` | `roll_no` |
| `idx_report_messages` | `report_messages` | `report_id, id` |
| `idx_reports_created` | `reports` | `created_at` |
| `idx_reports_status` | `reports` | `status, id` |
| `idx_reports_user` | `reports` | `user_id, created_at` |
| `idx_studentsnew_filters` | `studentsnew` | `year, branch, section` |
| `idx_uptime_component_time` | `uptime_log` | `component, created_at` |

## Retention

`startMaintenance()` runs `prune()` once at startup and then daily. The
startup run matters because a deploy cadence shorter than 24 hours would
otherwise restart the timer before it ever fires.

- `uptime_log`, `activity_log` and `library_reads`: rows older than **95
  days** are deleted.
- `admin_sessions`: rows whose `expires_at` has passed are deleted.

Each table is pruned independently; a missing or locked table is logged and
does not stop the others or break boot.

## Backup and restore

### Nightly backup

[`scripts/backup-db.sh`](../scripts/backup-db.sh) is the cron backup for the
embedded database. It uses SQLite's `VACUUM INTO`, which writes a consistent
copy from a live connection — safe while the bot is running, unlike copying the
file directly under WAL, which can capture a torn write.

1. `VACUUM INTO` a temporary copy.
2. Run `PRAGMA integrity_check` on the copy (not the live database) and fail
   if it is not `ok`.
3. Move the verified copy into place and keep the newest `BACKUP_KEEP`
   (default 7) files.
4. Copy it off-box to `BACKUP_REMOTE` (default
   `ubuntu@140.245.255.152`), pruning the remote set too.

A failed off-box copy exits non-zero while keeping the verified local backup
intact, so cron cannot mistake a local-only night for a complete backup. The
deploy script also takes a pre-restart `VACUUM INTO` copy when
`DEPLOY_DB_URL` is configured; a configured backup that fails aborts the deploy
before the restart. See [`docs/DEPLOYMENT.md`](DEPLOYMENT.md).

### Manual restore

[`scripts/restore-db.sh`](../scripts/restore-db.sh) is intentionally manual:
nothing in deploy, cron or the app calls it.

- It verifies the backup with `integrity_check` before touching anything.
- It refuses to run while the `nbkristqik` service (or a `dist/bot/index.js`
  process) is running, unless `--force` is passed.
- It keeps the current database at `<db>.pre-restore-<UTC>` and stages the
  restored file to a temporary path, verifies it again, then renames it into
  place. It removes the replaced database's `-wal` and `-shm` files so old
  pages cannot mix into the restored file.

## Importing a Turso snapshot

[`scripts/import-turso-snapshot.mjs`](../scripts/import-turso-snapshot.mjs)
merges a `turso db export` file into the local database:

```bash
node scripts/import-turso-snapshot.mjs /path/to/export.db
```

| Table | Merge policy |
|---|---|
| `reports`, `report_messages` | copied verbatim, only while the local table is empty (AUTOINCREMENT ids would collide otherwise; a non-empty table fails the import) |
| `library_reads` | copied verbatim only while local is empty; on a later run the local audit trail is kept and the table is skipped, not failed |
| `report_reads`, `registrations`, `tgusers`, `botusers`, `studentsnew`, `student_stats`, `library_documents` | `INSERT OR IGNORE` on the natural key; local rows win |
| `uptime_log` | rows whose `(component, created_at)` already exist are skipped; ids are reassigned |
| `admin_sessions`, `activity_log` | deliberately not merged (ephemeral sessions, and the activity log is the bulk of the export) |

A table that is absent from the source export (for example an old export made
before the library tables existed) is skipped with a message and does not fail
the whole import. Every statement is idempotent; the script exits non-zero if a
required table could not be merged.

## Query safety

All queries use libSQL parameter placeholders. The only string interpolations
are clamped integers: the day count in `getUptimeDailyBuckets` (clamped to
1–365) and the module-level `RETENTION_DAYS` constant, neither of which is user
input. The schema version interpolated into `PRAGMA user_version` is likewise a
module constant.
