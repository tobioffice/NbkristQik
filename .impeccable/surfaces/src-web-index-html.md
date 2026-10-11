---
version: 1
slug: "src-web-index-html"
primary_target: "src/web/index.html"
related_targets: ["src/web/register.html","src/web/report.html","src/status/index.html","src/api/adminPanel.ts"]
---

# Surface brief — NbkristQik redesign

## Scope and visitor mode

Five surfaces of one product ship one committed world. All Operate except the status page (Read/Operate):

- **Leaderboard mini app** (primary target): `src/web/index.html` → `src/web/src/Leaderboard.tsx`, `App.tsx`, `components/*`. Students on a phone inside the Telegram webview.
- **Register/profile mini app**: `src/web/register.html` → `ProfileApp.tsx`, `views/Profile.tsx`.
- **Issue report mini app**: `src/web/report.html` → `ReportApp.tsx`.
- **Status page**: `src/status/index.html` (single static file).
- **Admin panel**: `src/api/adminPanel.ts` + `admin/panel.css.ts` + `admin/panel.js.ts` (server-rendered vanilla HTML/CSS/JS).

## Audience, job, content

Students: read their own rank in seconds, see the field around them, and find where the 75% minimum falls; filter year/branch/section, search by roll, sort attendance/mid-marks. Admin (desktop): activity, reports, and service health at a glance. Real data only: portal attendance, mid marks, roll numbers, usage events, reports — no fabricated claims.

## Constraints

- Behavior, hooks, API calls, state machines, accessibility, and copy survive; presentation/restructure only.
- Delivery mechanisms are fixed per surface (Vite+React+Tailwind; single static HTML; server-rendered vanilla panel).
- All wall-clock times IST, 12-hour AM/PM. Mobile-first, fast, legible one-handed.
- The register metaphor stays intentional, never costume: paper structure, ruled lines, ink accents on a working table.

## Chosen direction — The Attendance Register

Cloth-bound register page: manila paper ground, ink navy text, cloth-green head band, red-ballpoint rule. Memorable moment: the 75% minimum drawn live across the list in red ink, the viewer's own entry bracketed in the margin. Approved composition: `.impeccable/mocks/decision/model-pick.html`.

## Unresolved decisions

None.

## Direction contract

THESIS: The leaderboard is the class register itself, run as a working table: real ranked rows ruled like a register page, with the 75% minimum drawn across the list in red ballpoint — the line every student already knows. It refuses the category's glass-card feed and the dark gradient shell.

OWN-WORLD: Manila paper (#E7DCC3) ground, ink navy (#1E2A38) text, cloth green (#3F6457) head band, red ballpoint (#C33B2E). Squared forms, hairline rules, tracked uppercase column heads, tabular numerals, red-ink corrections below minimum. Components: band, stamped tabs, ruled field cells, entry rows, margin bracket, stamp.

STORY: A student sees where they stand in seconds — their own entry bracketed in the margin with rank and percentage, the field around them, and exactly where the 75% line falls; the admin reads a clean ledger of activity, reports, and health. Sorting, filtering, and search stay standard controls.

FIRST VIEWPORT (390×844): Cloth band with wordmark and students-on-record. Viewer entry strip (#47 of 1,248 · 23BQ1A05Y3 · 76.4%) with margin bracket. Stamped tabs: Attendance / Mid marks. Search field plus three ruled filter cells. Three merit entries for the top ranks. Ruled rows begin, the red 75% rule drawn between the last confirmed row and the first row below it.

FORM: The Attendance Register — position 1 on the grounded list (Impeccable's pick; the roll assigned The Reservation Chart). Code-led build matching the approved sketch at `.impeccable/mocks/decision/model-pick.html`; seed hand f7362319b9fb787a, digest cc9059a337a0aad0.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
