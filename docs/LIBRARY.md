# NbkristQik Library — plan

A reading room inside the bot. Students open their subjects in a Telegram
mini app, read the material on the phone, and never get a file they can keep.

Status: plan of record. Phases 1 to 4 are built and tested; the rest are
still to do. Supersedes the viewer and storage sections of
`docs/DOCUMENTS.md`; the content model in that file still stands.

| Phase | What lands | State |
| --- | --- | --- |
| 1 | catalogue snapshot + parser script + tests | **done** — `data/syllabus-catalog.json`, 7 departments, 161 KB |
| 2 | session exchange, subject list | **done** — `/api/library/session`, `/subjects`, `/me` |
| 3 | ingest CLI, document builder, one subject | **done** — `dist/tools/ingestLibrary.js`, the HTML builds, one unit tested |
| 4 | the reader: page window, saved place, zoom | **done** — `DocumentReader.tsx`, `usePageWindow.ts` |
| 4a | the reader's zoom: pinch, double tap, controls | **done** — `zoom.ts`, `DocumentReader.tsx` |
| 5 | bot entry points | **done** — `/library` command and the chat menu button |
| 6 | abuse detection, admin flags, search | partly — the five-minute document counter is in; the admin panel and search are not |
| 7 | the rest of the corpus, assignments, announcements | to do |

## 0. What we are building

One Telegram mini app, "NbkristQik Library":

- A student taps **Library** in the bot (menu button or `/library`).
- The app lists **their** subjects for the running semester, taken from their
  registered roll number.
- Tapping a subject opens the material as pages, rendered on the phone.
- The source PDF never reaches the device. Pages arrive as vector SVG — the
  PDF's own page layout, with the reader's Telegram user id drawn into them.

The library holds what `NbkristQik-docs` produces: the re-typeset, syllabus-exact
study documents, one PDF per subject unit.

## 1. Rules we hold ourselves to

1. **Telegram only.** The content is served only to a client that can prove it
   is inside our bot, by presenting signed `initData`. Nobody can open the URL
   in a browser and read anything.
2. **Registered only.** No roll number, no library. The gate is the existing
   `/register` flow.
3. **No file leaves the building.** The student never receives a PDF, never
   receives a URL that points at a file, and never receives text they can
   select.
4. **Only the pages on screen are resident.** Pages are fetched as the reader
   scrolls and dropped as they scroll away.
5. **Every page is attributable.** Each delivered page carries the reader's
   Telegram user id, drawn into it on our side.
6. **A leak points at one person, and we can act.** Bulk pulls are counted and
   flagged.

## 2. Shape of the system

```
Telegram app (mini app, our own origin)
  │  window.Telegram.WebApp.initData  (signed by Telegram, verifiable with the bot token)
  ▼
POST /api/library/session      →  exchange initData for a short-lived cookie
  │
  ▼
GET  /api/library/subjects     →  this student's subjects (entitlement applied)
GET  /api/library/document/:id →  the document's metadata, and may I read it
GET  /api/library/page/:id/:n  →  ONE page, watermarked, no-store
  │
  ▼
Express (oracle3, port 3000, behind nginx)
  ├─ session store      Redis (already running)
  ├─ catalog            data/syllabus-catalog.json (committed snapshot)
  ├─ registry           SQLite  (library_documents, library_reads)
  ├─ vector pages       $DIR/data/pages/<doc>/p001.svg  (disk, pre-rendered)
  └─ watermark          SVG text overlay of the reader's token, per request
```

Everything the student can reach is behind one auth check. The bot token never
leaves the server.

## 3. Access: Telegram-only, registered-only

Four gates, in order. The first two are convenience; the last two are the wall.

**Gate 1 — client (telegram-only).** The app reads
`window.Telegram.WebApp.initData`. If the Telegram SDK is missing or
`initData` is empty, the app renders a single line: "Open this from the
NbkristQik bot." and makes no API call. Outside Telegram there is nothing to
see, so this is a courtesy, not a defence.

**Gate 2 — session (telegram-only, enforced).** The app posts `initData` to
`POST /api/library/session`. The server verifies it with the existing
`verifyInitData()` (HMAC-SHA256 against the bot token, 24 h replay window) and
answers with a session cookie:

