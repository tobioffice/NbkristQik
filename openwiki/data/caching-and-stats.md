---
type: architecture
title: Caching and Leaderboard Stats
description: Redis client lifecycle and cache keys with TTLs, background full-section attendance and midmarks caching into student_stats, and the Turso RANK() ranking design behind the leaderboard and per-student rank lookup.
tags: [redis, caching, leaderboard, ranking, ttl]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-09T23:13:13.880Z
sources:
  - id: openwiki-source-714e0c91fd122c36f3217aa4
    resource: repo://src/api/server.ts
  - id: openwiki-source-40646dc6b42fe5872ce25e48
    resource: repo://src/db/student_stats.model.ts
  - id: openwiki-source-290cb8a0cd25881741257ea3
    resource: repo://src/services/redis/getRedisClient.ts
  - id: openwiki-source-0e4ab75775c805a55cb3bf55
    resource: repo://src/services/redis/keys.ts
  - id: openwiki-source-edb052a128252f8ee37b33f6
    resource: repo://src/services/redis/storeAttOrMidToRedis.ts
  - id: openwiki-source-8065dc81cd744796f917712d
    resource: repo://src/services/redis/utils.ts
  - id: openwiki-source-5dc5a436f0ae2158fe59de63
    resource: repo://src/services/student.utils/Academic.ts
  - id: openwiki-source-bee4bb8d3bf8f1191c290348
    resource: repo://src/services/student.utils/checkMembership.ts
  - id: openwiki-source-4ccceffb43b70d8bf38d07a2
    resource: repo://src/services/tracker.ts
generated: { by: "opencode", at: "2026-10-09T23:13:13.880Z" }
---

# Caching and Leaderboard Stats

Two layers keep the leaderboard fast and the portal polite: a Redis cache that absorbs repeat lookups, and a `student_stats` pipeline that projects scraped section data into ranked rows so the API never touches the college portal. The ranking SQL carries a non-obvious Turso pitfall documented in the source itself.

## Redis client lifecycle

`getClient()` (`src/services/redis/getRedisClient.ts`) caches the **connect promise**, not the client. Concurrent first callers share one client — no double connect — and a failed connect is not pinned forever: the rejection handler clears `clientPromise` so the next caller retries. The reconnect strategy is bounded to about four attempts before `connect()` settles with an error, so callers can fall back (the leaderboard serves from Turso) instead of hanging when Redis stays down.

After a failed connect, a **30-second cooldown** (`RETRY_COOLDOWN_MS`, `lastFailureAt`) makes subsequent callers fail fast with "Redis connect in cooldown after failure" instead of re-paying the full reconnect timeout on every request. After the cooldown, the next caller retries the connect.

## Cache keys and TTLs

All key names are built by the shared `redisKeys` module in `src/services/redis/keys.ts`, so prefixes are greppable and cannot drift between modules.

| Key | Written by | TTL | Purpose |
|---|---|---|---|
| `student:{roll}` | `getStudentCached` on read miss | 7 days | Student record (name, branch, section, year) |
| `attendance:{roll}` | background section cache | 1 hour | Parsed `Attendance` JSON |
| `midmarks:{roll}` | background section cache | 2 hours | Parsed `Midmarks` JSON |
| `lb:{sort}:{page}:{limit}:{filters}` | `/api/leaderboard` | 60 s | Serialized leaderboard response |
| `isMember:{userId}` | `checkMembership` positive result | 1 day | Channel membership |
| `track:p:{userId}` | tracker NX gate | 60 s | Throttles per-user profile upserts |
| `dailyUnlocked:{userId}` | check-in callback | until IST midnight | Daily gate |
| `checkin:post:msgId`, `sync:semType`, `qik:users` | check-in/syncdb | none | Operational state |

`cacheFlushPatterns` in the same module defines the SCAN globs (`student:*`, `attendance:*`, `midmarks:*`, `lb:*`) that `/syncdb` deletes after a semester rollover.

`getStudentCached` (`src/services/redis/utils.ts`) raises `StudentNotFoundError` with up to three nearby-roll suggestions when the roll is absent from `studentsnew`, and that error is deliberately propagated rather than masked as an outage.

