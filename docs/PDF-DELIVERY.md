# PDF delivery: per-reader downloads and PC access

Status: implemented 8 November 2026. The stamp moved from `pdf-lib` to a
native Rust binary on 20 November 2026; the endpoint and headers did not
change. The download cache key gained a stamp revision, and the PDF mark is
now one footer on page 1. The reader stays SVG; this document covers the one
place the library serves a whole PDF, plus the PC session that makes
downloading practical on a computer.

This is a deliberate exception to the no-file rule in `docs/LIBRARY.md` §5 and
`docs/DOCUMENTS.md`. The file is entitlement-checked and watermarked; the
clean source still never leaves the server. If the product decision is still
"no file ever", do not ship the endpoint.

The public copy currently says there is no PDF to download
(`src/web/public/site/blog/library-launch.html`,
`src/web/public/site/blog/the-page-is-the-product.html`, and
`src/web/public/site/index.html`). That copy goes stale the day this ships.

## 1. Chosen design

```
GET /api/library/document/:id/pdf
  requireSession()                   same cookie as every library route
  requireStudent()                   registered roll number
  requireReadableDocument()          live + semester entitlement
  watermarkToken(ctx.userId)         stable opaque token, 64-bit HMAC
  cache: data/downloads/<docId>/<token>-s<stamp>-v<version>-<bytes>.pdf
  miss:  bin/pdfstamp (Rust) -> temp file -> atomic rename -> res.download
  hit:   res.sendFile (Range-capable, through res.download)
```

The pieces already exist:

- Source PDFs are copied to `data/docs/<id>.pdf` at ingest and are the store
  of record (`src/services/library/paths.ts`, `src/tools/ingestLibrary.ts`).
- Pages are rendered once with poppler `pdftocairo -svg` into
  `data/pages/<id>/pNNN.svg` (`src/services/library/vector.ts`). That path is
  unchanged; the download endpoint does not render or rasterise anything.
- The per-reader token is `watermarkToken(userId)` in
  `src/services/library/watermark.ts`: HMAC-SHA256 over the Telegram user id
  and `LIBRARY_WATERMARK_SECRET`, 64 bits, printed as
  `NBK-7F3A-2C19-8B44-D106`. The PDF downloads carry a lighter mark than the
  SVG reader pages: one footer line at 42% opacity at the bottom of page 1,
  with a label such as `23CS31T2 · Unit II · p1`. There is no diagonal repeat
  and later pages are unstamped. The PDF label uses the subject code, not the
  full title (`src/services/library/pdf.ts`).
- Auth and entitlement are the same helpers the page route uses
  (`src/api/library.ts`). The download route is registered before
  `/document/:id` so the two routes cannot be confused. It must not add a
  second, weaker path.
- The implementation is split. `src/services/library/pdf.ts` owns the cache,
  the source check, the queue and the in-flight promise;
  `src/services/library/pdfstamp.ts` runs the binary;
  `native/pdfstamp` draws the overlay and writes the file. The route is
  `GET /api/library/document/:id/pdf` in `src/api/library.ts`.
  `tests/unit/libraryPdf.test.ts` covers cache reuse, version separation,
  corrupt sources and both pruning rules; `native/pdfstamp/tests/stamp.rs`
  covers the drawing and the encrypted/corrupt refusals.

### What the endpoint does

1. Resolve the session and reader exactly as `/api/library/page/:id/:page`
   does. `canOpenLibrary` still gates the whole feature.
2. Load the document row, reject a missing/non-live document or one outside
   the reader's semester, and use `doc.version`, `doc.bytes` and
   `doc.source_path`.
3. Build the cache path from the reader token, the stamp revision, the
   document version and the recorded source byte count. Keep every component
   server-generated; never accept a path segment from the request beyond the
   document id. The current route trusts `doc.source_path` from the registry;
   if that row can ever be written outside the ingest tool, verify the
   resolved path is inside `data/docs` before reading it.
4. On a miss, run `bin/pdfstamp` with the source path and a temporary output
   path. The binary loads the PDF, appends one balanced `q...Q` footer stream
   to page 1, adds a standard-14 Helvetica-Bold font and one `/ExtGState`
   alpha entry to that page's own resource dictionary, and writes the output.
   Node then `rename()`s the temporary file into place. A caught failure
   removes its temp file; an uncaught crash can leave a `.tmp` for the sweep
   to clean. The source bytes never enter the Node heap.
