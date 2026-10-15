---
type: workflow
title: Semester Sync
description: The admin-only /setsem and /syncdb semester rollover — one shared runSyncDb engine that logs into the college portal, detects the academic year and sessions, scrapes every class section, extracts rolls, fetches names, upserts studentsnew, flushes caches, and can be re-run from the CLI.
tags: [telegram, admin, syncdb, semester, cli]
sources:
  - id: openwiki-source-2c2f76c1ef875a091a93cc02
    resource: repo://src/bot/syncdb.ts
  - id: openwiki-source-c7e56a5aad8a647163c3aa5b
    resource: repo://src/bot/syncdbCli.ts
  - id: openwiki-source-f3a065ecee23ee5a53fe9d83
    resource: repo://src/constants/index.ts
  - id: openwiki-source-0e4ab75775c805a55cb3bf55
    resource: repo://src/services/redis/keys.ts
generated: { by: "opencode", at: "2026-10-15T21:12:57.495Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-15T21:12:57.495Z
---

# Semester Sync

`/syncdb` is the admin-only semester rollover: one command replaces the old manual database workflow. It logs into the college portal, discovers the active academic year and semesters, scrapes every class section, upserts the `studentsnew` master table, and flushes the caches that held last semester's sections.

The daily check-in gate that used to live beside this flow was removed outright — no `/postcheckin`, no `dailycheck` callback, no `dailyUnlocked` keys. The only per-user answer limit left is the group-use gate, which belongs to [Bot Commands and Authorization](commands-and-authorization.md).

## Admin flow

- `/setsem 1` persists the 1st-semester type (sessions 11/21/31/41); `/setsem 2` picks 12/22/32/42. With no argument it reports the current setting (`src/bot/syncdb.ts:461-487`).
- `/syncdb` runs with the stored semester; `/syncdb 1`, `/syncdb 2025-26`, or `/syncdb 1 2025-26` set the semester type and/or override the academic year inline. An explicit semester argument is persisted for future runs (`src/bot/syncdb.ts:490-557`).
- The CLI runs the same engine on the server: `node dist/bot/syncdbCli.js [1|2] [YYYY-YY]` (`src/bot/syncdbCli.ts`). Progress goes to stdout instead of a Telegram message; it is the re-sync path after a database rebuild or when the chat is inconvenient.

The semester setting lives in Redis under `redisKeys.syncSemType` (`sync:semType`), so it survives service restarts. The college site cannot tell the bot which semester is running; the admin sets it once at semester start.

## Phases

`runSyncDb` (`src/bot/syncdb.ts:395`) is shared by the command and the CLI and runs six phases, editing one progress message in place throughout (`SyncContext`, `src/bot/syncdb.ts:56-64`). The CLI replaces the Telegram sink with an `onProgress` callback.

1. **Login** (`loginToPortal`, `src/bot/syncdb.ts:113-132`) — POSTs credentials with an empty captcha field using the same generated-`PHPSESSID` trick as the scraper, accepting 2xx/3xx without following redirects.
2. **Detect sessions** (`detectSessions`, `src/bot/syncdb.ts:135-164`) — loads `attendanceTillADate.php`, takes the last `acadYear` dropdown option as current (unless overridden by the argument) and reads valid `yearSem` values from the dropdown, filtered to the active semester type. If no sessions match, the sync aborts with a hint to check `/setsem`.
3. **Scrape combos** (`scrapeCombos`, `src/bot/syncdb.ts:171-298`) — POSTs `attendanceTillTodayReport.php` for every yearSem × branch × section combination, using the `BRANCHES` key set as the branch list and sections A–J plus `-`, with a pool of `CONCURRENCY = 3` workers and a 120 ms politeness sleep per request. A response without `<td>1.</td>` means no class there. Progress is edited at most every 5 seconds.
4. **Fetch names** (`fetchStudentNames`, `src/bot/syncdb.ts:301-329`) — GETs each student's name from `getStudentName.php?q={roll}` with the same 3-worker pool and 60 ms sleeps; failures leave the name null.
5. **Upsert** (`upsertStudents`, `src/bot/syncdb.ts:332-367`) — batches of 50 concurrent upserts into `studentsnew` on `roll_no` conflict, updating section, branch, and year while preserving an existing name when the new one is null (`COALESCE`). Failures are counted and surfaced in the summary.
6. **Flush caches** (`flushCaches`, `src/bot/syncdb.ts:370-386`) — SCANs and deletes the patterns in `cacheFlushPatterns` from `src/services/redis/keys.ts:30-35` (`student:*`, `attendance:*`, `midmarks:*`, `lb:*`) so the bot serves fresh sections and the leaderboard does not hold stale ranks. The `groupUses` counter is deliberately not on that list, so a sync never resets a user's group answers.

The final summary shows per-session student counts and reminds the admin that students receive their new sections on their next check.

### Roll extraction

Roll numbers are read from `td.tdRollNo` cells. The canonical value is the enclosing row's id (`26KB101001`); the fallback chain is row id → cell id with its `td` prefix stripped → cell text with whitespace removed, and each candidate is shape-checked (`[A-Za-z0-9]{6,16}`) before use (`src/bot/syncdb.ts:232-253`). Preferring the row id matters: the cell's own id is `td` + roll and its text can carry a display space, so trimming a single character from the id once left a stray `d`, which uppercased into a bogus `D26KB101001` that no student ever types, making every lookup fail. The shape check now rejects that class of garbage before it can reach `studentsnew`.

### Branch coverage

The sync scans by `Object.keys(BRANCHES)`, and the map in `src/constants/index.ts:43-65` mirrors the college portal's academic branch dropdown: CSE, AI_DS, MECH, ECE, EEE, CIVIL, IT, CSE_DS, CSE_AIML, AIML, the MTech variants (PS, CSE, ECE, AMS, RAI, VLSI, AI, AIDS), and the diploma variants (DIP_CSE, DIP_EEE, DIP_ECE, DIP_ME). Non-academic dropdown entries (NCC Army/Naval, Ladies Hostel) are deliberately excluded since they never carry student reports. The web app keeps a mirrored copy in `src/web/src/constants.ts` for its filter dropdown.

### Auth-loss abort

The portal can invalidate the session mid-sync. The scan workers detect the login page by its `name='username'` marker (`isLogin`, `src/bot/syncdb.ts:169`); on detection they set `authLost`, abort the other workers, and the sync throws "College portal session expired mid-sync — run /syncdb again" rather than silently counting the remaining combos as empty (`src/bot/syncdb.ts:222-227`, `288-292`).

## Related pages

- [Bot Commands and Authorization](commands-and-authorization.md)
- [College Portal Scraping](../portal/scraping.md)
- [Database Schema and Models](../data/database.md)