- `nbq_lib` — random 32-byte token, `HttpOnly`, `Secure`, `SameSite=Strict`,
  `Path=/`, 12 h expiry, stored in Redis with the Telegram user id, the roll
  number and the granted scope.
- The cookie is the only credential for every later call. `initData` is never
  put in a query string, so it never lands in nginx access logs, in a
  `Referer` header, or in a shared screenshot of the URL bar.

**Gate 3 — registration (registered-only).** The session carries a user id.
`GET /api/library/subjects` looks up `registrations.userId → roll_no`. No row,
no subjects: the app shows the register sheet (or tells the student to run
`/register`) and stops. The roll must also exist in `studentsnew`, the
college master table, so a typed-in roll cannot be a ghost.

**Gate 4 — entitlement (this subject only).** Every page request re-checks
that the reader's year, sem and branch include the requested document. A
student who somehow gets a document id still gets a 403 on the pages of a
subject that is not theirs.

Why we host the app on our own origin: the cookie must be first-party. Served
from GitHub Pages the API would be a third-party origin, and iOS WKWebView
blocks those cookies by default, which would break the session for half the
students. Same origin, same-site cookie, no ITP.

**Gate 5 — the library is the admin's until it is filled.** While the shelf
holds only a unit or two, `LIBRARY_ACCESS` is `admin` (the default). Then:

- `/library` stays out of the public command list and the chat menu button is
  reset to the command list, so students never see a door into an empty room.
- The admin's chat gets both: the command in its scoped list and a `Library`
  menu button.
- `POST /api/library/session` refuses any other Telegram account with
  `403 The library is not open yet.`, and `requireSession` re-checks the
  session, so a cookie minted before the switch is useless after it.
- `/library` typed by a student answers in private with one line, and says
  nothing in a group.

Opening it later is `LIBRARY_ACCESS=all` in the unit's environment and a
restart. The flag is read per request, so the gate and the bot menus agree
without a rebuild.

**Cost.** The library SPA is a second web app. The current one (leaderboard,
register, report) stays on GitHub Pages where it is; the library moves to
`https://checker.tobioffice.dev/library/`, served by Express as static files.

## 4. Which subjects a student gets

### 4.1 The catalog

The college publishes the syllabus of every subject with its code:
`https://at.nbkrist.org/Syllabi/showSyllabi.php?dept=CSE` (also ECE, EEE, IT,
ME, CE, AIDS, CSE(DS), CSE(AIML)). Each page is one table: regulation, then
"I Year - I Sem" style headings, then subject entries like
`( 23CS31T2 ) Computer Networks & Internet Protocols.pdf` linking to the
official syllabus PDF.

`scripts/sync-syllabus-catalog.mjs` parses those pages with cheerio and
writes `data/syllabus-catalog.json`:

```json
{
  "version": 1,
  "generatedAt": "2026-10-21",
  "departments": {
    "CSE": {
      "R23": {
        "31": {
          "core": [
            { "code": "23CS31T1", "name": "Artificial Intelligence" },
            { "code": "23CS31T2", "name": "Computer Networks & Internet Protocols" }
          ],
          "elective": [{ "code": "23CS31E1", "name": "Object Oriented Analysis And Design" }]
        }
      }
    }
  }
}
```

The tool that writes it is `node dist/tools/syncSyllabusCatalog.js` (the
parser itself lives in `src/services/library/syllabusParser.ts`, unit tested
against a saved fixture).

`kind` is `core` or `elective`; electives (OE/PE/HONOURS/MINORS blocks) are
recorded but not auto-assigned, because which elective a student takes is not
in the roll number.

The snapshot is committed and read at boot. The live site is slow and changes
without notice, so nothing in the request path touches it. A manual run
refreshes it.

What the first run found, so nobody is surprised later:

- The college's pages are not tidy. The regulations are not nested the same
  way (some blocks sit in a card, some in a collapse, some beside it), and
  the label styles differ per department: CSE says `CORE`, `OE-2`, `P-2`;
  IT and the AI departments say `CORE SUBJECTS`, `OPEN ELECTIVE-I`,
  `PROFESSIONAL ELECTIVE-I`. The parser reads the flat document order and
  keys on the year-sem in the file path, which is the one thing every
  department agrees on.
