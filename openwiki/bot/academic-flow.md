---
type: workflow
title: Academic Data Flow
description: End-to-end trace of a roll-number lookup — validation, rate limiting, authorization, inline keyboard callbacks, the placeholder-then-edit reply pattern, and the student.service to AcademicTG to Academic chain that formats attendance, mid-marks, and bunk plans.
tags: [telegram, workflow, attendance, midmarks, callbacks]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-09T23:13:13.880Z
sources:
  - id: openwiki-source-04d02aea694a5ea720fe8290
    resource: repo://src/bot/academics/academicHandler.ts
  - id: openwiki-source-b454a8130fe1b59fd2ff52ab
    resource: repo://src/bot/academics/studentActions.ts
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
generated: { by: "opencode", at: "2026-10-09T23:13:13.880Z" }
---

# Academic Data Flow

This page traces the primary user journey: a student sends their roll number, taps an inline button, and receives formatted attendance, mid-marks, or a bunk plan. The entry point is `src/bot/academics/academicHandler.ts`; the service chain below it is `student.service` → `AcademicTG` → `Academic`. Registered users can skip the roll step with `/attendance`, `/midmarks`, and `/bunk` (see [Registration and Profile](../registration.md)); both paths converge on the same `studentActions` flow.

## Roll-number message handling

`bot.onText(ROLL_REGEX, …)` (`src/bot/academics/academicHandler.ts:183-197`) routes every text message matching the roll-number pattern. In the chit-chat group the message is deleted and a self-deleting notice is sent instead (`handleChitChatRoll`, `src/bot/academics/academicHandler.ts:167-181`). Otherwise `handleRollNumberMessage` (`src/bot/academics/academicHandler.ts:123-164`) runs in this order:

1. **Persist the userId→roll mapping** — `persistRollMapping` fire-and-forgets an upsert into `tgusers` (used later by "You are #N" on the web leaderboard); failures are swallowed.
2. **Rate limit** — `botSecurityHandler(userId, "roll_number")` allows 10 requests per user per minute; over the limit the user gets a "Too many requests!" message (`src/middleware/security.ts`).
3. **Validate format** — `isValidRollNumber` applies `ROLL_REGEX` (`/^\d{2}[a-zA-Z0-9]{2}[a-zA-Z0-9]{6}$/`) from `src/constants/index.ts`, shared between the bot and the API's security middleware. Invalid input gets a format warning and stops.
4. **Authorize** — `isAuthorizedUser(userId, chatId)`; on failure it has already sent the appropriate prompt (join channel or daily check-in) and the handler returns.
5. **Track** — `trackActivity` records a `roll_lookup` action with the roll number as detail.
6. **Reply with options** — `sendRollOptions` sends an inline keyboard with `Attendance 🚀`, `Mid Marks 📊`, `Bunk Plan 🎯`, and a leaderboard URL button (`src/bot/academics/academicHandler.ts:101-121`).

The top-level `.catch` on the roll handler now also replies to the user with "Something went wrong on my side. Please try again in a moment." before logging, so an unexpected failure is never silent (`src/bot/academics/academicHandler.ts:188-196`).

Rate limiting also applies to callback taps with the `callback` action key, and the roll format is re-validated before each action runs.

## Callback dispatch

Callback data uses prefixes `att_`, `mid_`, and `bunk_` followed by the roll number. The shared `callback_query` listener (`src/bot/academics/academicHandler.ts:210-222`) wraps the whole handler in a try/catch: on an unexpected throw it logs the error and answers the callback with a "Something went wrong" alert, so a tap can never hang unanswered. The inner `handleCallbackQuery` (`src/bot/academics/academicHandler.ts:224-291`):

1. Skips the `dailycheck` callback, which is fully owned by `dailyCheckIn.ts` (otherwise it would be rate-limited and its pinned channel post deleted).
2. Answers chit-chat callbacks with an alert and returns.
3. Rate-limits, then authorizes the actor (`callbackQuery.from.id` — in channels `msg.from` is the channel itself, so the actor always comes from the callback).
4. Tracks the action (`attendance`, `midmarks`, or `bunk`) with the roll detail.
5. Runs three tasks concurrently with `Promise.allSettled`: delete the menu message, run `handleCallbackAction`, and answer the callback query. Rejected steps are logged individually.