5. On a hit, skip the binary entirely.
6. Send with `res.download(cachePath, safeFilename)`. `res.download` is the
   attachment form of `sendFile`, so a range request still works. If the PC
   viewer ever opens the PDF in place, use `res.sendFile` with
   `Content-Disposition: inline`; the cache path is the same.

The response headers that matter:

| Header | Value | Why |
| --- | --- | --- |
| `Content-Type` | `application/pdf` | explicit |
| `Content-Disposition` | attachment with a safe filename, or inline | drive the browser |
| `X-Content-Type-Options` | `nosniff` | no content sniffing |
| `Cross-Origin-Resource-Policy` | `same-origin` | no embedding elsewhere |
| `Cache-Control` | `private, max-age=3600` + `Vary: Cookie` (current) | per-reader bytes; the hour matches the audit dedupe |
| `Accept-Ranges` | set by `sendFile` | resume and PDF viewers |

`res.sendFile` supports byte ranges and conditional requests. A cached
download is a file stat plus a streamed send, not a stamp pass. That is the
whole point of the cache.

The current route sets `private, max-age=3600` and `Vary: Cookie`.
`noteDownload()` writes one `library_reads` row per reader, document and hour
(`src/services/library/reads.ts`), so an hour of browser caching is consistent
with the audit. If every click must produce a row, use `private, no-store`
instead; the file is then sent on each click, but the server-side cache still
avoids generation.

### Build and deploy

The binary is built on the deploy machine, not the server:

```bash
scripts/build-pdfstamp.sh        # native/pdfstamp -> bin/pdfstamp
```

`scripts/deploy.sh` runs it before syncing and ships `bin/pdfstamp` to
`$DIR/bin/pdfstamp`; the production host needs no Rust toolchain.
`PDFSTAMP_BIN` overrides the location. CI builds it before the Vitest suite
and runs `cargo test --locked`; the Vitest suite builds it on first use when
`bin/pdfstamp` is missing. `native/pdfstamp/Cargo.lock` is committed, so the
dependency versions do not drift between a developer's build and a deploy.

The hand-off is deliberately file-to-file. Node passes the source and a
temporary output path; the binary writes the result; Node renames it into the
cache. A missing or broken binary fails one download with a 500 and a log line
that names the build script, while the bot and the rest of the API keep
running. Nothing about the stamp is loaded into the Node process, so a
malformed PDF cannot crash the service; the source byte and page caps and the
60-second child timeout keep the work bounded.

The release binary links the builder's glibc (the current build needs 2.34,
so Ubuntu 22.04 or newer). If the deploy machine and the server ever diverge,
build in a container that matches the server, or add a musl target. The deploy
runs `bin/pdfstamp --version` on the server before the restart, so a mismatch
stops the release instead of shipping a download path that cannot start.

### Why this design

**It does not rasterise.** The source is already a PDF; the output is a PDF
with a few text operators added to the first page. Rasterising 100 pages would
create images many times larger, lose vector zoom and print quality, and
reintroduce the native image memory that took the box down before. `docs/LIBRARY.md` §5
records the earlier libvips/sharp incident: a few readers pushed the 1 GB box
into swap. The stamp is native code, but it is not an image library: `lopdf`
reads and writes PDF objects, and `pdftocairo` still does the vector page
rendering at ingest.

**It does not use a browser.** Puppeteer or a headless Chromium would add
hundreds of megabytes per instance before the document is even loaded, plus a
sandbox, fonts and system packages. The server has a 600 MB `MemoryMax` on the
service (`docs/LIBRARY.md` §5.1). A small PDF with text overlays does not need
a browser.

**It does not serve the clean source.** A signed URL protects the URL, not the
bytes. Once the clean file is downloaded it can be forwarded with no mark and
no way back to the reader. The token on page 1 is the only control the library
has for the downloaded file, and it is the same token the reader already sees
on the SVG pages.

