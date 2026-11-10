---
name: NbkristQik
description: A college attendance register you read on your phone, inside Telegram.
colors:
  paper-sheet: "#e7dcc3"
  paper-raised: "#efe5cd"
  paper-bright: "#f6efdd"
  ink-navy: "#1e2a38"
  ink-soft: "#5a5140"
  ink-faint: "#675d4b"
  cloth-green: "#3f6457"
  cloth-deep: "#33544a"
  ballpoint-red: "#c33b2e"
  ballpoint-red-text: "#a62f22"
  marking-amber: "#8a6a12"
  marking-amber-text: "#6e5410"
  pass-green: "#2f5c46"
  hairline: "rgba(30, 42, 56, 0.2)"
typography:
  display:
    fontFamily: "Zilla Slab, Roboto Slab, Georgia, serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "0.01em"
  body:
    fontFamily: "Public Sans, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  data:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    fontFeature: "tnum"
  label:
    fontFamily: "Public Sans, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.16em"
rounded:
  sharp: "1px"
  cell: "2px"
  ring: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "44px"
components:
  button-ink:
    backgroundColor: "{colors.ink-navy}"
    textColor: "{colors.paper-bright}"
    rounded: "{rounded.cell}"
    padding: "12px 22px"
  button-ink-hover:
    backgroundColor: "{colors.cloth-green}"
    textColor: "{colors.paper-bright}"
    rounded: "{rounded.cell}"
    padding: "12px 22px"
  button-outline:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.cell}"
    padding: "12px 22px"
  band:
    backgroundColor: "{colors.cloth-green}"
    textColor: "{colors.paper-bright}"
    padding: "17px 16px 14px"
  field:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.cell}"
    padding: "11px 12px"
  entry-strip:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink-navy}"
    padding: "11px 14px 11px 23px"
  register-row:
    backgroundColor: "{colors.paper-sheet}"
    textColor: "{colors.ink-navy}"
    padding: "10px 16px"
---

# Design System: NbkristQik

## Overview

**Creative North Star: "The Class Register, Open on the Desk."**

The product is the college's cloth-bound attendance register, run as a working table. Manila paper is the ground; a single cloth-green band binds the head; rows are ruled like a register page; the teacher's red ballpoint marks what matters — the 75% line, stamps, corrections. Nothing floats in glass, nothing glows: structure comes from hairlines and ink.

Typography carries the register's two voices: Zilla Slab, a printed-form serif for heads and numbers read off the master page, and Public Sans, a form-and-data workhorse for everything read in a corridor between classes. Figures are tabular everywhere they can be compared, so columns align the way a register's do.

The world serves the task, never the reverse: navigation, search, filters, and sorting are the platform's standard controls wearing the register's ink. The metaphor is carried by type, palette, density, and one signature move — the red 75% rule drawn across the list with the viewer's own entry bracketed in the margin.

