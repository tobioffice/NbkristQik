---
type: reference
title: Academic Data Flow
description: A roll-number lookup end to end — validation, the shared authorization gate, the table-driven callback dispatch, and the reply formatters that draw the attendance, mid-marks and bunk tables.
tags: [bot, attendance, midmarks, formatting, authorization]
sources:
  - id: openwiki-source-04d02aea694a5ea720fe8290
    resource: repo://src/bot/academics/academicHandler.ts
  - id: openwiki-source-b454a8130fe1b59fd2ff52ab
    resource: repo://src/bot/academics/studentActions.ts
  - id: openwiki-source-9628533565ba429ce21df54f
    resource: repo://src/bot/authorization.ts
  - id: openwiki-source-f7b94ca1aeafebacf0189de2
    resource: repo://src/bot/dailyCheckIn.ts
  - id: openwiki-source-1d45088626f10df0fdd2b150
    resource: repo://src/bot/replies.ts
  - id: openwiki-source-f3a065ecee23ee5a53fe9d83
    resource: repo://src/constants/index.ts
  - id: openwiki-source-4716507514d96417fd36a7bf
    resource: repo://src/middleware/security.ts
  - id: openwiki-source-0e166fabba1bdebcfa3beecc
    resource: repo://src/services/student.service.ts
  - id: openwiki-source-dfd265dd267c1406d347369c
    resource: repo://src/services/student.utils/AcademicTG.ts
  - id: openwiki-source-9b164d771bbcef79db2bdcd4
    resource: repo://src/services/student.utils/formatters.ts
