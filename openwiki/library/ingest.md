---
type: reference
title: Catalogue and Document Ingest
description: How the library shelf is filled — the committed syllabus catalogue snapshot and its parser, the PDF-to-SVG vectoriser, the ingest tool that registers a document, and the tool that resolves a watermark token back to a student.
tags: [library, ingest, pdf, svg, catalogue, tooling]
sources:
  - id: openwiki-source-eaaf07baf60ac6e8709e1bbb
    resource: repo://data/syllabus-catalog.json
  - id: openwiki-source-d8f4ef95037cfc439dd1d89d
    resource: repo://src/db/library.model.ts
  - id: openwiki-source-10c65da185d300a2891bac91
    resource: repo://src/services/library/catalog.ts
  - id: openwiki-source-93f5087b498e326c58cc1fa0
    resource: repo://src/services/library/paths.ts
  - id: openwiki-source-e3305d453b7428aea67b6cc4
    resource: repo://src/services/library/vector.ts
  - id: openwiki-source-e9b157817dec0321b67b1935
    resource: repo://src/tools/ingestLibrary.ts
  - id: openwiki-source-e368519504e11db0d8dda514
    resource: repo://src/tools/resolveWatermark.ts
  - id: openwiki-source-5b055f41b1f7a12b1eef76c7
    resource: repo://src/tools/syncSyllabusCatalog.ts
generated: { by: "opencode", at: "2026-10-24T11:00:48.405Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-24T11:00:48.405Z
---

# Catalogue and Document Ingest

Nothing is scraped at request time. The shelf is built offline in three steps — catalogue, PDFs, registry — and the running app only reads the results.

## The syllabus catalogue

`data/syllabus-catalog.json` is a committed snapshot of the college's own syllabus pages (`https://at.nbkrist.org/Syllabi/showSyllabi.php?dept=CSE`). It is the map from "a student in year Y, semester S, branch B" to "the subjects that student has", keyed by the college's subject codes so the join to our documents is exact and never a title match.

`syncSyllabusCatalog` (`src/tools/syncSyllabusCatalog.js`, run as `node dist/tools/syncSyllabusCatalog.js [dept…]`) fetches the departments it is given (all nine by default), parses them with `buildCatalog`, writes the snapshot to `LIBRARY_CATALOG_PATH` (default `data/syllabus-catalog.json`) and prints what landed. Because the snapshot is committed, the request path never touches the college site.

`catalog.ts` reads the snapshot once and caches it for the process lifetime, logging a warning when the file is missing so the library shows an empty shelf instead of failing. It answers three questions: which regulation a student follows (`regulationForEntryYear`: R23 from 2023, R20 from 2020, R19 for 2019, R17 from 2017, otherwise R13), the entry year encoded in a roll (`entryYearFromRoll`: `23CS1042` → 2023), and the college site's department folder for a portal branch id (`siteDeptForBranch`, an explicit map because the names differ — the portal says `AI_DS`, the site says `AIDS`).

`syllabusParser.ts` does the parsing: it reads each year-sem block, classifies subjects as `core`, `elective`, `honours`, `minor` or floating by their code (`kindForCode`), and builds the nested `departments → regulation → yearSem` structure typed in `library/types.ts`.

## The vectoriser

`vectorisePdf` (`src/services/library/vector.ts`) turns a PDF into `p001.svg`, `p002.svg`, … with Poppler's `pdftocairo`, one SVG per page:

- `pdfinfo` gives the page count, which bounds the render loop. Poppler's SVG backend writes every page into one document unless asked for a single page, so the loop runs `pdftocairo` once per page.
- Pages are rendered into a scratch folder and moved into place only after the whole run succeeds, so a failed run never leaves half a document for a reader to stumble into.
- A missing `pdftocairo` is reported as an instruction ("install poppler-utils and run the ingest again"), not as a raw `ENOENT`.

SVG is a deliberate choice: the watermark can be drawn into the page with plain string work (no raster compositing, no native image library, no swap), and the page stays sharp at every zoom on a phone. `hasVectoriser` lets the tool warn before it starts.

## The ingest tool

`ingestLibrary` (`node dist/tools/ingestLibrary.js --file … --code … --unit … --dept … --year-sem …`) does four things in order:

1. **Checks the code against the catalogue** — a document can never land under a code the students will not see.
2. **Copies the PDF to `data/docs/`** — the store of record. The PDF is never served.
3. **Renders every page into `data/pages/<id>/`** through the vectoriser.
4. **Records the document** with `upsertLibraryDocument`, which sets `page_count`, `bytes`, `status` and `version`.

`LIBRARY_DATA_DIR` moves the whole tree, which is what tests and a second instance use. `paths.ts` builds every path (`data/docs`, `data/pages/<id>`, `pNNN.svg`) so no module assembles one by hand.

## Resolving a watermark

`resolveWatermark` (`node dist/tools/resolveWatermark.js NBK-7F3A-2C19` or `--user <telegram id>`) closes the loop on the watermark: given a token from a leaked or photographed page it looks the reads up in `library_reads` and prints the students and documents behind it, with the registration and student record where they still exist. Given a Telegram id it prints that reader's token instead, which is what you need when comparing a page against a suspect.

## Related pages

- [Library Subsystem](overview.md)
- [Library API and Session](api.md)
- [Deployment and Operations](../operations.md)
