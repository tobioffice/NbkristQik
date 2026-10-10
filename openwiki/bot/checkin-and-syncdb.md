---
type: workflow
title: Daily Check-in and Semester Sync
description: Two admin-driven operational flows — the /postcheckin daily attention gate with Redis unlocks expiring at IST midnight, and /setsem plus /syncdb semester rollover that scrapes the college portal into studentsnew.
tags: [telegram, admin, check-in, syncdb, semester]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-09T23:13:13.880Z
sources:
  - id: openwiki-source-04d02aea694a5ea720fe8290
    resource: repo://src/bot/academics/academicHandler.ts
  - id: openwiki-source-f7b94ca1aeafebacf0189de2
    resource: repo://src/bot/dailyCheckIn.ts
  - id: openwiki-source-2c2f76c1ef875a091a93cc02
    resource: repo://src/bot/syncdb.ts
  - id: openwiki-source-f3a065ecee23ee5a53fe9d83
    resource: repo://src/constants/index.ts
  - id: openwiki-source-0e4ab75775c805a55cb3bf55
    resource: repo://src/services/redis/keys.ts
generated: { by: "opencode", at: "2026-10-09T23:13:13.880Z" }
---

# Daily Check-in and Semester Sync

Two admin-only flows keep the bot's user base current and its growth loop running:

- **Daily check-in** (`src/bot/dailyCheckIn.ts`) — an attention gate that asks users to tap a button on a pinned channel post before the bot answers them each day.
- **Semester sync** (`src/bot/syncdb.ts`) — a one-command replacement for the old manual database workflow: it logs into the college portal, discovers the active academic year and semesters, scrapes every class section, and upserts the student master table.

## Daily check-in

### The gate

`isDailyUnlocked(userId)` (`src/bot/dailyCheckIn.ts:39-50`) is consulted by the academic handler's authorization gate:

1. If Redis has no `checkin:post:msgId` key (via `redisKeys.checkinPostMsgId`), the gate is **dormant** and returns `true` — the feature only activates after an admin has posted the check-in message once.
2. Otherwise it returns whether the `redisKeys.dailyUnlocked(userId)` key equals `"1"`.
3. Any Redis failure returns `true`: a cache outage must never hard-lock users out.

When locked, the handler replies with a "Prove you're human!" message containing an inline URL button. `getCheckInLink` (`src/bot/dailyCheckIn.ts:52-66`) builds a deep link `https://t.me/{channel}/{msgId}` from the stored message id, falling back to the channel root or the bot link when Redis or `CHANNEL_ID` is unavailable.

### Creating the post

`/postcheckin` (admin only, `src/bot/dailyCheckIn.ts:104-124`) deletes the previous pinned post if its id is still in Redis, sends a new channel message with a `🤖 I'm not a robot 👇` button carrying callback data `dailycheck`, pins it silently, and stores the new message id. It replies to the admin with the post's deep link and a note that the gate is now active.

### Unlocking

The `dailycheck` callback (`src/bot/dailyCheckIn.ts:126-158`) is handled exclusively here — the academic handler explicitly ignores it so it is neither rate-limited nor treated as a menu message. On tap it:

1. Sets `dailyUnlocked:{userId}` to `"1"` with a TTL from `secondsUntilMidnightIST()` (`src/bot/dailyCheckIn.ts:20-36`). That function takes an injectable `now` parameter (defaulting to the current time) and shifts it into a pseudo-IST clock by adding 5.5 hours, computes the next midnight in UTC terms, and clamps the TTL to at least 60 seconds — so unlocks reset on the Indian calendar day (IST = UTC+5:30). The injectable `now` makes the TTL math unit-testable.
2. Adds the user to the `redisKeys.broadcastUsers` (`qik:users`) Redis set.
3. Records a `daily_checkin` activity event.
4. Answers the callback with a success toast and a URL to `https://t.me/NbkristQik_bot?start=unlocked`, which `/start` recognizes with a dedicated welcome message.

## Semester sync

The admin flow documented in `src/bot/syncdb.ts:14-19` is:

