# NbkristQik action plan

**Date:** 8 November 2026  
**Source:** the UX / performance / efficiency critique of 7 November 2026.  
**Scope:** one maintainer, one production process, no design-system rewrite.  
**Rule:** one task = one commit or PR. Do not deploy a dirty tree.

This plan is ordered by leverage, not by how easy it is to talk about. Phase 1
makes the product feel right. Phase 2 makes the numbers honest about being
partial. Phase 3 makes the app answer the student's actual question. Phase 4
contains product decisions that should not be coded before the owner chooses.

The plan deliberately does **not** optimize `/syncdb` or backfill the whole
college. That work is too long and too intensive. The leaderboard is a rolling
register that fills as students look themselves up; the product must say so
plainly, not pretend the sample is a census.

## Implementation status — 8 November 2026

**Shipped**

- P1-01/02/07: the bot answers a roll with the attendance card, keeps the
  action buttons on the card, saves a roll from the card, and makes suggested
  rolls tappable.
- P1-03/04/06: the web search no longer 400s on one character and keeps the
  current rows while refreshing; the year filter uses the year digit, so
  semester 2 works; the resolved-thread poll stops on resolve/hidden.
- P1-05: identity is the registration, never the last lookup; the profile form
  starts empty and offers the lookup as a suggestion; the first screen has
  explicit checking/no-roll/error states, never a "Not signed in" flash.
- P1-08: `Vary`/private cache headers; report bodies keep the student's words
  (output escaping, not input stripping).
- P2-02/03/04: one parse per section, one DB batch, one Redis fan-out, one
  in-flight portal request, one login on session expiry.
- P2-07/08/10/11/12: per-metric timestamps and semester expiry; leaderboard
  scope/coverage/freshness range; validated fallback with age; synthetic
  lookup canary; per-account rate limits with an IP backstop.
- P3-01/02/03: structured `/api/me/academics`; My Attendance is the first
  screen; one shared `/api/me` per app open.
- P3-04/05/09: deferred/versioned SDK, split reader/leaderboard/issues chunks,
  memoized rows and hoisted formatters.
- P3-06/07/08: library context cached per session, private page cache, read
  dedupe, session reuse.
- P4-04: group lookups answer by private deep link; no card in the group.

**Deferred / open**

- P0-01: the tree is still uncommitted. Commit before the next deploy.
- P0-02: bundle sizes were measured; production lookup timings still need a
  live measurement.
- P2-01: parser tests use the full fixture; one real masked portal response
  still needs an operator capture.
- P3-09: the reader page-list rebuild was left unchanged; it needs a
  per-page subscription, not a safe in-file tweak.
- P3-10: the 50 s warm loop is disabled when the embedded database is in use;
  the 60 s Redis page cache remains. Measure the embedded query before
  removing that cache.
- P4-01/02/03: the channel gate, leaderboard names/consent, and library
  fate are product decisions and were not changed.
- Roll ownership: saving a roll is unverified and several accounts may share
  one. The college email OTP that fixes it is planned in
  [`ROADMAP.md`](ROADMAP.md).
- P4-05: the canary row and "Answers" label are live; the full Overview
  p50/p95/coverage panel is not built.

**Verification**

| Check | Result |
|---|---|
| Root typecheck + test typecheck | clean |
| Root ESLint | clean |
| Root Vitest | 63 files / 489 tests pass |
| Web Vitest | 12 files / 84 tests pass |
| Web build | pass |
| App entry JS | 252.73 kB / 79.49 kB gzip (was 292.16 / 90.75) |
| Reader/leaderboard/issues chunks | 16.9 / 17.7 / 10.0 kB raw |

---

## 0. Outcome metrics

Record the "before" numbers in Phase 0, then re-record after each phase.

| Metric | Target |
|---|---|
| Bot: roll message to attendance card, warm cache | p95 < 300 ms |
| Bot: roll message to attendance card, cold portal | p95 < 3 s |
| App: first screen shows the student's own attendance, warm | < 1 s |
| App: `/api/me` calls per app open | 1 |
| App: flashes of "Not signed in" for a registered user | 0 |
| Leaderboard: view is the student's own section by default | yes |
| Leaderboard: rows from a previous semester | 0 |
| Leaderboard: coverage is printed | ranked / known, or ranked + "fills over time" |
| Leaderboard: freshness shows a range when partial | newest–oldest |
| Leaderboard: year filter works in semester 1 and 2 | yes |
| Portal requests per cold section lookup | 1 |
| Section lookup: `cheerio.load` calls | 1 |
| Section lookup: DB statements per student | 0 (one batch) |
| Reader: context resolutions per session per minute | 1 |
| Reader: DB read rows per page | 0–1 (deduped) |
| Status page: canary detects a parser break | yes, within 5 min |
| One student on campus NAT can exhaust the API limit for others | no |

---

## 1. The board

| ID | Task | Phase | Effort | Impact | Depends on |
|---|---|---|---|---|---|
| P0-01 | Commit/confirm the current tree; run the full verify | 0 | 0.5 d | Safety | — |
| P0-02 | Record baseline timings and request counts | 0 | 0.5 d | Direction | — |
| P0-03 | Add failing tests for the known bugs | 0 | 0.5 d | Safety | — |
| P1-01 | Roll message returns the attendance card, not a menu | 1 | 1 d | Very high | P0-03 |
| P1-02 | "Save this roll" on the card | 1 | 0.5 d | High | P1-01 |
| P1-03 | Search guard and keep the sheet while searching | 1 | 0.5 d | High | P0-03 |
| P1-04 | Year filter works in both semesters | 1 | 0.5 d | High | P0-03 |
| P1-05 | Identity is registration, not last lookup | 1 | 1 d | High | P0-03 |
| P1-06 | Thread poll stops when resolved/hidden | 1 | 0.25 d | Medium | — |
| P1-07 | Suggested rolls are actually tappable | 1 | 0.25 d | Medium | P1-01 |
| P1-08 | Cache headers and report body fidelity | 1 | 0.5 d | Medium | — |
| P2-01 | Spike: inspect a real lookup response | 2 | 0.5 d | Gates P2-02 | P0-01 |
| P2-02 | Parse a section once, not once per student | 2 | 1.5 d | High | P2-01 |
| P2-03 | Batch stat and cache writes | 2 | 1 d | High | P2-02 |
| P2-04 | Single-flight section fetch and login mutex | 2 | 1 d | High | P2-02 |
| P2-07 | Per-metric timestamps and semester key | 2 | 1.5 d | Very high | P2-03 |
| P2-08 | Leaderboard scope, coverage and honest copy | 2 | 1.5 d | Very high | P2-07 |
| P2-09 | Define the mid-mark metric, or scope it | 2 | 0.5 d | High | decision |
| P2-10 | Validate before caching; show fallback age | 2 | 1 d | High | P2-07 |
| P2-11 | Synthetic lookup canary and answer health | 2 | 1.5 d | High | P2-01 |
| P2-12 | Per-user rate limits, not per-IP | 2 | 1 d | High | — |
| P3-01 | `GET /api/me/academics` structured endpoint | 3 | 1 d | Very high | P1-05 |
| P3-02 | "My attendance" is the first screen | 3 | 2.5 d | Very high | P3-01 |
| P3-03 | One shared identity provider; one `/api/me` | 3 | 1 d | High | P1-05 |
| P3-04 | Defer and version the Telegram SDK | 3 | 0.5 d | High | — |
| P3-05 | Split the reader and issue desk out of the entry chunk | 3 | 0.5 d | High | P3-02 |
| P3-06 | Resolve library context once per session | 3 | 1.5 d | Medium | — |
| P3-07 | Page cache policy and read dedupe | 3 | 1.5 d | Medium | P3-06 |
| P3-08 | Reuse a valid library session across tab visits | 3 | 0.5 d | Medium | — |
| P3-09 | Memoize rows; stop rebuilding the reader page list | 3 | 0.5 d | Medium | — |
| P3-10 | Remove the warm loop/page cache if embedded is fast | 3 | 0.5 d | Medium | P0-02 |
| P4-01 | Decide the channel gate | 4 | decision | High | P1-01 |
| P4-02 | Decide leaderboard names and consent | 4 | decision | Very high | P2-08 |
| P4-03 | Decide the library: fill it or kill it | 4 | decision | High | P3-07 |
| P4-04 | Group answers are private by default | 4 | 1 d | High | P1-01 |
| P4-05 | Admin "core loop" health panel | 4 | 1.5 d | Medium | P2-11 |