**It does not pre-generate for every student.** The number of possible files is
`students × documents`, and most of them will never be downloaded. A new
student adds another entry; a re-ingest or a token-secret rotation invalidates
existing copies. Ingest also runs as a separate CLI outside the service; it
should not spend its time stamping files nobody asked for.

### The honest trade-off

The source PDF may contain a text layer. The SVG reader has glyphs as vector
paths, so there is nothing to select; the downloaded PDF is a normal PDF and
its text can be copied. That is inherent in giving the student a file. The
watermark is the control, not DRM: a copied PDF still carries the token that
resolves to one account. If copy-resistance matters more than offline/PC use,
do not enable this endpoint.

The downloaded file marks only page 1. A later page copied out of it carries
no token, so it cannot be traced to a reader; the first page still names the
account the file was issued to. This is the accepted trade-off for a lighter
handout, and it is why the SVG reader keeps the diagonal repeat on every page.

Source PDFs are admin-curated, not student uploads. Treat them as trusted
input. If that changes, strip JavaScript, launch actions and embedded files
before caching, or reject the file at ingest.

## 2. Efficiency model

### First download

Cost is proportional to page count and source bytes:

| Step | Cost | Notes |
| --- | --- | --- |
| session + entitlement | Redis read + cached student/document rows | same as the page route; ~1 Redis GET, DB only on cache miss |
| source check | `lstat` + path guard | `data/docs/<id>.pdf` |
| `pdfstamp` load | O(source bytes) | parses objects and the page tree |
| draw overlay | O(1) | one footer on page 1, appended as one stream |
| `pdfstamp` save | O(pages + source bytes) | writes the object graph |
| write cache | O(output bytes) | temp file then atomic rename |
| send | O(output bytes) | network dominates |

Memory is bounded by the source, not the JavaScript heap. On the development
box, the child peaked at about 15 MB for 2-300 page text PDFs and 43.5 MB for
a 20 MB source carrying a 20 MB embedded blob. The process is short-lived and
Node holds only paths, so the service's 600 MB cap is not the constraint it was
with `pdf-lib`'s 9-64 MB marginal JS heap per generation. The 20 MB case is
close to the 25 MB ingest ceiling, so two concurrent generations are still
bounded at under 100 MB.

### Cached download

The second request for the same reader, stamp revision, document version and
source bytes is:

```
stat(data/downloads/<docId>/<token>-s<stamp>-v<version>-<bytes>.pdf)
res.sendFile(...)
```

There is no stamp process, no source read, and no full-file buffer. The
server does a metadata lookup and streams the file. Range requests are handled
by `sendFile`; a resumed download starts where it stopped.

### Cache key

`<token>-s<stamp>-v<version>-<bytes>.pdf` has four jobs:

- **token**: one reader's cache entry can never be served to another reader.
  The token is stable for the reader (`watermarkToken` is deterministic), so a
  repeat download hits.
- **stamp**: bumped when the drawing changes (`STAMP_REVISION` in
  `src/services/library/pdf.ts`). A deploy that changes the layout must not
  serve a copy stamped the old way; old files stay until the seven-day sweep.
- **version**: a content change must not serve an old stamp. This only works
  if ingest actually increments the version.
- **bytes**: a cheap guard against a truncated or replaced source. It is a
  length, not a content hash: a same-size replacement can still collide.

The current ingest tool reads the previous row and writes
`previous.version + 1` (`src/tools/ingestLibrary.ts`), and
`upsertLibraryDocument` copies that value (`src/db/library.model.ts`). Keep
that invariant: a re-ingest that does not bump the version can serve the old
bytes. The `<bytes>` component is still a length, not a content hash, so a
same-size replacement made outside the ingest tool can collide. Use the ingest
tool, or add a source hash or mtime to the key.

A version bump leaves the old version's files behind until the 7-day sweep.
Delete the old versions for that document at ingest, or let the sweep do it.

### Cache growth

The cache is deliberately much smaller than the worst case. For
`students × documents` possible files:

| Students | Documents | Possible files | At 0.5 MB | At 1 MB | At 2 MB |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 50 | 5,000 | 2.5 GB | 5 GB | 10 GB |
| 500 | 50 | 25,000 | 12.5 GB | 25 GB | 50 GB |
| 1,000 | 50 | 50,000 | 25 GB | 50 GB | 100 GB |