- `/setsem 1` — persist that the running semester is the 1st-semester type (sessions 11/21/31/41); `/setsem 2` for 12/22/32/42. With no argument it reports the current setting (`src/bot/syncdb.ts:336-362`).
- `/syncdb` — sync using the stored semester; `/syncdb 1`, `/syncdb 2025-26`, or `/syncdb 1 2025-26` set the semester and/or override the academic year inline (`src/bot/syncdb.ts:365-466`).

The setting lives in Redis under `redisKeys.syncSemType`, so it survives service restarts. The college site cannot tell the bot which semester is running; the admin sets it once at semester start.

### Phases

`/syncdb` runs six phases, editing one progress message in place throughout (`SyncContext`, `src/bot/syncdb.ts:44-60`):

1. **Login** (`loginToPortal`, `src/bot/syncdb.ts:76-95`) — POSTs credentials with an empty captcha field using the same generated-`PHPSESSID` trick as the scraper, accepting 2xx/3xx without following redirects.
2. **Detect sessions** (`detectSessions`, `src/bot/syncdb.ts:98-127`) — loads `attendanceTillADate.php`, takes the last `acadYear` dropdown option as current (unless overridden by the argument) and reads valid `yearSem` values from the dropdown, filtered to the active semester type. If no sessions match, the sync aborts with a hint to check `/setsem`.
3. **Scrape combos** (`scrapeCombos`, `src/bot/syncdb.ts:134-245`) — POSTs `attendanceTillTodayReport.php` for every yearSem × branch × section combination, using the `BRANCHES` key set as the branch list and sections A–J plus `-`, with a pool of `CONCURRENCY = 3` workers and a 120 ms politeness sleep per request. A response without `<td>1.</td>` means no class there; otherwise roll numbers are read from `td.tdRollNo` elements and stripped of their leading marker. Progress is edited at most every 5 seconds.
4. **Fetch names** (`fetchStudentNames`, `src/bot/syncdb.ts:248-276`) — GETs each student's name from `getStudentName.php?q={roll}` with the same 3-worker pool and 60 ms sleeps; failures leave the name null.
5. **Upsert** (`upsertStudents`, `src/bot/syncdb.ts:279-314`) — batches of 50 concurrent upserts into `studentsnew` on `roll_no` conflict, updating section, branch, and year while preserving an existing name when the new one is null. Failures are counted and surfaced in the summary.
6. **Flush caches** (`flushCaches`, `src/bot/syncdb.ts:317-332`) — SCANs and deletes the patterns in `cacheFlushPatterns` from `src/services/redis/keys.ts` (`student:*`, `attendance:*`, `midmarks:*`, `lb:*`) so the bot serves fresh sections and the leaderboard does not hold stale ranks.

The final summary shows per-session student counts and reminds the admin that students receive their new sections on their next check.

### Branch coverage

The sync scans by `Object.keys(BRANCHES)`, and the map in `src/constants/index.ts:43-66` now mirrors the college portal's full academic branch dropdown, verified against the live portal: CSE, AI_DS, MECH, ECE, EEE, CIVIL, IT, CSE_DS, CSE_AIML, AIML, the MTech variants (PS, CSE, ECE, AMS, RAI, VLSI, AI, AIDS), and the diploma variants (DIP_CSE, DIP_EEE, DIP_ECE, DIP_ME). Non-academic dropdown entries (NCC Army/Naval, Ladies Hostel) are deliberately excluded since they never carry student reports. The web app keeps a mirrored copy in `src/web/src/constants.ts` for its filter dropdown.

### Auth-loss abort

The portal can invalidate the session mid-sync. The scan workers detect the login page by its `name='username'` marker (`isLogin`, `src/bot/syncdb.ts:132`); on detection they set `authLost`, abort the other workers, and the sync throws "College portal session expired mid-sync — run /syncdb again" rather than silently counting the remaining combos as empty (`src/bot/syncdb.ts:185-239`).

## Related pages

- [Bot Commands and Authorization](commands-and-authorization.md)
- [College Portal Scraping](../portal/scraping.md)
- [Database Schema and Models](../data/database.md)