## Background section caching

The user-facing flow parses only the requester's row first and replies fast; caching the whole section happens in the background, fire-and-forget (`src/services/student.utils/Academic.ts`):

1. `storeAttendanceToRedis` / `storeMidMarksToRedis` (`src/services/redis/storeAttOrMidToRedis.ts:54-133`) load the raw section HTML with cheerio and extract every roll from `tr[id]` elements.
2. All rows are parsed in parallel (`Promise.all`), so a ~60-student section costs roughly two round-trip batches instead of ~120 serial ones.
3. Each parsed payload is written to Redis and its score to `student_stats` in parallel via `persistSectionWrites`, using the TTL constants `CACHE_TTL_ATTENDANCE_S` (1 h) and `CACHE_TTL_MIDMARKS_S` (2 h) and the `redisKeys.attendance` / `redisKeys.midmarks` key builders.
4. Mid-marks additionally resolves every student record with a parallel `Promise.all` of `getStudentCached` calls (failures skip that student), matching the parsing fan-out instead of serial lookups.

The score written per student is:

- **Attendance** — the attendance percentage (`updateAttendanceStat`).
- **Mid-marks** — a computed average (`updateMidMarkStat`, `src/services/redis/storeAttOrMidToRedis.ts:104-126`): for each subject the subject score is `(M1 + M2)/2` when `M2 > 0` else `M1`; subjects with both M1 and M2 zero are excluded from the denominator; and for year `"41"` the average is scaled by `30/40` (final-year marks out of 40 mapped to a 30-point scale).

Both stat writers stamp `last_updated` with SQLite's `datetime('now')` (UTC, no milliseconds) so it matches every other table's timestamp format, and upsert only their own column so writing one never clears the other.

## Leaderboard ranking design

`getLeaderboard` (`src/db/student_stats.model.ts:172-206`) ranks over `student_stats` joined to `studentsnew` for name, year, branch, and section filters, with `RANK()` computed over `ROUND(score, 2)` for attendance and `ROUND(score, 1)` for mid-marks — the same precision the UI displays.

The join is an **INNER JOIN** on purpose: `student_stats` can contain ghost rows for roll numbers that no longer exist in `studentsnew` (re-sectioned students, wiped rolls). A LEFT JOIN would list them with `roll_no = NULL` and no name — blank rows in the web leaderboard, and `null === null` in the frontend's `isMe` check would highlight them all as "You". The inner join keeps only students present in the master table.

The ranking notes in `src/db/student_stats.model.ts:131-162` document three bugs found in September 2026:

1. `ROW_NUMBER()` gave every row a unique rank regardless of ties. Fixed by `RANK()` (competition ranking: ties share a rank, e.g. #1, #1, #1, #4).
2. Ranking on raw decimals while the UI rounded them (29.96 and 30.04 both displayed "30.0" but ranked apart). Fixed by ranking on the rounded expression.
3. **The Turso-specific one**: adding a tiebreaker *inside* the window `ORDER BY` (`RANK() OVER (ORDER BY score DESC, roll_no ASC)`) makes Turso/libSQL compute the rank over the full composite, which silently collapses ties into unique ranks — verified directly against Turso, while stock SQLite behaves "correctly." The fix is to keep only the score inside the window and apply deterministic ordering in the outer query: `ORDER BY rank ASC, roll_no ASC`.

`COUNT(*) OVER()` carries the filtered total alongside each row so the count and page come from one round trip; when a page is empty (offset past the end), a fallback `countFilteredTotal` query keeps the UI's "N students" banner accurate (`src/db/student_stats.model.ts:124-142`, `199-201`).

`getStudentRank` (`src/db/student_stats.model.ts:222-258`) uses the same `RANK()`, rounding scheme, and inner join in a CTE for a single global rank per sort, so the leaderboard list and the `/api/me` "You are #N" banner always agree.

## Related pages

- [REST API and Security](../api/server.md)
- [Database Schema and Models](database.md)
- [College Portal Scraping](../portal/scraping.md)