generated: { by: "opencode", at: "2026-10-24T11:00:48.405Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-24T11:00:48.405Z
---

# Academic Data Flow

This page traces the primary user journey: a student sends their roll number, taps an inline button, and receives formatted attendance, mid-marks, or a bunk plan. The entry point is `src/bot/academics/academicHandler.ts`; the service chain below it is `student.service` → `AcademicTG` → `Academic`. Registered users can skip the roll step with `/attendance`, `/midmarks`, and `/bunk` (see [Registration and Profile](../registration.md)); both paths converge on the same `studentActions` flow.

## Roll-number message handling

`bot.onText(ROLL_REGEX, …)` (`src/bot/academics/academicHandler.ts`) routes every text message matching the roll-number pattern. In the chit-chat group the message is deleted and a self-deleting notice is sent instead (`handleChitChatRoll`). Otherwise `handleRollNumberMessage` runs in this order:

1. **Channel guard** — a message posted in a channel returns immediately: channels are broadcast, so there is no reply to give.
2. **Persist the userId→roll mapping** — `persistRollMapping` fire-and-forgets an upsert into `tgusers` (used later by "You are #N" on the web leaderboard); failures are swallowed.
3. **Rate limit** — `botSecurityHandler(userId, "roll_number")` allows 10 requests per user per minute; over the limit the student gets `TOO_FAST` from `src/bot/replies.ts`.
4. **Validate format** — `isValidRollNumber` applies `ROLL_REGEX` (`/^\d{2}[a-zA-Z0-9]{2}[a-zA-Z0-9]{6}$/`) from `src/constants/index.ts`, shared with the API's security middleware. Invalid input gets `BAD_ROLL` and stops.
5. **Authorize** — `isAuthorizedUser` from `src/bot/authorization.ts` (admin, channel membership, daily check-in). This path passes `joinPromptChatId: userId`, so the "join the channel" card always lands in the student's DM and never in a group.
6. **Track** — `rememberStudent` adds the caller to the broadcast set, and `trackActivity` records a `roll_lookup` action with the roll number as detail.
7. **Reply with options** — `sendRollOptions` sends an inline keyboard with `Attendance 🚀`, `Mid Marks 📊`, `Bunk Plan 🎯`, and a leaderboard button; the leaderboard is a `web_app` button in private chats and a plain URL in groups.

The top-level `.catch` on the roll handler replies with `SOMETHING_BROKE` before logging, so an unexpected failure is never silent.

## Callback dispatch

Callback data is `<prefix><roll>`, where the prefix is defined once in the `CALLBACK_ACTIONS` table (`att_`, `mid_`, `bunk_`) alongside the activity name it records and the function it runs. The same table answers both "what did the student ask for" (for tracking) and "what should run", so the two cannot drift apart.

The shared `callback_query` listener wraps the whole handler in a try/catch: on an unexpected throw it logs the error and answers the callback with an alert, so a tap can never hang unanswered. Inside, `handleCallbackQuery`:

1. Ignores `dailycheck` taps, which `src/bot/dailyCheckIn.ts` handles end to end.
2. Dismisses channel taps with an empty answer and returns.
3. Answers chit-chat callbacks with an alert and returns.
4. Rate-limits, then authorizes the actor (`callbackQuery.from.id` — in a channel `msg.from` is the channel itself, so the actor always comes from the callback).
5. Tracks the action using the table's `tracked` name and the roll sliced off after the prefix.
6. Runs three tasks concurrently with `Promise.allSettled`: delete the menu message, run the action, and answer the callback query. Rejected steps are logged individually.

`runAction` slices the roll from the callback data, re-validates it (`BAD_ROLL` when it fails), then calls the table's `run`.

## Authorization degradation

`isAuthorizedUser` (`src/bot/authorization.ts`) degrades instead of locking users out when Redis is down: the cached-membership read returns false on error, and a throwing live membership check is treated as "allow". The admin skips the gate entirely, and a student who has not checked in today gets the pinned check-in link instead of an answer. See [Bot Commands and Authorization](commands-and-authorization.md) for the full gate order and the shared copy in `src/bot/replies.ts`.

## Placeholder-then-edit UX

`fetchAndEdit` in `src/bot/academics/studentActions.ts` is the shared flow for all three actions:

1. Send a placeholder message in `<code>` tags ("Getting your attendance...", "Getting your mid marks...", or "Working out what you can bunk..."), with notifications disabled and threaded under the student's message.
2. Await the real content, then edit the placeholder in place. A failed edit is only warned about, since the content was already fetched.
3. If fetching throws, send the error's message to the chat as a new message; a bare error falls back to `SOMETHING_BROKE`.

Because `AcademicTG` methods return user-facing strings even for errors (below), the edit path — not the catch path — is what students normally see on scrape failures.

## Service chain: student.service → AcademicTG → Academic

`src/services/student.service.ts` exposes three thin helpers — `getAttendance`, `getMidMarks`, `getBunkPlan` — each constructing an `AcademicTG` for the roll number and calling the matching message method.

`AcademicTG` (`src/services/student.utils/AcademicTG.ts`) is the presentation layer:

- `getAttendanceMessage`, `getMidmarksMessage`, and `getBunkPlanMessage` wrap `getAttendanceJSON` / `getMidmarksJSON` in try/catch.
- On success they delegate to `formatAttendanceMessage`, `formatMidmarksMessage`, or `formatBunkPlanMessage` in `formatters.ts`.
- On failure `formatErrorMessage` maps error types to message builders: `ServerDownError`, `NoDataFoundError`, `StudentNotFoundError` (which includes nearby-roll suggestions), `BlockedReportError`, other `AcademicError`s, and a generic unknown-error fallback. All timestamps are rendered in `Asia/Kolkata`.

`Academic` (base class, `src/services/student.utils/Academic.ts`) owns the portal fetch, Redis JSON cache, fallback response cache, and parsing. Its details — session renewal, retry, blocked-report detection, and the typed error hierarchy — are covered in [College Portal Scraping](../portal/scraping.md). Cache keys and TTLs are covered in [Caching and Leaderboard Stats](../data/caching-and-stats.md).

## Formatting outputs

The formatters in `src/services/student.utils/formatters.ts` produce Telegram HTML. All three tables are drawn by one `preTable(columns, rows)` helper: a column declares its header, width and alignment, and the helper pads, joins with ` │ ` and rules the table. A new column is therefore one entry, not a new set of `padStart` calls, and the three tables cannot drift into different widths.

- **Attendance** — header with roll, branch string (`{year}_{branch name}_{section}`), attended/conducted totals, percentage, a 10-block progress bar coloured by threshold, and a `<pre>` table of subjects: name, attended/conducted, current percentage, and when the portal last saw it.
- **Mid-marks** — a `<pre>` table with subject, type (Subject or Lab), M1, M2, and average columns.
- **Bunk plan** — how many classes can be skipped or must be attended to hold a 75% target, per subject and overall, computed as `floor(att/0.75 - cond)` for skippable classes and `ceil((0.75*cond - att)/0.25)` for recovery classes, plus a list of subjects below 75%.

Every user-controlled string goes through `escapeHtml` in `src/services/text.ts`, the single escaper shared with the report threads, `/start` and the library watermark. Text is padded before it is escaped, so an entity never counts towards a column. Subject names are truncated to fit the monospace tables (`truncateText`), and dates in `DD-MM-YYYY` are shortened to `DD-MM` (`formatLastUpdated`). The warnings below 75% are produced once by `belowTargetLine`, used by both the attendance and the bunk reply.

## Related pages

- [Bot Commands and Authorization](commands-and-authorization.md)
- [Registration and Profile](../registration.md)
- [College Portal Scraping](../portal/scraping.md)
- [Caching and Leaderboard Stats](../data/caching-and-stats.md)