- Electives listed inline in a semester block are split out by their code
  (`…E1` professional, `…O1` open), so they never reach a student who did
  not pick them.
- **ECE and ME publish no subject codes at all** — their links are bare file
  names. There is nothing to key a document on, so those two departments are
  not in the catalogue. The library opens CSE first; the other departments
  need the college to publish codes, or a mapping of our own.
- The R23 CSE scheme stops at IV-I: the college has not published IV-II
  subjects for it, so the catalogue has seven year-sems, not eight.

### 4.2 The student, resolved

From the registration's roll number:

| Field | Source | Example |
| --- | --- | --- |
| roll | `registrations.roll_no` | `23CS1042` |
| year + sem | `studentsnew.year` (the portal's `yearSem`, e.g. `31`) | `31` → III year, I sem |
| branch | `studentsnew.branch` (portal branch id) | `5` → CSE |
| entry year | first two digits of the roll | `23` → 2023 |

`studentsnew.year` is already the college's own `yearSem` code (`11`…`42`),
set by `/syncdb`, so it maps straight onto the catalogue's year/sem keys.
The portal branch id maps to a department through the existing `BRANCHES`
table: `5→CSE`, `23→AI_DS`, `32→CSE(DS)`, `33→CSE(AIML)`, `4→ECE`, `2→EEE`,
`11→CE`, `7→ME`, `22→IT`. The site's own department names are not identical to
the portal's (`AIDS`, `CSE(DS)`, `CSE(AIML)`), so that small table needs one
confirmation pass per branch before the library opens to other departments.
Phase 1 is CSE only.

**Regulation** comes from the entry year in the roll: 2023 and later are R23,
2020–2022 are R20, 2019 is R19, 2017–2018 are R17, 2016 and earlier are R13.
The catalogue holds every regulation, so the lookup is exact for any batch.

### 4.3 From subject list to library documents

Our library is keyed by the same college code (`23CS31T2` for Computer
Networks, `23AD22T1` for DBMS), so the join is a code match, not a fuzzy
title match.

```
roll → (dept, regulation, yearSem)
     → live documents for that key
     → one shelf row per subject, with the units we hold
```

A student in III-I (CSE) sees the subjects we have cut for III-I, not the
whole syllabus. The catalogue still resolves the student and names the
subjects, but the shelf only lists material we hold. A semester we have not
reached yet gets an empty shelf with one line saying so, not a list of
promises.

## 5. Content delivery: the PDF never reaches the phone

This is the core of the request. The PDF is rendered once into vector pages,
each page is watermarked per reader, and pages are served one at a time.

Why vector SVG and not page images: the first shelf served stamped JPEGs, and
the raster compositing (libvips, via sharp) held native memory it would not
give back — a few readers at once pushed the 1 GB box into swap and took the
bot down with it. An SVG page is the PDF's own page with its glyphs as vector
paths: no native image library, no raster memory, the same layout as the PDF,
and the ink stays sharp at any zoom.

### 5.1 Render once, at ingest

When a document is ingested, the server renders every page to an SVG and
keeps the pages on disk. The source PDF stays on the server.

- Tool: poppler's `pdftocairo -svg` (`apt install poppler-utils` on oracle3;
  sudo is available), run **outside** the systemd service so the 600 MB
  `MemoryMax` on `nbkristqik.service` is never in play.
- Output: one SVG per PDF page, the page size in points (A4 is about
  595 × 842), every glyph a vector path, every figure inline. Roughly 300 KB
  a page, about 100 KB gzipped; nginx is configured to gzip `image/svg+xml`
  on this site.
- Layout: `$DIR/data/pages/<docId>/p001.svg`, `p002.svg`, … The page number
  is the file name, so the server never has to scan a directory.
- 30 pages of a unit is about 9 MB of disk. The whole shelf is 443 MB. The
  server has 41 GB free. Fine.

The PDF is not served, not ranged, and not proxied. There is no endpoint that
returns a document's bytes.

### 5.2 Watermark per reader

Every page is stamped with the reader's mark before it is sent:

- A diagonal repeat down the page at 5% opacity: a deterrent, not the
  identifier. A person reading the page does not notice it.