---

## 2. Phase 0 — Baseline and safety (1.5 days)

### P0-01 — Commit or confirm the current tree, then verify

**Why:** the deploy guard refuses a dirty tree; `ALLOW_DIRTY_DEPLOY=1` would
ship unreviewed changes. The tree currently has modified handlers, a deleted
daily check-in, and updated tests.

**Steps**
1. Review `git status` and the diff for `src/bot/`, `src/api/admin/`,
   `PRODUCT.md` and `README.md`.
2. Commit the remediation tree, or explicitly stash it and record why.
3. Run:
   ```bash
   pnpm run typecheck
   pnpm run typecheck:tests
   pnpm run lint
   pnpm exec vitest run
   pnpm --dir src/web run test
   pnpm --dir src/web run build
   ```

**Done when**
- [ ] `git status --short` is empty, or the remaining changes are intentional.
- [ ] All commands above pass.
- [ ] The built `/library/` HTML references hashed assets and opens locally.

**Do not** deploy during this task.

---

### P0-02 — Record the baseline

**Why:** you cannot tell whether P2/P3 helped without numbers.

**Steps**
1. Time one warm and one cold `/attendance` lookup; note cache state.
2. Count portal requests for one cold lookup (API logs or a temporary counter).
3. Time `/api/leaderboard?page=1&limit=20` on the embedded DB and on a filtered
   section.
4. Count HTTP requests on one app open: index, then Ranks, then a filter.
5. Measure the built bundle sizes and the SDK transfer.
6. Write the numbers in a short `docs/METRICS.md` (or the bottom of this file).

**Done when**
- [ ] Before numbers exist for every row in the metrics table.
- [ ] The measurement method is written down.

---

### P0-03 — Write the failing tests first

**Why:** each fix below is a behavior change; a test makes it stay fixed.

**Tests to add**
- `tests/unit/leaderboardYear.test.ts`: a `studentsnew` row with `year=12`
  matches the year-1 filter; `year=11` also matches; `year=21` does not.
- `tests/integration/apiRoutes.test.ts`: `/api/leaderboard?search=a` does not
  return a 400 (or the client never sends it; the server behavior is decided in
  P1-03).
- `tests/unit/identity.test.ts`: a lookup by user A for roll R does not make
  `/api/me` return R when A has no registration.
- `tests/unit/attendanceCard.test.ts`: a roll message produces a card with
  attendance/mid/bunk buttons and does not produce a "What do you want to
  check?" menu.
- `tests/unit/threadPoll.test.ts`: no interval fires for a resolved thread
  (fake timers).

**Done when**
- [ ] Each test fails for the expected reason before its fix.
- [ ] Each test passes after its fix.

---

## 3. Phase 1 — Make the product feel right (4–5 days)

### P1-01 — A roll message returns the attendance card, not a menu

**Why:** the current flow is roll → menu → tap → placeholder → card, and the
menu is deleted, so the card has no next action. The product's main question
deserves the first screen.

**Files**
- `src/bot/academics/academicHandler.ts`
- `src/bot/academics/studentActions.ts`
- `src/bot/commands/registered.ts` (shared card markup)
- `tests/unit/academic.test.ts`, `tests/unit/attendanceCard.test.ts`

**Steps**
1. Add a `cardMarkup({ roll, isPrivate, showSave })` helper. Rows:
   `[Attendance, Mid marks, Bunk]` then `[Save this roll, Leaderboard]`.
   Use the existing `att_`, `mid_`, `bunk_` callback prefixes.
2. In `handleRollNumberMessage`, call `sendAttendanceOrMidMarks` directly with
   the roll and the student message. Remove `sendRollOptions` and the
   "What do you want to check?" message. Pass `msg.message_id` as the reply
   target so the card replies to the roll.
3. Extend `fetchAndEdit` to accept `{ replyMarkup, editMessageId,
   replyToMessageId }`. Pass the markup to both `sendMessage` (placeholder) and
   `editMessageText` (final card). Keep the buttons on the final card.
4. Extend `CallbackAction.run` to receive the callback message id. In
   `handleCallbackQuery`, do not delete the card. Edit that message in place:
   the card becomes "Getting ..." and then the new card. Keep
   `answerCallbackQuery`.
5. Keep the existing plain-text fallback when Telegram rejects the HTML; it
   should still carry the action buttons.

**Done when**
- [ ] Sending a roll yields the attendance card immediately.
- [ ] The card has Attendance, Mid marks, Bunk, Save, Leaderboard.
- [ ] Tapping Mid marks edits the same card; no message is deleted.
- [ ] A callback for a different roll still validates the roll.
- [ ] Tests cover the markup and the edit-in-place path.

**Watch out:** `editMessageText` rejects if the text is unchanged. If the
student taps the same action twice, send a short "That is already on screen"
answer or re-send the card; do not throw.

---

### P1-02 — "Save this roll" on the card

**Why:** a student who types their roll every day is never told that
`/register` exists. This is the missing retention loop.

**Files**
- `src/bot/academics/academicHandler.ts`
- `src/db/registration.model.ts`
- `tests/unit/registration.test.ts`

**Steps**
1. Add a `save_<roll>` callback. On tap:
   - If the user already has this roll, answer "Saved already" and hide the
     button next time.
   - Otherwise call `upsertRegistration(userId, roll, null)`.
   - On `RollAlreadyRegisteredError`, answer with the existing 409 copy; never
     reveal which account holds it.
2. After saving, edit the card to add a short "Saved. /attendance answers in
   one tap now." line or answer via `answerCallbackQuery` with a toast.
3. Hide the Save button when `getRegistration(userId).roll_no === roll`.
4. Do not auto-register without the tap.

**Done when**
- [ ] Tapping Save makes `/attendance` work immediately.
- [ ] A second tap is idempotent.
- [ ] A roll held by another account shows the same 409 copy as the web form.
- [ ] The button is hidden for an already-registered user.

