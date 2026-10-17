# Academic Documents Plan

Webapp-exclusive library of subject materials and solved assignments.
Students read inside the Telegram mini app only. Files are never
forwarded in chat and there is no download button.

## Content model

Two types, one storage shape: a single PDF per subject.

- **Subject material.** One full-subject PDF. Small by construction, so one
  file per subject stays easy to organise. Chapters are *not* separate
  files; the chapter map lives in metadata (chapter title + start/end page
  using the PDF's own page numbers, not printed numbers) and the viewer
  renders only that chapter's page range.
- **Assignments.** One evolving PDF per subject. New chapters are appended
  at the end (roughly one a month), so earlier chapters' page numbers never
  move and each update only needs the new chapter's range. Each handoff
  replaces the previous file reference; old versions stay in the storage
  channel as implicit backup, one pointer-flip away if a swap ever renders
  wrong.

## Storage

Telegram is the file store. A private storage channel holds every PDF;
SQLite holds `file_id` + metadata only, so the database and nightly
backups stay tiny.

- Bot API download cap is 20 MB per file. Typeset assignment PDFs are
  kilobytes; reject anything over the cap at ingest with a "split it"
  message.
- Old versions accumulate in the channel for free (version history without
  building versioning). The live pointer is one row per subject + type.

## Metadata (registry)

- `documents`: subject, branch, sem/year, type (material | assignment),
  `file_id`, file size, page count, live version number.
- `chapters`: document reference, chapter number, title, start page,
  end page, status (`live` | `coming_soon`).
- Subject + type is unique: an update swaps the reference, never piles up.
- Subjects go live incomplete: one chapter is enough. Missing chapters
  render a plain "not out yet" placeholder, and a new chapter flips live
  with no rework.

## Viewer (mini app only)

- Subjects → chapters → material pages (PDF.js on `<canvas>`, page range
  from metadata) plus the assignment section for that chapter.
- One search box across subjects, chapters, and (later) extracted text.
- Anti-download, honestly scoped: canvas rendering (no browser save
  button), no file URL in the UI, short-lived signed URLs bound to the
  reader, no right-click menu. This stops casual downloads. Screenshots
  can't be stopped by anyone, so every page is watermarked with the
  reader's Telegram user ID: the real deterrent, and a leaked photo points
  straight at an ID that can be banned.
- All reads happen on our pages, which is where ad impressions live.

## Serving

- Express proxy endpoint, authenticated with Telegram WebApp `initData`
  (same pattern as the existing profile API). The bot token never reaches
  the frontend.
- Small disk cache on the server keyed by `file_id`, hard-capped with
  least-recently-used eviction. Hot subjects serve from disk; a new
  version naturally misses cache because the file ID changes.

## Ingest workflow (manual curation)

The admin picks the best source, OCRs, fixes errors, patches diagrams,
and hands over the finished PDF. No auto-publishing, no crowdsourced
intake in v1.

1. Admin creates the private storage channel once and adds
   `@NbkristQik_bot` as admin with post rights.
2. Per handoff: the PDF + subject + sem/branch + type + chapter map
   (title + start/end page per chapter, new or moved ranges only).
3. Placement: file goes to storage, metadata pointer swaps (version+1),
   rendered pages verified against the ranges, confirmation back with
   what's live and what's still coming.

## Rollout

- Pilot: one subject end to end before scaling.
- Each new chapter landing is a ready-made channel announcement
  ("Chapter 4 solved assignments are up") pulling students back into the
  webapp.
- Later, if volume demands it: OCR assist on intake, full-text search
  over extracted text, new-chapter notifications to interested students.

## Open questions

- Pilot subject?
- Handwriting vs printed mix in source photos (sets how much correction
  each file needs)?
- Reviewers beyond the admin, now or later?
- Roll-number watermark from day one? (Decided: watermark with the
  Telegram user ID instead, stable across semesters and directly bannable.)