`handleCallbackAction` (`src/bot/academics/academicHandler.ts:293-325`) slices the roll from the callback data, re-validates it, and dispatches to `sendAttendanceOrMidMarks` or `sendBunkPlan`.

## Authorization degradation

`isAuthorizedUser` (`src/bot/academics/academicHandler.ts:40-90`) degrades instead of locking users out when Redis is down: the cached-membership read is wrapped and returns false on error, and a throwing live membership check is treated as "allow" (the daily check-in gate still applies below). See [Bot Commands and Authorization](commands-and-authorization.md) for the full gate order.

## Placeholder-then-edit UX

`fetchAndEdit` in `src/bot/academics/studentActions.ts` is the shared flow for all three actions:

1. Send a placeholder message in `<code>` tags ("Getting attendance...", "Getting mid marks...", or "Working out your bunk plan..."), with notifications disabled.
2. Await the real content, then edit the placeholder in place. A failed edit is only warned about, since the content was already fetched.
3. If fetching throws, send the error's message to the chat as a new message; a bare error falls back to "An unexpected error occurred."

Because `AcademicTG` methods return user-facing strings even for errors (below), the edit path — not the catch path — is what users normally see on scrape failures.

## Service chain: student.service → AcademicTG → Academic

`src/services/student.service.ts` exposes three thin helpers — `getAttendance`, `getMidMarks`, `getBunkPlan` — each constructing an `AcademicTG` for the roll number and calling the matching message method.

`AcademicTG` (`src/services/student.utils/AcademicTG.ts`) is the presentation layer:

- `getAttendanceMessage`, `getMidmarksMessage`, and `getBunkPlanMessage` wrap `getAttendanceJSON` / `getMidmarksJSON` in try/catch.
- On success they delegate to `formatAttendanceMessage`, `formatMidmarksMessage`, or `formatBunkPlanMessage` in `formatters.ts`.
- On failure `formatErrorMessage` maps error types to message builders: `ServerDownError`, `NoDataFoundError`, `StudentNotFoundError` (which includes nearby-roll suggestions), `BlockedReportError`, other `AcademicError`s, and a generic unknown-error fallback. All timestamps are rendered in `Asia/Kolkata`.

`Academic` (base class, `src/services/student.utils/Academic.ts`) owns the portal fetch, Redis JSON cache, fallback response cache, and parsing. Its details — session renewal, retry, blocked-report detection, and the typed error hierarchy — are covered in [College Portal Scraping](../portal/scraping.md). Cache keys and TTLs are covered in [Caching and Leaderboard Stats](../data/caching-and-stats.md).

## Formatting outputs

The formatters in `src/services/student.utils/formatters.ts` produce Telegram HTML (they no longer take an `isCached` flag — that parameter was removed along with its never-used branch):

- **Attendance** — header with roll, branch string (`{year}_{branch name}_{section}`), attended/conducted totals, percentage, a 10-block progress bar colored by threshold, and a `<pre>` table of subjects with a status emoji, attended/conducted, and last-updated date.
- **Mid-marks** — a `<pre>` table with subject, type (Subject or Lab), M1, M2, and average columns.
- **Bunk plan** — how many classes can be skipped or must be attended to hold a 75% target, per subject and overall, computed as `floor(att/0.75 - cond)` for skippable classes and `ceil((0.75*cond - att)/0.25)` for recovery classes, plus a list of subjects below 75%.

Subject names are truncated to fit the monospace tables (`truncateText`), and dates in `DD-MM-YYYY` are shortened to `DD-MM` (`formatLastUpdated`).

## Related pages

- [Bot Commands and Authorization](commands-and-authorization.md)
- [Registration and Profile](../registration.md)
- [College Portal Scraping](../portal/scraping.md)
- [Caching and Leaderboard Stats](../data/caching-and-stats.md)