A 512 MB cap holds roughly 1,024 files at 0.5 MB, 512 at 1 MB, or 256 at
2 MB, before filesystem overhead. That is 0.5-2% of the 50,000-entry
worst case. The 50-document column is illustrative; substitute the real
shelf count. The cache is a hot-path optimisation, not a copy of the library.

The realistic working set is much smaller because downloads are occasional.
For 1,000 students and 50 documents, if 10% of students download two
documents in a week, that is 200 entries. At 1 MB each, 200 MB, under the cap.
If 50% download two, that is 1,000 entries and about 1 GB, and the cap must
evict. These are planning assumptions, not measurements.

The 7-day TTL does two things: it removes watermarked copies that nobody is
using, and it bounds the damage from a stale version or an old token. The
current `isFresh()` uses the file's mtime and never touches it on a hit, so the
window is fixed from creation. `pruneDownloadCache()` runs from the daily
maintenance job (`src/services/maintenance.ts`), not hourly. Daily is enough
for a 512 MB cache; hourly only shortens the window for an abandoned file.

The cap is configurable with `LIBRARY_DOWNLOAD_CACHE_MB` (default 512,
`.env.example`). It is small compared with the disk the plan records (41 GB
free, `docs/LIBRARY.md` §5.1), so there is no reason to exceed it. Do not back
up `data/downloads`; it is regenerable and contains per-reader copies.

The sweep now removes dot-prefixed `.tmp` files older than an hour as well as
expired `.pdf` entries, so a crashed generation cannot keep a document folder
alive forever.

### Concurrency

The per-key in-flight promise in `ensureWatermarkedPdf()` stops two requests
for the same file from stamping twice. The stamp is a child process, so ten
different readers would still mean ten processes; the implementation therefore
has:

- at most 2 generations at once;
- a bounded queue of 8;
- waiters on the same key share the in-flight promise;
- a full queue answers `503` with `Retry-After`, never an unbounded fork.

Two concurrent 20 MB sources are about 87 MB of peak RSS, well under the
600 MB service cap. The limit is no longer protecting the Node heap, and the
event loop is free while the child works; it bounds CPU contention and disk
writes on the small VM. If the queue is regularly full, raise the limit after
measuring the server, not because the old memory reason still applies.

The binary is brief: about 0.6 ms for a 2-page source, 1.0 ms for 20 pages,
3.0 ms for 100 pages, 7.4 ms for 300 pages, and about 10.5 ms for a 20 MB
source on the development box. A 30-page unit is on the order of a
millisecond. That is small enough to run in the request path, and the cache
means most requests never run it at all.

## 3. Options considered

| Option | CPU | Memory | Disk | Security / traceability | Operational complexity | When it would be preferable |
| --- | --- | --- | --- | --- | --- | --- |
| **On-demand native stamp per reader + disk cache (chosen)** | O(pages) first time; ~0 cached | ~15 MB peak for text PDFs; ~2.1x source bytes for a 20 MB blob | One output per reader/document/version, capped at 512 MB (env-tunable) | Token on page 1; clean source stays server-side; cache is per reader | Medium: Rust binary, cache, lock, sweep | Default for a small library with modest PDFs and low concurrency |
| **Clean PDF + signed URL** | ~0 | ~0 | One source file | Signed URL protects the link, not the bytes; a forwarded file has no reader mark | Low | Public material, or a product where sharing is allowed; not this library |
| **Pre-generate every reader at ingest** | N × generation at ingest | N × generation peak | N × documents; combinatorial | Traceable, but every file exists whether used or not | High: new students, re-ingest, token rotation, cleanup | A tiny fixed cohort with a guaranteed download set and no new registrations |
| **Puppeteer / server-side PDF.js rasterisation** | High: browser layout or canvas per page | Hundreds of MB per Chromium plus page buffers | Large image pages | Traceable if stamped after render, but loses vector text and zoom | High: Chromium, sandbox, fonts, system packages | Rendering HTML that has no PDF source, or producing page images for a non-PDF viewer |
| **Ghostscript/qpdf overlay of a per-reader watermark PDF** | Low to medium: C tools | Low | Small one-page overlay + output | Traceable; same token | Medium-high: extra system package, command-line quoting, version differences | A fallback if the custom binary cannot be maintained; qpdf remains another apt package and another PDF parser to trust |
| **Serve the SVG pages zipped** | Low: zip | Low | Reuses `data/pages` | Per-page mark only if zipped per reader; not a PDF | Low-medium: zip endpoint, MIME handling | An offline HTML/SVG bundle is the goal; it is not a PDF and is poor for print/share |