---

### P1-03 — Search guard and keep the sheet while searching

**Why:** one character triggers a 400; the hook throws away the server's
message and shows "The register didn't open". Every filter change also clears
the list.

**Files**
- `src/web/src/Leaderboard.tsx`
- `src/web/src/useLeaderboard.ts`
- `src/web/src/components/SearchBar.tsx`
- `src/middleware/security.ts`
- `src/api/server.ts`
- `tests/integration/apiRoutes.test.ts`, `src/web/tests/`

**Steps**
1. In `Leaderboard`, do not set `search` for a one-character trimmed input.
   Show a hint under the field: "Type at least 2 characters."
2. In `useLeaderboard`, on a query change:
   - If `stats.length === 0`, show skeletons.
   - Otherwise keep the existing rows and set a `refreshing` flag; dim the list
     slightly, do not clear it.
3. Surface the server's error text instead of `new Error("API error")`; use
   `readJson`/`RequestError`.
4. Server: decide whether a one-character `search` is treated as absent or as a
   400. Recommended: treat it as absent (no filter) and keep the 2-character
   rule only for meaningful searches. Update the validator and tests.
5. Ensure the empty state for an anonymous caller says "Try a roll number", not
   "or part of a name".

**Done when**
- [ ] Typing one character never shows the error state.
- [ ] A new search keeps the previous rows on screen until the new page lands.
- [ ] A real server error is shown verbatim (or a safe paraphrase).
- [ ] Anonymous copy does not promise name search.

---

### P1-04 — The year filter works in both semesters

**Why:** `studentsnew.year` stores `11`…`42`; the UI offers `11/21/31/41` and
the SQL compares the full code. In semester 2, every year filter is empty.

**Files**
- `src/db/student_stats.model.ts`
- `src/api/server.ts` (validation)
- `src/web/src/components/FilterBar.tsx`
- `src/web/src/api.ts`
- `tests/unit/leaderboardYear.test.ts`

**Steps**
1. Change the UI year values to `1`, `2`, `3`, `4` (or keep the labels but send
   the digit).
2. In `buildLeaderboardWhere`, filter on the first digit:
   `SUBSTR(s.year, 1, 1) = ?`. Do the same in `getLeaderboardFacets`.
3. Update the query validator to accept `1`–`4` (and keep `all`).
4. Add a test with rows for `11` and `12`; both match year `1`.
5. Keep the existing `All Years` default.

**Done when**
- [ ] Year 1 returns students from both `11` and `12`, whichever is present.
- [ ] The section facets match the chosen year.
- [ ] A `?year=12` legacy URL still works (map it to `1`), or returns a clear
  400, not an empty page.

---

### P1-05 — Identity is registration, not last lookup

**Why:** checking a friend's attendance makes the app say "Reading as" the
friend, shows the friend's rank, and pre-fills the registration form with the
friend's roll.

**Files**
- `src/bot/academics/academicHandler.ts`
- `src/api/server.ts` (`/api/me`)
- `src/api/profile.ts`
- `src/web/src/useTelegramUser.ts`
- `src/web/src/AppShell.tsx`
- `src/web/src/views/Profile.tsx`
- `tests/unit/identity.test.ts`

**Steps**
1. Stop calling `persistRollMapping` on every lookup, or rename it to
   `persistLastLookup` and never use it as identity.
2. `/api/me` returns the registration only. If there is no registration,
   return `{ found: false, lastLookup: <roll | null> }`; do not call it
   `roll_no`.
3. The profile GET returns `lastLookup` as a separate suggestion; the form
   starts empty. A suggestion chip says "Last looked up: X — use this?" and
   fills only on tap.
4. Add `POST /api/me/forget-lookup` (or a clear action) so a student can remove
   a friend's roll from their session.
5. In the app, replace "Not signed in" with three states:
   - loading: "Checking your roll..."
   - no roll: "No roll saved" + a button to Profile
   - saved: "Reading as <roll>"
6. If `/api/me` fails, show "Couldn't check your roll" with Retry; do not fall
   back to "No roll saved".

**Done when**
- [ ] A lookup by A for B does not change A's `/api/me` `roll_no`.
- [ ] The profile form is empty for an unregistered user.
- [ ] A registered user's own roll is unaffected by looking up a friend.
- [ ] The index has loading, no-roll, saved, and error states.

---

### P1-06 — Stop the thread poll when it cannot change

**Why:** the report thread polls every 8 seconds while visible, including after
the issue is resolved, and can stack requests on a slow line.

**Files**
- `src/web/src/views/ReportThread.tsx`
- `src/web/tests/`

**Steps**
1. Keep the interval only while `thread?.status !== "resolved"`.
2. Skip when `document.visibilityState !== "visible"`.
3. Add an in-flight guard so a second poll cannot start before the first
   finishes.
4. Abort the in-flight fetch on unmount (pass an `AbortSignal` to
   `fetchThread`).
5. Add a fake-timer test: no tick after resolution.

**Done when**
- [ ] No request 8 seconds after a resolved thread is on screen.
- [ ] No overlapping polls.
- [ ] Navigating away aborts the request.

---

### P1-07 — Suggested rolls are actually tappable

**Why:** the message says "tap one to try it" and lists `<code>` lines with no
keyboard. The copy promises an interaction that does not exist.

**Files**
- `src/services/student.utils/errorMessages.ts`
- `src/services/student.utils/AcademicTG.ts`
- `src/bot/academics/studentActions.ts`
- tests

**Steps**
1. Make `buildStudentNotFoundMessage` return
   `{ text, markup }` or have `AcademicTG` build the inline keyboard for
   `suggestions`.
2. Each suggestion is a callback `att_<roll>` (or a new `try_<roll>` that runs
   attendance). The existing `isValidRollNumber` guard still applies.
3. Alternatively, change the copy to "send one of these" and keep it text-only.
   Do not ship the current "tap" wording without buttons.

**Done when**
- [ ] Every suggested roll can be checked with one tap.
- [ ] An invalid/mutated callback is rejected.
- [ ] The copy matches the affordance.

---

### P1-08 — Cache headers and report body fidelity

**Files**
- `src/api/server.ts`
- `src/middleware/security.ts`
- `src/api/report.ts`
- tests

**Steps**
1. `/api/leaderboard` (identified and anonymous): add
   `Vary: X-Telegram-Init-Data`. Keep `private`/`public` as appropriate.
2. `/api/me`, `/api/profile`, `/api/myreports`: `Cache-Control: private,
   no-store` (or `private, max-age=0, must-revalidate`).
3. Stop stripping `<` and `>` from report bodies and display names in
   `sanitizeInput`. React escapes on render and Telegram uses `escapeHtml`;
   store the student's words.
   - Keep the structural protections (parameterized SQL, output escaping).
   - Add a test: a report containing `<div>` comes back with `<div>`.
4. Keep the admin panel's separate body handling.

**Done when**
- [ ] A bug report can include HTML without being mangled.
- [ ] A shared cache cannot serve an identified leaderboard page to an
   anonymous caller.
- [ ] `/api/me` is not heuristically cached.

---

## 4. Phase 2 — Make the numbers honest (8–10 days)