- A footer line at 42% opacity carrying the reader's **token**, an opaque code
  like `NBK-362C-88C3`. It is derived from the Telegram user id and a server
  secret, so it says nothing to the student about what is being tracked, and
  it is recorded with every page read, so a page that turns up in the wrong
  hands is resolved to one account.

The reader's Telegram id and roll number are **not** on the page. A roll
number in a shared photo is a name in the college's records; the token is
not.

The footer is deliberately tuned: at 42% opacity tesseract still reads the
token straight out of a screenshot, while a person reading the page barely
notices the line. A screenshot keeps it perfectly legible.

The mark is applied **server-side**, into the delivered bytes, as SVG `<text>`
elements. If it were drawn by the client, a student could remove it in one
line of JavaScript.

Because the base page is watermark-free, one page file serves every reader;
the overlay is per request and is a string insertion.

To resolve a token back to a student:

```
node dist/tools/resolveWatermark.js NBK-362C-88C3     # a token off a page
node dist/tools/resolveWatermark.js --user 123456789  # a user's token
```

### 5.3 Stream per page

`GET /api/library/page/:docId/:page` returns one SVG:

- `Cache-Control: no-store, private` — the browser keeps nothing.
- `Content-Disposition: inline` with no filename, `X-Content-Type-Options: nosniff`.
- `Cross-Origin-Resource-Policy: same-origin` — no other site can embed it.
- No `Accept-Ranges`; no multipart; no bundle endpoint that returns ten pages
  at once.

The client keeps the current page and one page either side. Everything else
is dropped: the object URL is revoked and the bytes are released. Scrolling
back up costs one request.

### 5.4 What the student can and cannot do

| Action | Result |
| --- | --- |
| Read the material on the phone | works, by design |
| Select or copy the text | impossible: the page is vector outlines, there is no text layer |
| "Save image as" from the browser | the page is shown from a blob URL, and the saved copy carries their token |
| Save the page as PDF | impossible: no PDF reaches the device |
| Open the network tab and copy the SVG | they can, and the copy carries their user id |
| Screenshot or photograph the screen | they can, and it carries their user id |
| Read the whole subject in one burst | counted, throttled, and logged |

## 6. Data model

Three new tables in the embedded SQLite (`data/qik.db`).

```sql
-- one row per ingestable document (a subject unit, or a whole subject)
CREATE TABLE IF NOT EXISTS library_documents (
  id           TEXT PRIMARY KEY,      -- "23CS31T2-u2"
  code         TEXT NOT NULL,         -- college subject code
  title        TEXT NOT NULL,
  dept         TEXT NOT NULL,         -- CSE
  regulation   TEXT NOT NULL,         -- R23
  year_sem     TEXT NOT NULL,         -- "31"
  unit         TEXT,                  -- "II" (NULL for a whole-subject file)
  kind         TEXT NOT NULL,         -- material | assignment
  source_path  TEXT NOT NULL,         -- data/docs/23CS31T2-u2.pdf (server only)
  page_count   INTEGER NOT NULL,
  bytes        INTEGER NOT NULL,
  status       TEXT NOT NULL,         -- live | coming_soon
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (code, unit, kind)
);

-- every document delivery, for abuse detection and for "who read what"
CREATE TABLE IF NOT EXISTS library_reads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  doc_id     TEXT NOT NULL,
  page       INTEGER NOT NULL,
  at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_library_reads_user ON library_reads (user_id, at);
CREATE INDEX IF NOT EXISTS idx_library_reads_doc  ON library_reads (doc_id, at);
```

`library_reads` grows slowly (one row per document open). It is the evidence trail
for a takedown, and the input for the bulk-pull detector.

The catalogue snapshot is a committed JSON file, not a table: it is reference
data, reviewed in a diff, and read at boot.

## 7. API surface