Notes on the rejected rows:

- **Clean PDF + signed URL** is the simplest to operate, but it throws away the
  only deterrent the library has. A signed URL can also be shared during its
  lifetime.
- **Pre-generation** is not just disk: it makes ingest slower, makes every new
  student a special case, and leaves stale copies after a version bump. The
  512 MB cap would be consumed by files nobody requested.
- **Puppeteer/PDF.js** is the right tool when the source is a web page. Here
  the source is already a PDF. Paying for a browser to draw text on it is
  strictly worse than appending a text stream.
- **qpdf/Ghostscript** is the fallback if the native binary ever becomes a
  maintenance problem. A hybrid can be cheaper than a custom writer: generate
  one small watermark overlay PDF per reader token (cache that), then use
  `qpdf --overlay` with a repeated overlay across the document. qpdf is fast
  and uses little memory, but it is another apt dependency and the command
  line must be built with `execFile` arguments, not a shell string.
  Ghostscript is heavier and has a larger attack surface; prefer qpdf if the
  overlay is enough.
- **Zipped SVG** is not a PDF. It does not open in a phone's PDF viewer, does
  not print predictably, and does not give the student one file. It is only
  interesting if the requirement is "offline HTML", which this is not.

## 4. Benchmark

Environment: Linux development box. This is not the production VM; use the
ratios and the memory shape, not the absolute milliseconds, for capacity
planning. The expected corpus is kilobytes to a few megabytes per source PDF
(the Bot API cap in `docs/DOCUMENTS.md` is 20 MB).

### Head-to-head (2026-11-20)

Same sources. The old path draws the full per-page mark; the new path draws
one footer on page 1. "Old cold" is the first stamp in a fresh Node process,
which is what a restarted service pays on its first download. "Old warm" is
pdf-lib's steady state in one process, median of the last seven of nine runs.
"New" is `bin/pdfstamp` invoked from Node, so it includes process spawn and
binary startup; median of five runs. Peak RSS for the old path is marginal
over a Node + pdf-lib baseline of 59.4 MB; for the new path it is the child
process peak. Warm page cache, Linux development box.

| Source | Old cold | Old warm | New | Speedup | Old marginal RSS | New peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 pages (2.8 KB) | 15.4 ms | 1.9 ms | 0.6 ms | 3.1x | 13.7 MB | 14.8 MB |
| 20 pages (22 KB) | 29.4 ms | 7.0 ms | 1.0 ms | 6.8x | 20.4 MB | 14.8 MB |
| 100 pages (105 KB) | 85.4 ms | 35.9 ms | 3.0 ms | 12.1x | 67.3 MB | 14.8 MB |
| 300 pages (313 KB) | 174.6 ms | 104.3 ms | 7.4 ms | 14.1x | 110.2 MB | 14.8 MB |
| 20 MB source (60p + 20 MB attachment) | 68.0 ms | 41.8 ms | 10.5 ms | 4.0x | 71.0 MB | 43.5 MB |
| Real 55-page / 1.4 MB PDF | 49.6 ms | 23.3 ms | 3.1 ms | 7.5x | 37.8 MB | 14.8 MB |

The comparison is conservative: the old columns start their timer after Node
and pdf-lib are loaded, while the new column includes spawning the binary
every run.

The synthetic sources are A4 PDFs with 40 lines of Helvetica text per page;
the heavy case embeds 20 MB of random bytes, and the real case is
`/usr/share/doc/glm/manual.pdf` (55 pages, 1.4 MB).

- **100-300 pages: about 12-14x faster.** Marginal memory drops from 67-110 MB
  to about 15 MB. This is the range that matters for a unit handout and for
  the 600 MB service cap.