**Out of scope:** `/syncdb` and any bulk backfill. It is too long and too
intensive for this plan. The leaderboard is a register that fills as students
look themselves up. The plan does not pretend it is a complete college census.
It optimizes the lookup path, expires the previous semester, and prints
coverage so the partial view is honest.

The old P2-05 (seed names from the sync) and P2-06 (seed stats from the sync)
are deliberately removed. Their IDs are left as gaps so references elsewhere
stay stable.

### P2-01 — Spike: inspect one real lookup response

**Why:** P2-02 depends on the exact columns of the attendance report the bot
already receives on a lookup. Do not guess.

**Steps**
1. Capture one real `attendanceTillTodayReport.php` response for a section the
   bot can reach (mask names/rolls in the committed fixture; keep the
   structure).
2. Record: which cell holds the percentage, which row holds the subject names,
   how conducted counts are laid out, and whether names are present.
3. Save a masked fixture as `tests/mocks/portal-section.html`.
4. Write a short note in `docs/DATABASE.md` or `docs/ARCHITECTURE.md` about the
   columns.

**Done when**
- [ ] The fixture has the full row shape.
- [ ] A parser test asserts the percentage and subject count for at least two
  students.
- [ ] The lookup path is tested against a realistic response, not a two-row
  synthetic fixture.

---

### P2-02 — Parse a section once

**Why:** `storeAttendanceToRedis` and `storeMidMarksToRedis` parse the same HTML
once per roll and look up each student. A 60-student section is 60 full DOM
parses and 60 student lookups for one page.

**Files**
- `src/services/student.utils/parsers.ts`
- `src/services/redis/storeAttOrMidToRedis.ts`
- `src/services/student.utils/Academic.ts`
- tests

**Steps**
1. Add `parseAttendanceSection(doc, context): Map<roll, Attendance>` and
   `parseMidmarksSection(doc, context): Map<roll, Midmarks>`, where `context`
   is `{ yearSem, branch, section }` from the request.
2. Implement them with one `cheerio.load` and one pass over the rows/columns.
   Build `year_branch_section` from the context, not from a per-row student
   lookup.
3. Keep `parseAttendanceResponse(doc, roll)` as a thin wrapper over the map for
   compatibility, but make the requester path use the map.
4. In `storeAttendanceToRedis`/`storeMidMarksToRedis`, call the section parser
   once. Do not call `getStudentCached` per row: the section context is known
   from the request, and the report carries the name if P2-01 says so. Pass the
   `{ yearSem, branch, section }` context into the store functions from
   `getAttendanceJSON`/`getMidmarksJSON`, which already have the student.
5. Instrument a test-only counter or assert with a `vi.mock` that
   `cheerio.load` is called once.

**Done when**
- [ ] A 60-row fixture produces the same per-student objects as before.
- [ ] One `cheerio.load` per section.
- [ ] No `getStudentCached` calls inside the section parse loop.
- [ ] A missing student row is skipped, not fatal.

---

### P2-03 — Batch stat and cache writes

**Why:** one `turso.execute` per student and one `SET` per student. On the old
remote DB this was N round trips; on embedded it is still N transactions.

**Files**
- `src/db/student_stats.model.ts`
- `src/services/redis/storeAttOrMidToRedis.ts`
- tests

**Steps**
1. Add `updateAttendanceStats(rows: {roll, value, yearSem}[])` and
   `updateMidMarkStats(rows)` using `turso.batch(..., "write")`.
2. Keep the single-row functions for the API/bot paths that need them.
3. In `persistSectionWrites`, use the batch writer and a Redis pipeline
   (or `Promise.all` over a single client with pipelining) instead of N awaits.
4. Log and continue when the cache write fails; the DB batch is the durable
   output. Do not let a Redis failure veto the stats.
5. Test with Redis stopped: one batch still lands, one warning is logged.

**Done when**
- [ ] One DB batch per section.
- [ ] One Redis pipeline per section.
- [ ] A single bad row does not silently drop the rest (log the roll).
- [ ] `student_stats` is still written when Redis is down.

---

### P2-04 — Single-flight section fetch and login mutex

**Why:** two students in the same section make two portal requests, two parse
sets, two write sets. An expired cookie makes concurrent requests each mint a
new session and invalidate the others.

**Files**
- `src/services/student.utils/Academic.ts`
- `src/services/student.utils/portalSession.ts`
- tests

**Steps**
1. Add a module-level `Map<string, Promise<string>>` keyed by
   `${yearSem}:${branch}:${section}:${command}`.
2. The first caller performs the fetch; others await the same promise.
   Delete the entry in `finally`. Do not cache errors for longer than the
   caller's request.
3. Add a `renewSession` in-flight promise: all concurrent callers await the same
   login. Delete it in `finally`.
4. Add a test that starts two lookups for the same section and asserts one
   axios POST for attendance and one login.
5. Keep the per-roll JSON cache as the fast path.

**Done when**
- [ ] Two concurrent cold lookups in one section make one portal request.
- [ ] One expired session causes one login, not N.
- [ ] A failed fetch does not poison the single-flight map.

---

### P2-07 — Per-metric timestamps and a semester key

**Why:** `last_updated` is one column for attendance and mid-marks; `MAX` over
it makes the whole register look fresh after one lookup. `student_stats` also
has no semester, so when the portal switches semesters a row that has not been
looked up yet keeps serving the old percentage. Data fills over time, so old
rows must expire without a bulk sync.

**Files**
- `src/db/init.ts` (schema version 2)
- `src/db/student_stats.model.ts`
- `src/services/redis/storeAttOrMidToRedis.ts`
- `src/api/server.ts`
- tests

**Steps**
1. Bump `SCHEMA_VERSION` to 2.
2. Add columns with `ALTER TABLE ... ADD COLUMN` guarded by
   `schemaVersion < 2` and a `PRAGMA table_info` check:
   - `attendance_updated_at TEXT`
   - `midmarks_updated_at TEXT`
   - `year_sem TEXT`
3. Backfill:
   - attendance timestamp = `last_updated` where attendance is not null
   - midmarks timestamp = `last_updated` where midmarks is not null
   - `year_sem` from `studentsnew.year` for the roll
4. `updateAttendanceStat(roll, percentage, yearSem)` writes
   `attendance_updated_at = datetime('now')` and `year_sem`.
   `updateMidMarkStat(roll, average, yearSem)` writes
   `midmarks_updated_at = datetime('now')` and `year_sem`.
5. `getLastSyncAt(sortBy)` returns `{ newest, oldest }` from `MAX`/`MIN` of
   the relevant column. A partial register has a range, not one timestamp; the
   UI must be able to say "newest 2 min ago, oldest 6 days ago".
6. `getLeaderboard` and `getStudentRank` add `AND st.year_sem = s.year` so a
   previous semester's row is not ranked. This is the no-sync expiry: a row
   that has not been refreshed in the new semester disappears from the view
   until that student is looked up again. If `year_sem` is null after the
   backfill, exclude it and log.
7. Update the callers (`Academic`, `storeAttOrMidToRedis`, tests). Do not
   touch `/syncdb`.
8. Add tests: attendance and midmarks ages differ; a `12` row does not appear
   for a `11` student; an old row is excluded until refreshed; the migration is
   idempotent.

