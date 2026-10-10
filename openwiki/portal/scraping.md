---
type: integration
title: College Portal Scraping
description: How NbkristQik scrapes the college portal — endpoint constants, the generated PHPSESSID session trick, the Academic request pipeline with retry and renewal, HTML parsers, fallback responses, and the typed error hierarchy.
tags: [scraping, portal, session, parsing, errors]
sources:
  - id: openwiki-source-2c2f76c1ef875a091a93cc02
    resource: repo://src/bot/syncdb.ts
  - id: openwiki-source-f3a065ecee23ee5a53fe9d83
    resource: repo://src/constants/index.ts
  - id: openwiki-source-5dc5a436f0ae2158fe59de63
    resource: repo://src/services/student.utils/Academic.ts
  - id: openwiki-source-16185f9de492b0ef30bbe5d7
    resource: repo://src/services/student.utils/academicErrors.ts
  - id: openwiki-source-dfd265dd267c1406d347369c
    resource: repo://src/services/student.utils/AcademicTG.ts
  - id: openwiki-source-deff80f3c505b522e6ba93b1
    resource: repo://src/services/student.utils/errorMessages.ts
  - id: openwiki-source-881f5e3a86a2421973165df4
    resource: repo://src/services/student.utils/parsers.ts
  - id: openwiki-source-b930379b15b9226a3c0602bc
    resource: repo://src/services/student.utils/portalSession.ts
generated: { by: "opencode", at: "2026-10-09T23:13:13.880Z" }
verified:
  - by: openwiki/0.7.1
    at: 2026-10-09T23:13:13.880Z
---

# College Portal Scraping

The academic feature's data comes from the college's attendance and mid-marks portal, scraped over plain HTTP with Axios and parsed with Cheerio. The integration is deliberately defensive: sessions are faked with generated PHP session IDs, responses are parsed into structured JSON, failures degrade to cached section HTML, and every failure mode has a typed error with a user-facing message.

## Endpoints and base URL

`src/constants/index.ts:9-16` defines the base URL and endpoints:

- Base: `process.env.PORTAL_BASE_URL || "http://103.203.175.91"` — the portal is plain HTTP by default; the comment notes credentials are POSTed to the login endpoint, so an HTTPS host should be configured if the portal ever supports it.
- `urls.login` — `/attendance/attendanceLogin.php`
- `urls.attendance` — `/attendance/attendanceTillTodayReport.php`
- `urls.midmarks` — `/mid_marks/marksConsolidateReport.php`

`/syncdb` additionally uses `/attendance/attendanceTillADate.php` and `/attendance/getStudentName.php?q=` (`src/bot/syncdb.ts:32-35`).

Request headers (`headers(command)` in `src/constants/index.ts:18-35`) mimic a desktop browser, set the `Referer` to the matching report page, and start with an empty `Cookie` that the session layer fills in.

## Session model

The portal authenticates via a PHP session cookie. Rather than parsing `Set-Cookie`, the client **generates** a `PHPSESSID` and POSTs credentials with it (`makeSessionToken`, `src/services/student.utils/portalSession.ts:18-21`): a fixed prefix plus 3 random bytes. The portal accepts the client-chosen id on login.

- `sessionCookie` is module-level state in `portalSession.ts`.
- `isSessionValid()` GETs the attendance page and checks for the marker `function selectHour(obj)` (`src/services/student.utils/portalSession.ts:28-46`).
- `renewSession()` generates a fresh token, POSTs `username`/`password`/`captcha=` with a `Referer` to the login page, accepts statuses 200–302 without following redirects, and stores the new cookie. Failure throws `InvalidCredentialsError` (`src/services/student.utils/portalSession.ts:51-73`).
- `getAcadYearForDate()` computes the academic year the portal expects, flipping in July, in IST (`Intl.DateTimeFormat` with `Asia/Kolkata`) (`src/services/student.utils/portalSession.ts:76-86`).

`/syncdb` performs its own login with the same token trick rather than sharing this session state (`loginToPortal`, `src/bot/syncdb.ts:76-95`).

## Request pipeline

`Academic` (`src/services/student.utils/Academic.ts:51-371`) owns the fetch. Constructor normalizes the roll number to uppercase and trims it.