- **A 20 MB source: 4.0x faster**, 71 -> 43.5 MB. The source bytes dominate;
  the child peaks at about 2.1x the file size.
- **A real 55-page PDF: 7.5x faster**, 37.8 -> 14.8 MB.
- **Tiny documents: 3.1x faster**, but memory is a wash (14.8 MB child against
  13.7 MB marginal) because the Rust process has a fixed ~15 MB floor. The win
  is at scale.
- The overlay adds about 1.7 KB once, on page 1. The footer uses the same
  font, size, position and opacity as before; the diagonal repeat and the
  later-page footers are gone.

### Historical pdf-lib baseline (2026-11-08)

Kept as the original decision record. Node v26.13.0, `pdf-lib` 1.17.1 from the
repository. Its fixtures (31 lines plus a vector figure) and its method differ
from the head-to-head above; compare columns within one table, not across
tables. The overlay used Helvetica-Bold, a standard PDF font that is not
embedded. Embedding a custom font would add a one-time subset to each output
but would not change the page-count scaling. The script matched the old
`src/services/library/pdf.ts`: `PDFDocument.load(source, { updateMetadata:
false })`, `pdf.save()` with pdf-lib defaults, and the same diagonal/footer
coordinates.

The 2026-11-08 harness lived in `/tmp/opencode/pdf-bench` and was not
committed:

- `make-sources.cjs`: synthetic A4 PDFs with 2, 20 and 100 pages; each page has
  31 lines of Helvetica text and a simple vector figure.
- `stamp-bench.cjs`: loads a source, draws the same overlay geometry as
  `src/services/library/pdf.ts` (three diagonal token rows at 5% opacity,
  footer at 42%, bottom-origin coordinates), saves, and writes the output.
- `cache-bench.cjs`: hot-cache `stat` and `stat + readFile`.
- `send-bench.cjs`: loopback Express `res.sendFile`, with a `Range` request.

Each generation runs in a fresh Node process. "Peak RSS" is the process
`maxRSS` from `process.resourceUsage()`; it includes the roughly 63 MB Node
baseline. "Marginal RSS" is the process RSS after generation minus before.
Three runs per size; the table reports medians and, for time, the range.

### Generation

| Pages | Source bytes | Median generation (ms) | Range (ms) | Output bytes | Peak RSS (MB) | Marginal RSS (MB) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 5,302 | 14.8 | 14.5-15.0 | 6,371 | 73.5 | 9.3 |
| 20 | 46,508 | 26.4 | 26.2-26.8 | 55,386 | 82.4 | 18.4 |
| 100 | 229,814 | 72.2 | 72.0-72.5 | 274,869 | 114.7 | 50.4 |
| 100, with images | 1,220,093 | 78.5 | 66.0-79.9 | 1,264,662 | 127.8 | 63.7 |

The "with images" row is a supplementary case, not one of the three required
sizes: 100 pages with eight embedded JPEG/PNG figures, about 1.2 MB of source.
Its first run was the fast outlier (66.0 ms, 52.4 MB marginal RSS); the next
two runs were 79.9 and 78.5 ms with 63.7 and 64.8 MB. The extra memory is
consistent with image decoding, but three runs are not enough to separate that
from JIT noise. Treat that row as a shape, not a precise number.

Breakdown of the median time:

| Pages | Load (ms) | Draw overlay (ms) | Save (ms) |
| ---: | ---: | ---: | ---: |
| 2 | 7.7 | 1.8 | 5.2 |
| 20 | 10.0 | 4.5 | 11.7 |
| 100 | 20.7 | 14.5 | 36.8 |

`save` is the largest share. The overlay itself is cheap: about 14.5 ms for
100 pages, or 0.15 ms per page. Output is roughly 2.7-2.8 KB per page for the
20- and 100-page text files (the 2-page file carries fixed overhead); the
overlay adds roughly 0.45 KB per page. A 30-page unit is therefore on the
order of 80 KB of output.

Noise: the 2-page total varied by about 3%, the 20-page by about 2%, the
100-page text by under 1%, and the image case by about 18% because its first
run was much faster and lighter than the next two. Peak RSS varied by about
1 MB on the 2-page and 100-page text cases, under 1 MB on the 20-page case,
and about 12 MB on the image case. Treat these as order-of-magnitude numbers,
not a service-level guarantee.