**Done when**
- [ ] The register shows "Attendance as of ..." and "Mid-marks as of ..."
  separately.
- [ ] A row from last semester is not in the current leaderboard.
- [ ] A fresh boot against an old DB migrates once and is idempotent.
- [ ] `PRAGMA user_version` is 2.

**Rollback:** keep the v1 backup. The new columns are additive; an older build
ignores them, but it will not filter the semester. Do not run an older build
against a v2 DB after the cutover.

---

### P2-08 — Leaderboard scope, coverage, and honest copy

**Why:** the default is all years/branches, which is the least relevant and
most shaming view; `total` is "seen students", not the college; the end note
says "That's everyone".

**Files**
- `src/api/server.ts`
- `src/db/student_stats.model.ts`
- `src/web/src/api.ts`
- `src/web/src/Leaderboard.tsx`
- `src/web/src/components/FeedbackStates.tsx`
- tests

**Steps**
1. Add `scope=me` (default for an authenticated caller with a saved roll) to
   `/api/leaderboard`. The server resolves the caller's registration, reads
   their `studentsnew` row, and applies year/branch/section filters unless the
   client explicitly sets a filter or `scope=all`. An unregistered caller falls
   back to `scope=all` and the UI shows "Save your roll to see your section".
2. Return `scope: { year, branch, section }`, `coverage: { ranked, known }`,
   and `freshness: { newest, oldest }` in the page-1 payload. `known` is
   `COUNT(*)` of `studentsnew` matching the same filters; label it "known
   students", not "all students", because the directory itself may be a little
   stale. Keep `updated_at = newest` for one release so older clients do not
   break.
3. The UI starts on "My section" with a visible chip; "All" is a deliberate
   choice. The filter bar can override.
4. Show "412 of 1,240 known students seen in CSE 3A" near the freshness line,
   plus a quiet "This register fills as students check." When `known` is 0,
   show "412 ranked so far" without a denominator. The band stamp can show the
   ranked total.
5. Show the age range when it is wide: "Updated 2 min to 6 days ago" instead of
   "Synced just now". If `newest` and `oldest` are within an hour, keep the
   existing "Synced X min ago" copy.
6. `EndNote` says "That's everyone in this view" only when `ranked >= known`
   and `known > 0`; otherwise "412 ranked so far. The register fills as
   students check." Never imply that `ranked` is the whole college.
7. Add tests for scope resolution, coverage, freshness range, and the end-note
   condition.

**Done when**
- [ ] A registered student lands on their own section, not the whole college.
- [ ] Coverage is always visible when the set is partial.
- [ ] A wide age range is visible; one fresh row cannot make the whole register
  look fresh.
- [ ] The end note never claims completeness it cannot prove.
- [ ] `scope=all` still works.

---

### P2-09 — Define the mid-mark metric, or scope it

**Why:** the current number averages M1/M2 across subjects, includes labs,
divides by a filtered count, and scales year 41 by 30/40. The UI calls it
"Mid avg" and ranks all years together.

**Files**
- `src/services/redis/storeAttOrMidToRedis.ts`
- `src/web/src/Leaderboard.tsx`
- `src/web/src/components/Podium.tsx`
- `docs/DATABASE.md`

**Steps**
1. Choose one:
   - **Normalize:** store a percentage of the maximum mark for each subject,
     so all years are comparable. The parser needs the max per subject; if the
     portal does not provide it, this is not possible.
   - **Scope:** keep the raw average but rank only within the same yearSem
     (and ideally the same branch). The UI must say "within 3rd year 1st sem".
   - **Drop:** remove the mid-marks leaderboard and keep the tab as a personal
     card only.
2. Delete the year-41 magic or put it in a documented normalization function
   with a test.
3. Put the definition on screen: one sentence under the sort tabs.
4. Add a test for a lab, a missing M2, and a 40-mark scheme.

**Done when**
- [ ] A student can read the definition and the scale on the screen.
- [ ] The ranking scope is comparable (or the tab is gone).
- [ ] The year-41 special case is explained or removed.

---

### P2-10 — Validate before caching, and show fallback age

**Why:** `fetchFresh` caches the raw response before checking whether it
contains the roll or parses. A broken layout overwrites the last good fallback.
`fallbackResponses` has no timestamp, so "last saved copy" has no age.

**Files**
- `src/services/student.utils/Academic.ts`
- `src/db/fallback/response.model.ts`
- `src/db/init.ts`
- tests

**Steps**
1. Add `updated_at TEXT` to `fallbackResponses` (schema v2, guarded ALTER).
2. `storeResponse` writes `datetime('now')`; `getResponse` returns
   `{ content, updatedAt }`.
3. Move `cacheResponse` after the roll check and the parse, or pass a validator
   to `cacheResponse`. Never store a response that cannot be parsed.