**Key Characteristics:**
- Paper ground (#e7dcc3) with one cloth-green (#3f6457) head band per surface.
- Ruled rows, not cards: 1px hairline rules, 1.5px ink head rules, squared corners (1-2px).
- Red (#c33b2e / #a62f22) reserved for the 75% threshold, stamps, and corrections.
- Tabular numerals on every rank, roll, percentage, count, and clock time.
- Functional micro-labels: uppercase, tracked 0.14-0.22em, never under 11px.
- All wall-clock times IST, 12-hour AM/PM.

## Colors

A restrained, warm palette of paper and ink with one marking pen.

### Primary
- **Cloth Green** (#3f6457): the register's binding. Head bands, active nav fills on the admin top bar, uptime ticks, pass states. Deep shade **Cloth Deep** (#33544a) is the desk ground behind the desktop sheet and the admin band's bottom rule.

### Secondary
- **Ballpoint Red** (#c33b2e, text-safe **#a62f22**): the teacher's pen. The 75% rule, below-minimum figures, the YOU stamp, the viewer's margin bracket, focus rings, fresh-activity cues, and service-down ticks — never decoration, never a background field.

### Tertiary
- **Marking Amber** (#8a6a12, text-safe **#6e5410**): degraded states, answered tickets, check-in series in charts, fresh live rows. **Pass Green** (#2f5c46): confirmed/resolved/operational states.

### Neutral
- **Paper Sheet** (#e7dcc3): the page ground of every register surface. **Paper Raised** (#efe5cd): entries, fields, tabs, stamps, toolbars. **Paper Bright** (#f6efdd): sheets and drawers that lift off the ground (admin drawer, tooltips, the desktop sheet).
- **Ink Navy** (#1e2a38): primary text and rules. **Ink Soft** (#5a5140): secondary text (roll numbers, labels, hints). **Ink Faint** (#675d4b): placeholders and tertiary metadata — the lightest tone that still clears 4.5:1 on paper.
- **Hairline** (rgba(30,42,56,0.2)): row rules; 0.45 alpha for stronger separators.

### Named Rules
**The Red Pen Rule.** Red is correction ink: threshold rules, stamps, below-minimum figures, down states. It never paints a background, never decorates, and never marks something that is fine.
**The Cloth Band Rule.** One cloth-green field per surface, at the head, carrying the wordmark and at most one stamp. It is the register's binding, not a utility bar.

## Typography

**Display Font:** Zilla Slab (with Roboto Slab, Georgia fallbacks)
**Body Font:** Public Sans (system-ui fallback stack)
**Label Font:** Public Sans, uppercase tracked

**Character:** A printed-form serif over a government-form grotesque: institutional without being cold, exact with figures, at home at 11px and at 34px.

### Hierarchy
- **Display** (600, 24px band wordmark / clamp(34-44px) issue ids, line-height 1.05): register heads and the big printed numbers read off the master page.
- **Headline** (600, 17-22px): admin section heads and form titles.
- **Title** (600-700, 14.5-16px): row names, scores, entry rank.
- **Body** (400-500, 13-15px, measure 40-46ch in forms): lists, notes, descriptions.
- **Data** (700, 16-27px tabular): every comparable figure — ranks, percentages, counts, uptimes.
- **Label** (600-700, 11px, 0.14-0.22em, uppercase): column heads, states, counters, stamps.

### Named Rules
**The Tabular Register Rule.** Any figure that can be compared uses `font-variant-numeric: tabular-nums` and a right-aligned column. Columns align by their figures, not by luck.
**The Printed Label Rule.** Functional micro-labels never drop below 11px and never run tracked body text above 0.05em. Tracking is for short uppercase labels only.

## Layout

Phone-first single column, full-bleed on the sheet. At 720px and up the register sits as one 560px centered sheet on the cloth-deep desk; the admin panel becomes a full-width paper workspace (main capped at 1060px) under its cloth band. The leaderboard's row grid is fixed and narrow — rank 38px, roll 94px, name 1fr, score 62px — so the table scans identically on every phone. Rhythm: 4/8/16/24px in components, 44px between admin sections, more space above a heading than below it. Form controls on phones are 16px to prevent browser zoom.

### Named Rules
**The Sheet Rule.** Phones get the register edge to edge; desktops get one sheet on the desk. Never two overlapping panels, never a card grid.

## Elevation & Depth

Flat by default; hairlines and paper tone shifts carry structure. Shadows exist only for elements that genuinely float over the sheet: the desktop sheet on the cloth desk, the profile dock, and the admin drawer (which uses a border, not a shadow). No blur, no glass, no glow.

### Shadow Vocabulary
- **Sheet float** (`0 20px 44px -16px rgba(16, 24, 30, 0.55)`): the centered sheet on desktop and the status page.
- **Dock float** (`0 10px 22px -10px rgba(16, 24, 30, 0.45)`): the floating "My profile" tab.

### Named Rules
**The Hairline First Rule.** Before reaching for a shadow or a heavier border, reach for a rule. Structure is drawn, not elevated.

## Shapes

Printed-form geometry: square corners (1-2px on fields, buttons, stamps and cards; 1px on chips), 1-1.5px ink borders, and rules of 1px hairline / 1.5px structure / 2px threshold. Circles appear only as rank rings and status dots. Brackets are drawn marks — two 1.5px strokes forming `[` — at the viewer's entry, never a thick side border.

### Named Rules
**The Printed Form Rule.** Corners are square unless the shape is a ring or a dot. A 6px colored side stripe is a costume; a drawn bracket is a mark.

## Components

### Buttons
- **Shape:** square (2px radius), 1.5px ink border, 12px 22px padding, 14px/700 label.
- **Primary:** ink navy ground, paper-bright text; hover shifts to cloth green.
- **Secondary:** paper-raised ground, ink text; hover brightens to paper-bright.
- **Focus:** 2px ballpoint-red outline, 2px offset. Disabled: 40% opacity, no hover shift.

### Stamped Tabs
Two-up segmented control (1.5px ink border, shared divider); the selected side fills ink with paper text — a stamp impression, not a pill.

### Fields
Paper-raised ground, 1.5px ink border, 2px radius, 16px text; selects carry a 1px drawn chevron. Focus is the shared red ring; placeholders use ink faint (still ≥4.5:1).

### Register Row (signature)
A 45px ruled row: rank (tabular, ink soft) · roll (12px tabular) · name (14.5px/600, truncating) · score (16px/700 tabular with a small % unit). The viewer's row is bracketed in red at the left margin and stamped YOU (11px red outline stamp, tilted 2°). Below-minimum scores print in red ink.

### The 75% Line (signature)
A 2px ballpoint-red rule drawn once (steps(7, end), 340ms) between the last confirmed row and the first row below the line, labelled "75% — minimum requirement" in Zilla Slab with "below this line" tracked caps at the right. Attendance views only.

### Merit Entries
The top three as register heads: paper-raised entries, rank rings (red 2px for first, ink 1.5px for second and third), name in Zilla Slab, score in tabular Public Sans. Tied ranks on lower cards are struck through in red ink.

### Band
Cloth-green head with the wordmark (Zilla Slab 24px), an 11px tracked context line, and an optional stamp block (border 1.5px at 50% paper, value in Zilla Slab, label at 11px).

### App shell (index page and tab rail)

Every surface now lives on one sheet. The shell owns three things:

- **The band**, once per surface. A section cannot draw its own head; it publishes one figure into the band's stamp (`useBandStamp`), so the binding stays single.
- **The page head**: an 11px tracked eyebrow, a Zilla Slab 22px title, an optional 42-46ch note, and a 1.5px ink rule under all of it. Sections start here, never with a card.
- **The index page** (the app's cover): eyebrow, the register's title in Zilla Slab at `clamp(30-38px)`, one note, the viewer's own entry bracketed in red, then the section entries as ruled index rows — section number in Zilla Slab in a 34px margin, the entry title at 17px, a 12px explanation under it, a drawn chevron at the right. No icons in boxes, no card grid.

**Index tabs.** The foot of the sheet is a ruled rail of five tabs (Index, Ranks, Library, Profile, Issues). Each carries a 19px single-stroke icon over an 11px tracked label; the open tab fills ink with paper-bright text — a stamp impression, not a pill. The rail is full-bleed on phones and centred with the 560px sheet on desktop.

**The reader is the exception.** When a page is open, the reader takes the sheet and the band and tabs step away; a reading surface carries only its own head.

### Admin Ledger
Tables, feed rows, weights, and health ticks reuse the same rules: paper grounds, hairline rows, ink data, amber check-in series, cloth-green uptime ticks, and red pen for down states and fresh cues. The drawer is a paper-bright sheet with a 1.5px ink edge.

## Do's and Don'ts

### Do:
- **Do** keep rows ruled: 1px hairline rules between rows, a 1.5px ink rule under column heads.
- **Do** keep figures tabular and columns right-aligned; ranks, rolls, percentages, counts, uptimes, and clock times.
- **Do** keep the viewer visible: bracketed entry strip when ranks are known, bracketed row + YOU stamp in the list, bracketed strip on the app's index page.
- **Do** keep one band per surface: a section publishes a figure into the shell's stamp instead of drawing its own head.
- **Do** keep times IST 12-hour AM/PM everywhere, including tooltips.
- **Do** keep form controls at 16px on phones and focus rings 2px red at 2px offset.

### Don't:
- **Don't** use red as a background, gradient, or decoration; it is correction ink only.
- **Don't** introduce cards with rounded corners, glass blur, gradient text, or dark backgrounds — the discarded look is the anti-reference.
- **Don't** use emoji or unicode glyphs as icons; draw SVG in one stroke voice (1.5-2px, round caps).
- **Don't** use monospace faces; tabular Public Sans carries all data.
- **Don't** let functional labels fall under 11px or track body text above 0.05em.