### Cached send

`cache-bench.cjs` warms the filesystem cache, then runs 50 iterations. Times
are milliseconds.

| Output | `stat` median | `stat + read` median | `sendFile` loopback median (p95) | Range result |
| --- | ---: | ---: | ---: | --- |
| 2 pages, 6,371 B | 0.002 | 0.009 | 0.44 (0.56) | `206`, `bytes 0-1023/6371` |
| 20 pages, 55,386 B | 0.002 | 0.022 | 0.43 (0.50) | `206`, `bytes 0-1023/55386` |
| 100 pages, 274,869 B | 0.002 | 0.090 | 0.75 (1.15) | `206`, `bytes 0-1023/274869` |
| 100 pages, 1,264,662 B | 0.003 | 0.328 | 1.14 (2.95) | `206`, `bytes 0-1023/1264662` |

The loopback send includes HTTP and Node, but no TLS, nginx or real network.
The useful conclusion is structural: the cached path is under 1.2 ms on
loopback and is dominated by the actual transfer. The `Range` probe returned
`206` with the expected `Content-Range`, so `sendFile` is doing the right
thing for a PDF viewer or a resume.

The first download of a 100-page text PDF is about 3 ms of stamping and
15 MB of peak RSS. A repeat download is a stat and a send. That is the
efficiency case for the cache.

## 5. Recommendations

1. **Bound generation, not just the cache.** Keep the per-key in-flight
   promise and the global semaphore of 2 with a bounded queue; the queue-full
   path answers `503`/`429` with `Retry-After`. Reject source PDFs over a sane
   ingest limit (the existing Bot API cap is 20 MB, `docs/DOCUMENTS.md`; a
   page-count limit is also useful). The binary bounds a text stamp at about
   15 MB and a 20 MB source at about 44 MB; the queue still matters because it
   bounds the number of processes, not because of a JavaScript heap.

2. **Make the cache accountable.** The 512 MB cap is currently enforced by
   the daily sweep, not on write, so a burst can exceed it until the next run.
   Check the budget on write (or run the sweep after a generation) as well as
   keeping the 7-day sweep. The maintenance job runs daily at boot and every
   24 hours; hourly is optional but shortens the window for abandoned files.
   Record cache entries, cache bytes, hit rate, generation p50/p95, queue
   depth and generation failures. Alarm at 80% of the cap or when p95
   generation is over about 2 seconds. Keep the ingest version bump that is
   now in `src/tools/ingestLibrary.ts` (`previous.version + 1`); without it a
   re-ingest can serve the previous cache file. Keep the `.tmp` age sweep as
   well: a crashed generation must not block empty-directory cleanup.

3. **Use `sendFile` for both paths, and keep the server cache authoritative.**
   `res.download` for an attachment, `res.sendFile` for inline PC preview.
   Both support Range, so a PDF viewer or a resumed download does not fetch
   the whole file again. The current route sets `private, max-age=3600` with
   `Vary: Cookie`, which matches the one-hour `noteDownload()` dedupe; keep
   that, or switch to `private, no-store` if every click must produce an
   audit row. Always set `nosniff` and
   `Cross-Origin-Resource-Policy: same-origin`.

When to reconsider the path:

- the native binary cannot be maintained, or a target platform without Rust
  1.88+ must run the service;
- the source needs linearising, repair or active-content stripping that a
  full PDF tool does better;
- a measured document still makes the two-generation queue overflow, or the
  binary's peak RSS on the real corpus is out of budget.

qpdf/Ghostscript is the fallback, not the next step. The hybrid: generate and
cache a one-page overlay PDF per reader token with any PDF writer, then use
`qpdf --overlay` with a repeated overlay on the source. Benchmark it against
`bin/pdfstamp` before adding the package. Ghostscript only if qpdf cannot do
the job.

What not to do:

- Do not pre-generate a PDF for every student at ingest. It is combinatorial,
  mostly unused, and stale after the first version bump.
- Do not serve the clean source or a signed clean URL. The file is
  untraceable once it leaves the box.