4. `markCached("fallback")` includes the age ("last saved copy from 4 hours
   ago") and the source.
5. Add a test: a malformed response does not overwrite a good row; a fallback
   reports its age.

**Done when**
- [ ] A layout change cannot poison the fallback.
- [ ] The bot says how old the fallback is.
- [ ] The migration is idempotent.

---

### P2-11 — Synthetic lookup canary and answer health

**Why:** the uptime probe only checks that the portal host answers any HTTP
request. A login failure, a layout change, or a parser regression stays green
while every student gets "no data".

**Files**
- `src/services/uptime.ts`
- `src/config/environmentals.ts`
- `src/api/server.ts` (`/api/status`, `/internal/canary` if needed)
- `src/status/index.html`
- `src/api/admin/feed.ts`
- tests

**Steps**
1. Add `CANARY_ROLL` (a real roll already present in `studentsnew`, chosen by
   the operator; no sync step is added to the plan) and
   `CANARY_COMMAND=att`. Skip the probe when unset or in tests, so a dev box
   does not hit the portal. Guard it with `ENV=production` or an explicit
   `CANARY_ENABLED=1`.
2. Add a `lookup` probe to the in-process monitor: call `getAttendance` or a
   dedicated `probeAnswer` that logs in, fetches the section, parses, and
   asserts a subject count/percentage. It must **force a fresh portal fetch**,
   not read the per-roll Redis cache, or it will stay green through a portal
   failure. Do not send a Telegram message.
3. Record `lookup` as a component (`up` with latency, `down` on parse/login
   failure). The probe should run every 5 minutes, with the same confirm-retry
   as the other components.
4. Add the component to `/api/status` and the status page bars. Show
   "answers" not just "portal".
5. Add an authenticated `/internal/canary` route for the external monitor
   (same secret), or keep the canary in-process until the external monitor can
   run it.
6. Alert the admin on a transition, as the other probes do.
7. Test: a mocked broken parser turns the canary down; a mocked Redis hit does
   not hide a portal failure.

**Done when**
- [ ] Breaking the parser (`tdPercent` missing) makes the status page red within
  two probe cycles.
- [ ] The status page shows answer latency.
- [ ] A healthy canary does not write an activity row or send a message.
- [ ] The canary uses a roll whose data is safe to use.

---

### P2-12 — Per-user rate limits, not per-IP

**Why:** the API limit is 600 requests / 15 min per IP. A campus NAT puts many
students behind one address; a few students scrolling the register can lock out
the rest.

**Files**
- `src/api/resolveUser.ts`
- `src/middleware/security.ts`
- `src/api/server.ts`
- tests

**Steps**
1. Add an `attachIdentity` middleware before the API limiter. It calls
   `resolveOptionalIdentity`, stores the result on `res.locals.identity`, and
   passes through.
2. The limiter's key is `u:<userId>` when authenticated, `ip:<ip>` otherwise.
   Keep a generous per-IP ceiling (e.g. 5,000/15 min) as a transport backstop.
3. Routes use `res.locals.identity` instead of resolving again. In particular,
   `/api/config`, `/api/leaderboard`, `/api/me`. Update both
   `apiSecurityMiddlewares` and `leaderboardSecurityMiddlewares` so the
   identity middleware runs before the limiter; the leaderboard route must not
   resolve identity twice.
4. Preserve the per-user report/thread gates.
5. Test: two users behind one IP do not share a 600 budget; an anonymous
   caller still hits the IP limit; a 429 includes `Retry-After`.

**Done when**
- [ ] One student's scrolling cannot exhaust another student's budget.
- [ ] Anonymous abuse is still limited.
- [ ] `res.locals.identity` is the single resolution point.

---

## 5. Phase 3 — Make the app answer the question (8–10 days)

### P3-01 — Structured "my academics" endpoint

**Why:** the app cannot show the student's attendance because the only formatter
is a Telegram string. The app needs the same data as JSON.

**Files**
- `src/api/server.ts` or new `src/api/me.ts`
- `src/services/student.utils/Academic.ts`
- `src/web/src/api.ts`
- tests

**Steps**
1. Add `GET /api/me/academics?type=attendance|midmarks`.
2. Resolve identity; registration wins, then a lookup-only fallback (after
   P1-05, the fallback is labeled as a suggestion; for this endpoint, require a
   registration or an explicit `roll` the caller owns).
3. Load the student; call `getAttendanceJSON`/`getMidmarksJSON` with the
   `Academic` class; return:
   ```json
   {
     "ok": true,
     "type": "attendance",
     "rollNo": "23KB1A0599",
     "data": { "...": "Attendance or Midmarks" },
     "freshness": { "notice": "...", "source": "live|cache|fallback" }
   }
   ```
4. Set `Cache-Control: private, max-age=60`, `Vary: X-Telegram-Init-Data`.
5. Track one activity event per explicit open, not per poll.
6. Test: registered user, unregistered user, cache hit, portal error.

**Done when**
- [ ] A registered student gets their own structured data.
- [ ] An unregistered caller gets a clear `registered: false` (not a 500).
- [ ] The response can be rendered without parsing Telegram HTML.
- [ ] The endpoint is private and not cached by a shared proxy.

---

### P3-02 — "My attendance" is the first screen

**Why:** the app's cover promises attendance and mid-marks; the app has no view
for them. The menu button opens an index, then the student has to find a
leaderboard. The core answer is one route away.

**Files**
- `src/web/src/AppShell.tsx`
- new `src/web/src/views/MyAttendance.tsx`
- `src/web/src/api.ts`
- `src/web/src/index.css`
- tests

**Steps**
1. Add a `MyAttendance` section. Default hash `#/` renders it. Recommended:
   remove the separate index route entirely and move its "Reading as" line
   onto the Attendance screen; the tab bar stays at five items. If you want to
   keep the cover, move it to `#/index` and do not make it the default.
2. Tab order: Attendance, Ranks, Profile, Issues, Library (when open).
3. The view:
   - overall percentage, attended/conducted, the 75% gap
   - subject rows with attended/conducted/percentage and last-updated
   - the bunk headline (“You can bunk N more...”)
   - a "Checked X ago" line from `freshness`
   - a Refresh button; a "Report wrong data" link that opens the issue form
     with the roll/type prefilled
4. States: loading skeleton, unregistered ("Save your roll"), no data, portal
   error with "Show last saved" if available, offline.
5. Use the existing register typography and rules; do not add cards, blur, or
   gradients. Reuse the table row patterns.
6. The bunk numbers can be computed on the client from `data.subjects` with the
   same formula as `formatters.ts`; unit-test the formula in the web package.

**Done when**
- [ ] A registered student opens the app and sees their attendance without
  leaving the first screen.
- [ ] The warm path renders from cache in under a second.
- [ ] Refresh updates the numbers and the age.
- [ ] The unregistered state points to Profile.
- [ ] The view works on a 360 px screen with one hand.

**Note:** this is the first screen that makes the app worth opening. Do not
skip it in favor of more leaderboard work.

---

### P3-03 — One shared identity provider

**Why:** `useTelegramUser` is called by the index and the leaderboard; each
mount fires `/api/me`, which runs two full-table rank queries. The index also
flashes "Not signed in".

**Files**
- `src/web/src/AppShell.tsx`
- `src/web/src/useTelegramUser.ts`
- `src/web/src/Leaderboard.tsx`
- `src/web/src/IndexPage` (inside `AppShell.tsx`)
- tests

**Steps**
1. Create `IdentityProvider` at the shell. One fetch on mount:
   `{ loading, roll, ranks, source, lastLookup, error, refresh }`.
2. `useIdentity()` in the index, leaderboard, profile, and attendance views.
3. Remove the per-view `/api/me` effects. Keep `useTelegramIdentity` for the
   raw `initData`.
4. Cache the result for the app session; refresh on explicit action or after a
   registration.
5. Loading state: "Checking your roll..." not "Not signed in". Error state with
   Retry.
6. Add a test that one app open with a rank visit makes one `/api/me` call.

**Done when**
- [ ] One `/api/me` per app open.
- [ ] No "Not signed in" flash for a registered user.
- [ ] Retry works after a network failure.
- [ ] The leaderboard strip uses the shared ranks.

---

### P3-04 — Defer and version the Telegram SDK

**Why:** the 119 KB SDK is a classic blocking script in `<head>`, and it is
served with a one-hour cache. It delays first paint on every open.

**Files**
- `src/web/app.html`
- `src/web/src/app-main.tsx`
- `src/web/src/telegram.ts`
- `src/api/server.ts`
- tests/build

**Steps**
1. In `app.html`, load the SDK with `defer` and a version query:
   `<script defer src="./telegram-web-app.js?v=59"></script>`.
2. Remove the inline `setHeaderColor/setBackgroundColor/ready/expand/
   disableVerticalSwipes` block. Add `bootstrapTelegram()` in `telegram.ts`
   and call it at the top of `app-main.tsx` before `createRoot`.
3. In the static handler, serve `telegram-web-app.js` with
   `Cache-Control: public, max-age=31536000, immutable` (the `?v=` changes when
   the SDK rev changes).
4. Keep the inline paper-color style so the first paint is correct.
5. Verify on a throttled connection that the paper paints before the SDK
   finishes.
6. Verify the module sees `window.Telegram` before `useTelegramIdentity` reads
   it. If the deferred SDK and the module order is not guaranteed in the
   target WebView, gate the first render on a `telegramReady` promise that
   resolves on `DOMContentLoaded` or when `window.Telegram` appears.

**Done when**
- [ ] The SDK no longer blocks parsing.
- [ ] A second open uses the cached SDK (no network or 304).
- [ ] Telegram header/background/ready/expand still happen.
- [ ] The page still works outside Telegram.

---

### P3-05 — Split the reader and the issue desk out of the entry chunk

**Why:** one 88 KB gzip JS chunk includes the SVG reader and the issue desk;
the index and leaderboard pay for both.

**Files**
- `src/web/src/AppShell.tsx`
- `src/web/vite.library.config.ts` (if needed)
- tests/build

**Steps**
1. `const LibraryView = lazy(() => import("./views/LibraryView"))` and
   `const Issues = lazy(() => import("./views/Issues"))`.
2. Wrap the route renders in `<Suspense fallback={<PageLoading />}>`.
3. Keep the tab visible; the chunk loads when the section opens.
4. Verify the build emits more than one chunk and the entry size drops.
5. Check the reader and the issue desk in the Telegram webview (or a browser
   with `?devUser=`).

**Done when**
- [ ] The entry chunk no longer contains the reader.
- [ ] The reader chunk loads on first open of Library, not before.
- [ ] No layout shift on the tab switch beyond the loading page.

---

### P3-06 — Resolve library context once per session

**Why:** every page request does a Redis session read, a registration DB read,
a student Redis/DB read, a document DB read, and entitlement checks. A 100-page
unit is hundreds of operations.

**Files**
- `src/api/library.ts`
- `src/services/library/session.ts`
- `src/services/library/entitlement.ts`
- `src/api/profile.ts` (invalidate on registration)
- tests

**Steps**
1. Add a short-lived in-process cache keyed by session token:
   `{ userId, ctx, expiresAt }`, TTL 60 s, max ~1,000 entries.
2. `requireSession` returns the cached context when fresh; otherwise resolves
   once and stores it.
3. `requireReadableDocument` still checks the document's semester against the
   cached context; the document row can also be cached for 60 s by id.
4. Invalidate the cache on registration change (`profile.ts` calls
   `invalidateStudentContext(userId)`).
5. Keep the Redis session as the source of truth; the cache is an optimization.
6. Test: two page requests in a session resolve the student once; a
   registration change invalidates.

**Done when**
- [ ] One context resolution per session per minute, not per page.
- [ ] Entitlement is still enforced per document.
- [ ] A registration change takes effect on the next page.

---

### P3-07 — Page cache policy and read dedupe

**Why:** pages are `no-store`, so back-scrolling beyond the 12-page window
re-downloads and re-stamps. Every page writes one `library_reads` row.

**Files**
- `src/api/library.ts`
- `src/services/library/reads.ts`
- `src/db/library.model.ts`
- `src/web/src/usePageWindow.ts`
- tests

**Steps**
1. Decide the cache policy:
   - **Recommended:** `Cache-Control: private, max-age=300` for the reader's own
     pages (the mark is per-user; a private browser cache is safe), or
   - a server-side LRU of stamped pages keyed by `user + doc + page + version`
     with a 5-minute TTL and a small cap.
   The anti-exfiltration intent is preserved either way; the difference is
   where the bytes live.
2. Dedupe read rows without losing the audit count: `SET NX` a Redis key
   `lib:read:{user}:{doc}:{page}` with a 1-hour TTL; only insert
   `library_reads` on the first read in that window. If the audit needs every
   delivery, increment a Redis counter and flush it to a `count` column
   periodically. Keep the token.
3. Make `watchForBurst` fire-and-forget; do not await Redis after `res.send`.
4. Test: two reads of the same page in an hour make one row (or one row with
   count 2, if the count column is added); back-scroll within 5 minutes does
   not hit the disk/stamp path.

**Done when**
- [ ] Back-scrolling within the window does not re-fetch.
- [ ] Read rows are deduped or counted, not one row per view.
- [ ] The burst counter still sees the page.
- [ ] A clean page still never leaves the server.

---

### P3-08 — Reuse a valid library session

**Why:** `useLibrary` opens a new session on every Library tab mount, minting a
new Redis token and leaving the old one alive for 12 hours.

**Files**
- `src/api/library.ts`
- `src/services/library/session.ts`
- `src/web/src/useLibrary.ts`
- tests

**Steps**
1. In `POST /api/library/session`, read the existing cookie. If
   `readSession(token)` returns the same user, return the existing token and
   student instead of creating a new one.
2. Otherwise create a new session.
3. The client can keep calling `POST /session`; it becomes idempotent per
   cookie.
4. Ensure `DELETE /session` still drops the token.
5. Test: two calls with the same cookie produce one Redis key.

**Done when**
- [ ] Tab switching does not grow the session key set.
- [ ] Logout invalidates the token.
- [ ] A stale/expired cookie gets a new session.

---

### P3-09 — Render cost: rows and reader pages

**Why:** every appended leaderboard page re-renders all prior rows; every page
draw rebuilds the reader's entire page list.

**Files**
- `src/web/src/components/StudentRow.tsx`
- `src/web/src/views/DocumentReader.tsx`
- `src/web/src/views/ReportThread.tsx`
- tests/build

**Steps**
1. Wrap `StudentRow` in `memo`; ensure `lastElementRef` and `isLast` only change
   for the row that needs them.
2. Hoist `Intl.DateTimeFormat` instances in `ReportThread` (two per message
   render today).
3. In `DocumentReader`, do not include `failed`/`loaded` sets in the page-list
   memo. Options:
   - a per-page `useSyncExternalStore` for its own flags, or
   - a stable `PageState` context that each `ReaderPage` subscribes to with a
     selector.
   Measure with React Profiler before/after.
4. If the list is still heavy, virtualize pages outside a ±3-page window while
   keeping the honest scrollbar (the existing aspect-ratio placeholders are the
   hard part).

**Done when**
- [ ] Appending a leaderboard page re-renders only the new rows (verify with
  Profiler).
- [ ] Drawing a reader page does not rebuild the full page list.
- [ ] No visual regression.

---

### P3-10 — Remove the warm loop and page cache if the embedded DB is fast

**Why:** the 50-second warmer and the 60-second Redis page cache are Turso-era
workarounds. If `LOCAL_DB_URL` is set and the query is fast, they are pure
complexity and staleness.

**Files**
- `src/api/server.ts`
- tests

**Steps**
1. Use the P0-02 baseline. If the embedded leaderboard p95 is under ~20 ms,
   delete `warmLeaderboardCache` and the 50-second interval.
2. Keep a short in-process cache (5–10 s) if the query is not trivial, or keep
   Redis for the anonymous default view only.
3. Add `ETag`/`Last-Modified` based on `updated_at` + query, and return 304
   when the client revalidates.
4. Re-measure. If the p95 regresses, restore the cache and document why.

**Done when**
- [ ] The background warmer is gone or explicitly justified by a measurement.
- [ ] The leaderboard p95 does not regress.
- [ ] The client can revalidate with an ETag.

---

## 6. Phase 4 — Product decisions (do not code before choosing)

### P4-01 — Decide the channel gate

**Current:** `isAuthorizedUser` checks channel membership before every answer;
a non-member gets a join card instead of their attendance.

**Options**
- **A (recommended):** remove the gate from the answer path. Keep the channel
  for announcements; ask for a join after the first answer, once.
- **B:** keep the gate, but store the pending roll and answer it after the
  join, so the lookup is not lost.
- **C:** keep it as is; accept that the first experience is a toll booth.

**If A:** delete `checkMembership`/`sendJoinChannelMsg` from
`isAuthorizedUser`; keep a one-time `/start` prompt; remove the `isMember`
cache key if unused.
**If B:** persist `{userId, chatId, roll, command}` in Redis for 10 minutes;
on `start=unlocked`, answer it; update the copy.
**Done when:** a new student gets an answer before being asked to join, or the
owner has explicitly accepted the gate.

---

### P4-02 — Decide leaderboard names and consent

**Current:** any Telegram user with valid `initData` sees names and marks; the
only pseudonym is a self-set `display_name` for registered users.

**Options**
- **A (recommended):** public rows are pseudonymous (roll + scores); names only
  for the viewer's own row and for registered users who opt in; a clear
  "show my name" control.
- **B:** registered users only; everyone else sees roll + scores. Still not
  consent for the registered.
- **C:** no names at all; `display_name` is the only name shown, and only if
  set.
- **D:** keep the current named public list, add an explicit consent notice and
  a take-down path.

**Also decide:** whether the 75% red is shown for other people's rows (recommend
only on the viewer's own row), and whether mid-marks are public at all.

**Done when:** the product brief and the API agree; a student who has not
consented is not named; tests enforce it.

---

### P4-03 — Decide the library: fill it or kill it

**Current:** the reader is polished, admin-only, and has no corpus in the repo.
It forbids text selection, search, annotation, and offline reading.

**Options**
- **Fill it:** one full semester of core subjects, reviewed; a text layer and
  search; offline caching for one unit; a license that permits it; a low-end
  Android test. Open to students only after those gates.
- **Kill it:** remove the tab, route, `LibraryView`, `DocumentReader`,
  `useLibrary`, `libraryApi`, the `/api/library` router, and the `library_*`
  tables (or keep the tables read-only for the audit trail). Reclaim the scope.
- **Freeze it:** keep it admin-only, stop building phases 6–7, and set a
  decision date.

**Done when:** the owner picks one; the code and docs match; no student sees a
dead shelf.

---

### P4-04 — Group answers are private by default

**Why:** a roll lookup in a group posts the student's attendance and marks to
everyone, including the below-75% warning.

**Files**
- `src/bot/academics/academicHandler.ts`
- `src/bot/commands/start.ts` (deep-link payload)
- tests

**Steps**
1. In a group/supergroup, do not post the card. Reply with a short line and a
   `url` button to `https://t.me/<bot>?start=att_<roll>` (or a plain "open the
   bot in private" link).
2. Handle `start=att_<roll>` in private: validate the roll and answer there.
3. Or DM the user if they have started the bot; fall back to the deep link.
4. Never post names, marks, or the 75% line in a group.
5. Test: a roll in a group produces no card; the deep link answers in private.

**Done when:** no personal academic data is posted in a group.

---

### P4-05 — Admin "core loop" health panel

**Why:** the admin sees activity and host health, not whether students are
getting fresh answers.

**Files**
- `src/api/admin/overview.ts`
- `src/api/admin/panel.js.ts`
- `src/services/tracker.ts` (or a new `lookup_events` table)
- `src/services/uptime.ts`
- tests

**Steps**
1. Record one outcome per lookup without adding a second write. Recommended:
   add `result` and `latency_ms` columns to `activity_log` and extend
   `trackActivity`; the existing `roll_lookup`/`attendance` row carries the
   outcome. If you prefer a separate `lookup_events` table, write one row, not
   two.
   Keep it aggregate-friendly; do not store the roll if not needed.
2. On Overview, add:
   - first-card p50/p95 (last 24 h)
   - fresh vs fallback vs error share
   - portal requests per lookup
   - leaderboard coverage
   - canary status and last probe age
3. Link each metric to the status page or a filtered activity view.
4. Add a test for the aggregation query.

**Done when:** the owner can answer "are students getting correct answers right
now?" from one screen.

---

## 7. Release gates

Before any deploy:

- [ ] `pnpm run typecheck`
- [ ] `pnpm run typecheck:tests`
- [ ] `pnpm run lint`
- [ ] `pnpm exec vitest run`
- [ ] `pnpm --dir src/web run test`
- [ ] `pnpm --dir src/web run build`
- [ ] `git status --short` is clean (or the deploy is deliberately dirty with a
  written reason).
- [ ] `scripts/backup-db.sh` succeeds, including the off-box copy.
- [ ] A boot against a copy of production applies schema v2 cleanly.

Manual smoke:

- [ ] A new user sends a roll and gets the attendance card with actions.
- [ ] A registered student opens the app and sees their own attendance on the
  first screen.
- [ ] The leaderboard defaults to their section and prints coverage.
- [ ] The year filter works in semester 1 and semester 2 data.
- [ ] Typing one character in search does not error.
- [ ] A resolved thread makes no further poll requests.
- [ ] A portal parser break turns the canary red.
- [ ] Two students on one NAT can both scroll the register.

---

## 8. What not to do in this plan

- Do not add a new surface (admin view, library phase, another mini app) before
  P1-01 and P3-02.
- Do not move to microservices, a queue, Kubernetes, Redis HA, or an ORM. One
  process and one SQLite file are correct here.
- Do not rewrite React or the design system. The shell is fine; the data flow
  and the information architecture are the problem.
- Do not add streaks, badges, notifications, or "engagement" features to a
  leaderboard that is partial and non-consensual. Accuracy and consent first.
- Do not optimize the warm cache before measuring the embedded query.
- Do not chase a complete census or run an expensive backfill. Show coverage,
  let lookups fill the register, and fix the parser, year filter, identity
  path, and core loop.

---

## 9. Suggested sequence for one maintainer

**Week 1:** P0, P1-01, P1-02, P1-03, P1-04, P1-05.  
At the end of the week a student should get a card with actions, save their
roll, and the app should stop calling a friend "you."

**Week 2:** P2-01, P2-02, P2-03, P2-04.  
The portal work should drop from N requests/parses/writes per section to one.
No `/syncdb` change.

**Week 3:** P2-07, P2-08, P2-10, P2-11.  
The leaderboard should be honest about being partial, semester-correct, scoped
to the student, and the status page should tell the truth.

**Week 4:** P3-01, P3-02, P3-03, P3-04, P3-05.  
The app should open on the student's own attendance, not an index, and should
not block first paint on the SDK.

**Week 5:** P2-09, P2-12, P3-06, P3-07, P3-08, P3-09, P3-10, P4-04.  
Then decide the library and the names policy (P4-01/02/03) with real numbers in
hand.

If there is only time for five tasks, do these:

1. **P1-01** — the card with actions.
2. **P3-02** — the app's first screen shows the student's own attendance.
3. **P2-07 + P2-08** — a semester-correct, scoped leaderboard that prints its
   coverage instead of pretending to be complete.
4. **P2-02 + P2-03 + P2-04** — one parse, one batch, one portal request.
5. **P1-05** — identity is registration, not last lookup.
