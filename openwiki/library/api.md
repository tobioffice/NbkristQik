---
type: reference
title: Library API and Session
description: The /api/library routes — the initData-to-cookie session exchange, the session, student and document guards, the subject shelf, and the watermarked page endpoint with its headers and burst counter.
tags: [library, api, session, watermark, access-control]
sources:
  - id: openwiki-source-2e8d5982dd5829d5c5ceb46c
    resource: repo://src/api/library.ts
  - id: openwiki-source-37db9f34338f3f0cee99af9e
    resource: repo://src/services/library/entitlement.ts
  - id: openwiki-source-7cc706396dfd4d4455e7befa
    resource: repo://src/services/library/reads.ts
  - id: openwiki-source-579c3fdcf46f5d0a58634dba
    resource: repo://src/services/library/session.ts
  - id: openwiki-source-0d7bfd356b3432129e82f1a3
    resource: repo://src/services/library/watermark.ts
generated: { by: "opencode", at: "2026-10-24T11:00:48.405Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-24T11:00:48.405Z
---

# Library API and Session

The library API is the Express router in `src/api/library.ts`, mounted at `/api/library` by `src/api/server.ts` after a tighter rate limit on its session exchange. Two rules hold for every route in it:

- The caller must be inside Telegram. A signed `initData` blob is the only thing that can open a session, and only the Telegram client can produce one, so opening the URL in a browser gets nothing.
- The caller must be registered. A session without a roll number sees no subjects, and the app asks for the roll instead.

## Routes

| Method | Path | Guards | Answers |
|---|---|---|---|
| `POST` | `/session` | initData verification, `canOpenLibrary` | sets the session cookie; `{ok, registered, student}` |
| `DELETE` | `/session` | — | drops the session and clears the cookie; `{ok:true}` |
| `GET` | `/me` | session | `{ok, registered, student}` |
| `GET` | `/subjects` | session, registered student | `{ok, admin, preview, student, subjects}` |
| `GET` | `/document/:id` | session, student, readable document | `{ok, document:{id, code, title, unit, pages, version}}` |
| `GET` | `/page/:id/:page` | session, student, readable document | the page as `image/svg+xml` |

## The session exchange

Telegram hands the mini app a signed `initData` string. Keeping that string in the app would put a bearer credential in the address bar, in access logs and in screenshots, so the client swaps it once for an opaque cookie:

1. `verifyInitData(initData)` checks Telegram's HMAC and the 24-hour replay window. A failure answers `401` with "This page only works inside the NbkristQik bot."
2. `canOpenLibrary(user.id)` answers `403` while the shelf is still the admin's (`LIBRARY_ACCESS=all` opens it).
3. `createSession` mints 32 random bytes as `base64url` and stores `{userId, createdAt}` in Redis under `lib:sess:{token}` with a 12-hour TTL. Only the token is returned; the cookie is `nbq_lib`, `HttpOnly`, `SameSite=Strict`, `Secure` in production, scoped to `/`.
4. The reply carries the student projection (or `registered:false`), so the app can render the shelf or the roll form in one round trip.

`DELETE /session` reads the cookie, deletes the Redis key and clears the cookie, so "leaving" is a server-side revocation, not just a client-side forget.

## The three guards

Every route after the exchange composes the same three helpers, in this order, so no route can forget one:

- **`requireSession`** — reads the cookie, loads the session, and re-checks `canOpenLibrary`. A session minted before the library was closed must not outlive the close, and an unknown or expired token answers `401`.
- **`requireStudent`** — resolves the Telegram id to a `StudentContext` (roll, year-sem, branch, department, regulation). No registration answers `403` with `registered:false` and "Save your roll number first."
- **`requireReadableDocument`** — loads the document and refuses it twice: not found or not `live` answers `404`, and `mayReadDocument` answers `403` when the document's department, regulation or year-sem is not the reader's own. A document id alone gets nothing.

`mayReadDocument` lives in `src/services/library/entitlement.ts` beside `resolveStudentContext`, not in the route file: it is the same rule the shelf uses to decide what to list.

## The shelf

`GET /subjects` answers what the reader may see, with `?view=roll` answering "exactly what this roll would see". Two shapes come out of the same list:

- The admin's **preview** (`canPreviewEverything`, true only for the admin while the library is closed) lists every live document, whatever the admin's own semester.
- Everybody else gets the documents of their own department, regulation and year-sem.

Documents are grouped into subjects keyed by the college's subject code, sorted by code, with the catalogue's subject name (falling back to the document's own title) and one unit entry per document. A semester we have not reached yet gets an empty shelf, not a list of promises.

## Serving a page

`GET /page/:id/:page` is the only way a page leaves the server:

1. The page number must be an integer within `page_count` (`400` otherwise) and the rendered file must exist on disk (`404`).
2. `watermarkToken(userId)` derives the reader's opaque token: `HMAC-SHA256(secret, "nbk-library:" + userId)` cut to eight hex characters, printed as `NBK-XXXX-XXXX`. The secret is `LIBRARY_WATERMARK_SECRET`, falling back to the bot token, so a bot-token change should not be the only thing protecting old marks.
3. `stampPage` reads the SVG from disk, measures the page from its `pt` size, and inserts a vector overlay before `</svg>`: the token three times on a faint diagonal, and a footer line with the token plus the page's label (`DBMS · Unit I · p7`). A page that is not an SVG throws rather than being served unstamped.
4. The response is `image/svg+xml`, `Cache-Control: no-store, private`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff` and `Cross-Origin-Resource-Policy: same-origin`, so a proxy or a browser cache never keeps a copy.

Nothing clean ever leaves the box: one vector page on disk serves every reader, and the mark is drawn per request.

## Reading bookkeeping

Two side effects follow a served page, and neither can fail the request:

- `notePageRead` inserts a `library_reads` row (user, document, page, token) fire-and-forget, so a leaked page can be traced back to a reader.
- `watchForBurst` increments `lib:reads:{userId}` with a 300-second TTL and logs a warning past 300 pages, which is a copy in progress rather than a read. If Redis is down there is simply no counter.

## Related pages

- [Library Subsystem](overview.md)
- [REST API and Security](../api/server.md)
- [Caching and Stats](../data/caching-and-stats.md)
- [Library Reader Mini App](reader.md)