- Do not put whole PDFs in Redis. Redis is for sessions and small counters;
  binary documents belong on disk with a TTL and a size cap.
- Do not rasterise or use a browser for a source PDF. It costs memory and CPU
  and loses vector quality.
- Do not generate inside an unbounded `Promise.all`. Queue it.
- Do not log the session cookie or the one-time PC token. Journal queries stay
  keyword/count-only.
- Do not serve `data/downloads` from a static mount. It is private,
  per-reader data.

## 6. PC access note

PC access is a one-time bot link that mints the same `nbq_lib` cookie the
Telegram mini app uses. It is not a second account system.

Current flow:

1. A student runs `/library` in private. `sendLibraryEntry()` in
   `src/bot/commands/library.ts` checks `canOpenLibrary`, mints a 32-byte
   random token, stores it in Redis as `lib:pc:<token>` with a 5-minute TTL,
   and adds an "Open on this computer" button. The link is
   `...?page=library&pc=<token>`. Groups never get the button.
2. The app reads `pc` once (`src/web/src/AppShell.tsx`) and immediately
   removes it from the address bar. A presented PC token wins over an existing
   cookie: a shared browser must not keep the previous account's shelf. It
   POSTs `{pcToken}` to `POST /api/library/session`. With no credential, it
   uses `GET /api/library/me` and the existing cookie.
3. The server calls `consumePcLoginToken()`, which uses Redis `GETDEL`: the
   first exchange gets the user id, the second gets `null` and `401`. It does
   not fall back to `initData` when the PC token is bad. It then checks
   `canOpenLibrary`, calls `createSession(userId, {kind:"pc", ttlSeconds:3600})`,
   and sets `nbq_lib`: `httpOnly`, `secure` in production,
   `sameSite=none` + `partitioned` (so Telegram Web's iframe can send it back;
   local http dev uses `lax`), `path=/`, one-hour `maxAge`. A Telegram session
   remains 12 hours.
4. The app clears the spent token from React state after success, so a tab
   switch or remount does not present it again; the cookie is the session. The
   shelf shows "Signed in on this computer" with a sign-out that calls
   `DELETE /api/library/session`.

Rules:

- The one-time token is not a session. It cannot fetch a page or a download.
  Replaying it returns `401`.
- The PC session has exactly the same entitlements, the same watermark token
  and the same download cache as the Telegram session. Do not add a "PC user"
  branch to `requireSession` or `requireReadableDocument`. Entitlement is
  checked from the same student context; the watermark is still
  `watermarkToken(userId)`.
- The cookie is a bearer. Treat it like the Telegram session: server-side
  Redis, revocable with `dropSession`, no refresh token, no permanent login.
  If it is stolen, it is valid until expiry or logout. A PC session is one
  hour, marked `kind: "pc"`, and the shelf offers "Signed in on this computer —
  sign out" so the next person on a shared machine does not inherit the shelf.
- The link is single-use and short-lived, but whoever opens it first gets the
  session. That is why it goes only to a private chat, and why it expires in
  five minutes.

Three things to tighten before this is a public surface:

1. **The token still rides in the initial query string.** `?pc=<token>` is in
   the first request, so it can appear in nginx access logs. The app removes
   it from the address bar immediately, the token is single-use for five
   minutes, and the library HTML sends `Referrer-Policy: no-referrer`. If the
   access log records `$request`, configure it to redact `pc` or move to a
   fragment/code exchange. This is the remaining PC-access caveat.
2. **Fixed: the client now presents the PC token first.** A stale cookie from
   another account no longer wins. The spent token is cleared from React state
   after success, so a tab remount uses the cookie and does not replay it.
3. **Minting is now gated** by the bot's per-user 10/minute handler, and the
   session exchange limiter keys a PC hand-off by a hash of the token instead
   of the campus NAT address. The token itself is never logged.

The session cookie is `nbq_lib` (`src/services/library/session.ts`):
`LIBRARY_SESSION_TTL_SECONDS = 12 * 60 * 60` for Telegram, while a PC session
uses `LIBRARY_PC_SESSION_TTL_SECONDS = 60 * 60` and a visible sign-out.