`getResponse(command, retryCount)` (`src/services/student.utils/Academic.ts:59-75`) attempts a fresh fetch and, for transient network errors (timeout, aborted, connection refused, or no response) retries **once after a 1.5-second backoff** before falling through to error handling.

`fetchFresh` (`src/services/student.utils/Academic.ts:81-121`):

1. Builds request data: `acadYear`, `branch`, `section`, `yearSem` from the cached student record, `dateOfAttendance` set to the max date `27-03-2030`, and for mid-marks `midsChosen: "mid1, mid2, mid3"`.
2. POSTs to the report URL with the session cookie.
3. **Login-page detection** — if the response contains the portal's `User Name` input row, the session expired; `renewSession()` runs and, under `MAX_RETRY_ATTEMPTS = 2`, the whole request recurses with an incremented retry count. Beyond the limit it throws `InvalidCredentialsError`.
4. **Blocked-report detection** — the exact substring `"Blocked by Admin"`. The comment notes it deliberately does not match bare "Blocked" so that student names or subject codes cannot false-positive a valid report.
5. On success, the raw HTML is cached into `fallbackResponses` keyed by `buildResponseId(year, branch, section, command)`.

`getAttendanceJSON` / `getMidmarksJSON` (`src/services/student.utils/Academic.ts:268-326`) first check Redis (`attendance:{roll}` / `midmarks:{roll}`), and on a miss fetch fresh, verify the response contains the roll number (else `NoDataFoundError`), parse the requester's row, and kick off the full-section background cache.

### Fallback behavior

`handleRequestError` (`src/services/student.utils/Academic.ts:209-237`) re-throws `AcademicError` subclasses and — specifically — `StudentNotFoundError`, because a roll absent from college records must not be reported as a server outage. For other errors it tries the section-level fallback HTML from `fallbackResponses`; if none exists it throws `ServerDownError`.

## Parsers

`src/services/student.utils/parsers.ts` converts raw HTML to typed JSON. Both parsers look up the student's row with `$(tr[id=${roll}])` and throw `NoDataFoundError` when absent.

**Attendance** (`parseAttendanceResponse`): the percentage and total classes come from `td.tdPercent` (the parenthesized `attended/conducted`); the subject names, last-updated dates, attended, and conducted values come from table rows 1, 2, 3, and the student row respectively. Empty subjects (zero conducted) and the `%AGE` column are skipped. `year_branch_section` is built as `{year first char}_{BRANCHES[branch]}_{section}`.

**Mid-marks** (`parseMidmarksResponse`): marks come from the student row's cells after the first two; the subject list splits the header row by whether a cell contains an anchor (`<a>`) — linked cells are subjects, plain cells are labs. Subject marks parse as `M1[/M2(average)]`; labs carry a single `M1` value.

## Error hierarchy and user messaging

`src/services/student.utils/academicErrors.ts` defines:

| Class | Code | Meaning |
|---|---|---|
| `AcademicError` | caller-supplied | Base class with a message and code |
| `ServerDownError` | `SERVER_DOWN` | Portal unreachable and no fallback cached |
| `BlockedReportError` | `REPORT_BLOCKED` | Portal showed "Blocked by Admin" |
| `NoDataFoundError` | `NO_DATA` | Roll missing from a report it was expected in |
| `InvalidCredentialsError` | `INVALID_CREDENTIALS` | Login or session renewal failed |

`StudentNotFoundError` (`src/services/redis/utils.ts:7-14`) additionally carries nearby-roll suggestions.

`AcademicTG` maps these to rich HTML messages built in `errorMessages.ts`: server-down guidance with a timestamp, no-data checklist, student-not-found with clickable suggestions, blocked-report notice, generic error with a message and timestamp, and a last-resort unknown-error message. The copy was polished for plain-English readability (no em/en dashes; every message stays a static template, so nothing here is model-generated at runtime). The formatting layer is detailed in [Academic Data Flow](../bot/academic-flow.md).

## Related pages

- [Academic Data Flow](../bot/academic-flow.md)
- [Caching and Leaderboard Stats](../data/caching-and-stats.md)
- [Database Schema and Models](../data/database.md)