All under `/api/library`, all behind the session cookie, all rate limited.

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/api/library/session` | verify `initData`, set the cookie, return the student summary (roll, name, year-sem, branch) |
| DELETE | `/api/library/session` | drop the session (the app's "log out of the library") |
| GET | `/api/library/subjects` | the student's subjects, each with unit count and live status |
| GET | `/api/library/document/:id` | one document: id, code, title, unit, pages, version |
| GET | `/api/library/page/:id/:page` | one watermarked vector page |
| GET | `/api/library/search?q=` | search over subject titles and unit titles (v2, over extracted text) |

Rate limits, from the existing `createRateLimit` helper and Redis:

- 10 session exchanges per user per hour.
- 120 list/document calls per 15 min.
- 90 page calls per minute per user, 600 per 15 min per IP.

A page burst above 90/min is not blocked outright; it is counted, and 300
pages inside 5 minutes raises a flag on the student and an entry in the admin
panel.

## 8. The viewer (front end)

New Vite entry in `src/web`: `library.html` → `src/web/src/library-main.tsx`,
built with `base: "/library/"` and served by Express from `$DIR/public/library`.
The leaderboard, register and report pages stay exactly as they are.

Structure:

- `views/LibraryApp.tsx` — the gate, then the shelf: the student's subjects
  as register rows, a subject's units, and the reader when one is open.
- `views/DocumentReader.tsx` — the reader. A vertical scroll of pages; each
  page is an SVG image in a fixed box, with the unit head band above it.
- `usePageWindow.ts` — the windowing logic: which pages to fetch, which to
  drop, and the blob URL each page is shown from.
- `pagePosition.ts` — the page box ratio and the page-at-the-middle
  arithmetic, both unit tested.
- `zoom.ts` — the zoom model: the ladder, the clamp, and the arithmetic that
  holds a point under the finger through a zoom, all unit tested.

### The reader, in detail

- Each page is an SVG fetched from the server and shown from a blob URL in an
  `<img>`, not a canvas: the DOM holds no document URL, and the browser draws
  the page's vectors at whatever size the zoom asks for.
- The page sheet is white, like the printed page. The PDF's figures are set
  on white, so a cream sheet would put every diagram in a white box.
- The page SVG is transparent where the PDF has no ink, so the loading
  skeleton under it is hidden as soon as the page is drawn; otherwise its
  page number and `Loading` label show through the page.
- Each page box is fixed to the paper's ratio (1 / 1.414) so the scroll
  height is right before any page has loaded. A box left at the wrong ratio
  is not cosmetic: a landscape box squeezes a portrait page and can put the
  last page beyond the reach of the scroll.
- The page bytes live in a `Map<page, {blob, url}>` capped at twelve
  entries. When a page falls out of the window its object URL is revoked and
  its image is cleared.
- **The window never drops a page the reader is looking at.** The reader
  tells the window which pages it wants; the window releases only the rest.
  Getting this wrong leaves blank frames on the screen: a page cleared while
  it is still in view is never redrawn, because the observer has nothing
  left to report.
- Under every page sits its number and a `Loading` label, so a page on its
  way reads as loading rather than broken. The page covers it once drawn.
- A page whose fetch failed is retried once. If both tries fail the page
  says `Did not load · tap to try again`, in the red correction ink, and the
  tap fetches it again.
- The counter follows the scroll, not only the moment a page enters or
  leaves the window. It is computed from the first two page boxes, so the
  last page reads as the last page.
- The reader remembers the page it stopped on, per unit, for the life of the
  tab, and opens there next time.
- The unit ends with an `End of Unit` rule and a way back to the units.
- `user-select: none`, `-webkit-touch-callout: none`, `contextmenu` prevented,
  `draggable={false}` on the page, and `touch-action: pan-x pan-y` so the
  page still scrolls normally and a zoomed page can be panned across.
- **When the app goes to the background** (`visibilitychange`), every page is
  released, so the Telegram app switcher does not hold a readable snapshot
  of the material.

### The zoom

The page is vector, so it can be made bigger without the server sending
anything else, and the ink stays sharp at every zoom. The zoom is a custom
property on the pages column (`--zoom`), and the page boxes are sized from
it, so the whole document scales together and the scroll geometry stays true.

- The zoom is written straight onto the column, not held in state, because a
  pinch changes it every frame. The page list is built once and kept.
- The point under the finger stays under the finger. The point is measured in
  fit-width pixels, which do not move when the zoom does, and the scroll is
  corrected by the distance that point travelled.
- The buttons zoom about the middle of the screen, not the page's corner. A
  zoom that grows from the corner walks the text under the student's eyes off
  the screen, and the next second is spent hunting for the place they were
  reading. The middle holds still.
- Four ways in: the `- / % / +` controls in the head band, a pinch, a double
  tap, and Ctrl with the wheel on a desktop.
- The pinch is two fingers anywhere on the reader, head band included: two
  fingers are the gesture, and a student who rests one on the band still means
  it. The double tap stays a page gesture (`400 ms` apart, within `48 px`), so
  a double tap on the way back does not zoom.
- A double tap zooms to 250% on the spot, or back to fit.
- The zoom runs from 80% to 300%.
- The browser's own pinch is off (`maximum-scale=1` in the viewport, and the
  reader's own touch handlers), so the reader's zoom is the only zoom.

### Look

Per `DESIGN.md` ("The Class Register, Open on the Desk"): paper background,
one green head band per surface, hairline rules instead of shadows, square
corners, tabular numerals for page numbers and counts, red used only for
correction ink.

The reader's head band carries the way back, the subject in Zilla Slab, one
tracked micro-label for the unit and the page position (`Unit I · 12 / 29`),
and the zoom controls at the right. The page position lives there rather than
in a box of its own so a long subject name is not cut to a stub on a phone.
The zoom controls are three compact squares in the same hand as the way back:
out, the zoom as a percentage, in; tapping the percentage fits the page to
the screen again. A 2 px rule along the band's bottom edge fills as the unit
is read. Pages sit on the manila ground as bright sheets with a hairline; the
watermark is the only thing on them that did not come from the PDF.

## 9. Ingest: how a subject gets into the library

Manual and curated, like everything in `NbkristQik-docs`. No auto-publishing.

1. The docs pipeline finishes a unit and hands over the PDF (the printed
   `unitN-retypeset.pdf`).
2. The admin drops the file on the server (`scp`) and runs the ingest CLI,
   modelled on the existing `syncdbCli.ts`:

   ```
   node dist/tools/ingestLibrary.js \
     --file ~/inbox/23CS31T2-u2.pdf \
     --code 23CS31T2 --unit II --dept CSE --year-sem 31 --kind material
   ```

   The CLI: validates the code against the catalogue snapshot, copies the file
   to `data/docs/`, renders every page to an SVG with `pdftocairo`, writes the
   pages to `data/pages/<id>/`, records the row in `library_documents`, and
   prints what went live.
3. Verify in the app: open the subject as that student, read the first and
   last page, check the watermark and the zoom.
4. Announce in the channel: "Computer Networks Unit II is up in the library."

A new version of a unit is a new row version plus a fresh page set; the old
page set is deleted after the swap, and the old PDF is kept in
`data/docs/versions/` as the rollback.

**Unit per document, or one PDF per subject?** This plan uses one document per
unit. The earlier plan (`docs/DOCUMENTS.md`) said one PDF per subject with
chapters as page ranges. Unit-per-document is easier to operate: the docs
pipeline already produces unit PDFs, each stays well under the Bot API
download cap, a new unit does not re-render the rest of the subject, and a
bad unit can be re-cut without touching its neighbours. The student sees the
same two-level navigation either way (subject → unit → pages). The merged
full-subject PDF can still be produced later for the "print the whole subject"
case.

## 10. Abuse, audit, and the honest limits

- **Per-read accounting.** Every document delivered is a row in `library_reads`.
- **Bulk-pull detector.** More than 300 pages in 5 minutes for one user: flag
  the account, show the student a short notice in the app, and put it in the
  admin panel. The bot can also refuse further page calls for that user for
  an hour.
- **Takedown.** A flagged user id maps to a Telegram account, which is the
  point of the watermark.
- **No indexable surface.** The pages are behind a cookie-authenticated API;
  nothing is public, so nothing gets indexed or scraped by a search engine.
- **What we cannot do**: stop a photograph, stop a motivated person with
  devtools inside Telegram Desktop, or stop a student from reading a page and
  retyping it. We can stop the file, the text, the bulk copy, and the
  anonymous leak. That is the honest ceiling, and it is the right ceiling for
  study material the students are supposed to keep.

## 11. Running it

- **Server**: oracle3, Express on 3000 behind nginx at
  `checker.tobioffice.dev`. The library SPA is served by Express from
  `$DIR/public/library`; nginx needs no change, the existing `location /`
  already proxies to Express. The SPA is a separate Vite build
  (`src/web/vite.library.config.ts` → `dist-library/`) because it is the only
  page that talks to `/api/library`.
- **Packages**: no native modules on the server — the page path is plain
  string work. `poppler-utils` via apt gives `pdftocairo` and `pdfinfo` for
  the render, and the ingest tool says so plainly if it is missing.
- **Disk**: `data/docs/` for the source PDFs, `data/pages/` for the vector
  pages (443 MB for the whole shelf). `backup-db.sh` should be extended to
  include `data/docs/`; the pages are regenerable from the PDFs and are not
  worth backing up.
- **Deploy**: `scripts/deploy.sh` syncs `dist/`, the library bundle and
  `data/syllabus-catalog.json`. The ingest CLI runs as a separate process
  (never inside the service, so the 600 MB cap is safe): it renders the
  pages to `data/pages/` on the server.
- **Config**: `LIBRARY_DATA_DIR` moves the data tree, `LIBRARY_WEB_DIR` moves
  the built bundle (both default to the working directory),
  `LIBRARY_WATERMARK_SECRET` is the secret behind the watermark tokens (it
  falls back to the bot token).
- **Preview**: `scripts/preview-library.mjs` serves the built library and
  fakes the API and Telegram, so the app can be looked at in a plain browser
  without a deploy. It stamps the pages with the same code the server uses.

  The subjects come from the committed catalogue and the units from the
  vector pages on disk, so the page count in the preview is the page count
  actually served.
  A hard-coded count is how the practice section went missing from the
  preview once already.

  ```
  PREVIEW_PAGES=<dir> node scripts/preview-library.mjs   # port 8099
  ```

  `<dir>` holds one folder per document, named `<code>-u<unit>`. Add
  `PREVIEW_SEM=21` (and `PREVIEW_DEPT`, `PREVIEW_REG`) to preview another
  semester.

## 12. Build order

| Phase | What lands | Done when |
| --- | --- | --- |
| 1 | catalogue snapshot + parser script + tests | `data/syllabus-catalog.json` lists every R23 CSE subject with its code; the parser re-runs cleanly |
| 2 | session exchange, subject list, no pages yet | a registered student sees their subject list in the mini app; a browser sees nothing; a non-Telegram request gets 401 |
| 3 | ingest CLI, document builder, one subject (DBMS Unit I) | the student reads DBMS Unit I in the app, watermarked |
| 4 | the reader: page window, vector pages, zoom, background clear, anti-copy CSS | scrolling keeps a small page window, backgrounding clears the screen, no text is selectable, no PDF is reachable |
| 5 | bot entry points: `/library`, menu button, `/start library`, channel announcements | one tap from the chat opens the library |
| 6 | abuse detection, admin flags, search | a bulk pull is caught, flagged and visible in the admin panel |
| 7 | the rest of the corpus, assignments, announcements per unit | every live unit in the docs repo is readable by the students who own it |

Phases 1 and 2 are cheap and unblock everything else. Phase 3 is the first
one where a student sees a page.

## 13. Open questions

1. **Unit per document, or one merged PDF per subject?** (This plan says unit
   per document. The earlier plan said one per subject.)
2. **Electives.** OE, PE, HONOURS and MINORS are in the catalogue but not
   derivable from a roll number. v1 excludes them, or the admin marks a
   specific elective for a specific section.
3. **Older batches.** R20, R19, R17 and R13 students: the catalogue has their
   real subject lists, but our library is R23 only. Do they get the R23
   material with a note, or nothing until we cut their regulation?
4. **Past semesters.** Do students see the previous semester's subjects too,
   or only the running one? (v1: running semester only.)
5. **Watermark text.** Telegram user id alone, or id plus roll number? (Roll
   number is public data and helps a student confirm which copy is theirs; the
   Telegram id is what we can ban.)
6. **Hosting.** The library moves to `checker.tobioffice.dev/library/`, off
   GitHub Pages, for first-party cookies. Confirm we are happy to serve the
   app from the API host.
