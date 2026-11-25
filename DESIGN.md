---
name: NbkristQik
description: A college attendance register you read inside Telegram. Fullscreen, dark, grouped rows, two blues.
colors:
  ground: "#1a2026"
  footer: "#111417"
  surface: "#212a33"
  surface-hover: "#293440"
  surface-active: "#2d3a47"
  text: "#ffffff"
  text-secondary: "#8794a1"
  text-tertiary: "#8494a3"
  placeholder: "#8a98a6"
  accent: "#4cb2ff"
  action: "#248bda"
  action-hover: "#207cc2"
  action-disabled-text: "#a6d8ff"
  danger: "#f88277"
  warning: "#ff9953"
  good: "#7ed176"
  checkbox-ring: "#838f9c"
  dropdown: "#2e3a47"
typography:
  body:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "20px"
  page-title:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: "30px"
  section:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: "24px"
  row:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "20px"
  description:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  label:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "18px"
  button:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: "18px"
rounded:
  group: "8px"
  field: "8px"
  button: "8px"
  sheet: "16px"
  pill: "20px"
  circle: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  band:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    padding: "8px 16px"
  row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "0"
    padding: "9px 14px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: "12px 14px"
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.text}"
    rounded: "{rounded.button}"
    padding: "12px 15px"
  pill:
    backgroundColor: "{colors.surface-active}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
---

# Design System: NbkristQik

## Overview

**Creative North Star: "The Telegram Utility, Open on the Phone."**

The Mini App is a working tool, not a website in a frame. It fills the screen the
way a native Telegram screen does: a dark ground, raised grouped rows separated by
a 1px gap, one band at the head, one flat tab rail at the foot, and two blues that
each mean one thing. Type is sentence case and quiet; the figures are tabular, so
ranks, rolls, percentages and page numbers line up the way a register's do.

The old paper register is retired. The Mini App, the admin panel and the public
status and stats pages all use the native surface described here.

**Status:** shipped. The Ranks, Profile, Issues, Library and Reader screens in
`src/web` follow this document, and so do the hidden pages: the question-paper
intake, the league board and roll verification (none has a tab of its own). The server-rendered admin panel
(`src/api/admin/panel.css.ts`) follows the same ground, surfaces, type and two
blues; its data tables take a wider column and a top nav because it is a desktop
operator console. The public status and stats pages (`src/status/index.html`,
`src/status/stats.html`) use the same ground, surfaces, type and two blues, with
their own page-specific layouts.

**Key Characteristics:**

- Fullscreen on phones, safe-area aware; a 720px reading column on desktop.
- Dark ground (`#1a2026`), raised surfaces (`#212a33`), 1px gaps showing the ground.
- Grouped rows: 8px outer radius, square rows, 42px minimum tap target.
- Sentence case everywhere; no tracked uppercase micro-labels.
- Two blues: `#4cb2ff` is the link/icon accent, `#248bda` is the filled action.
- Tabular numerals on every comparable figure.
- Red (`#f88277`) is danger and correction ink, never decoration.
- Flat chrome: no shadows except a PDF page on the reader's ground.

## Colors

| Token          | Value     | Use                                                         |
| -------------- | --------- | ----------------------------------------------------------- |
| Ground         | `#1a2026` | The content ground behind every group                       |
| Footer         | `#111417` | Outer ground; the 1px gap between rows, the rail's top edge |
| Surface        | `#212a33` | Rows, fields, the band, grouped panels                      |
| Surface hover  | `#293440` | Tappable rows and default buttons                           |
| Surface active | `#2d3a47` | The selected segment, the stamp pill, pressed rows          |
| Text           | `#ffffff` | Titles, row labels, values                                  |
| Text secondary | `#8794a1` | Descriptions, helper copy, metadata                         |
| Text tertiary  | `#8494a3` | Quiet secondary metadata                                    |
| Placeholder    | `#8a98a6` | Input placeholders                                          |
| Accent         | `#4cb2ff` | Links, icons, active tabs, trailing actions                 |
| Action         | `#248bda` | Filled primary buttons, unread badges, checked boxes        |
| Action hover   | `#207cc2` | Primary button hover                                        |
| Disabled text  | `#a6d8ff` | Disabled primary label                                      |
| Danger         | `#f88277` | Below-minimum scores, destructive text, the 75% rule        |
| Warning        | `#ff9953` | Answered tickets, degraded states                           |
| Good           | `#7ed176` | Confirmed, resolved, operational states                     |
| Checkbox ring  | `#838f9c` | Unchecked round checkbox border                             |
| Dropdown       | `#2e3a47` | Menus and popovers                                          |

### Named Rules

**The Two-Blue Rule.** `#4cb2ff` is never a filled button, and `#248bda` is never
body text, an icon, or a link. One hue is the pointer; the other is the action.

**The Danger Rule.** Red is text and rules, never a filled field. The 75% line, a
below-minimum score and a destructive label may be `#f88277`; a red button ground
is wrong.

**The Tabular Register Rule.** Any figure that can be compared uses
`font-variant-numeric: tabular-nums` and a right-aligned column: ranks, rolls,
percentages, counts, page numbers and clock times.

**The Flat Chrome Rule.** Structure comes from the surface tone shift and a 1px
gap, not from shadows or borders. The only shadow in the app is the page sheet in
the reader.

**The Sentence Case Rule.** Sentence case everywhere. No uppercase tracked
micro-labels, no `text-transform: uppercase`, no letter-spacing on body text.

## Typography

**Family:** Figtree, with `system-ui` and `sans-serif` behind it. The variable
font is vendored at `src/web/src/assets/fonts/figtree.woff2` under the SIL Open
Font License. It replaces Telegram's proprietary Product Sans: same rounded,
compact utility feel, legally shippable.

**Why Figtree:** the app needs a face that reads at 12px in a row description and
at 22px as a page title, with a friendly but neutral tone. Figtree's open forms
and tight cap height do that without the serif weight of the old register.

### Hierarchy

- **Page title** (700, 22/30): the one heading a screen opens with.
- **Section / band title** (600, 17/24): band wordmark and section heads.
- **Row title** (600, 15/20): names, subject titles, issue ids.
- **Row value** (600, 15/20 tabular): scores and counts that sit at the right edge.
- **Body** (400, 15/20): thread messages, notes, descriptions.
- **Description** (400, 12/16): row subtitles, helper copy, metadata.
- **Label** (500, 13/18): form labels, list captions.
- **Button** (700, 13/18 phone / 15/18 desktop).
- **Page eyebrow** (500, 12/16 secondary): the quiet kicker above a page title.

### Named Rules

**The Printed Label Rule is retired.** There are no all-caps tracking labels in
the Mini App. If a label needs to stand apart, use weight and the secondary
colour, not letter-spacing.

## Layout

### Phones

Full-bleed. The app requests Telegram fullscreen on iOS and Android; the band
absorbs `safe-area-inset-top + content-safe-area-inset-top`, and the tab rail and
bottom-sheet actions clear `safe-area-inset-bottom`. The sheet's minimum height is
`--tg-viewport-stable-height`. Nothing sits under the status bar or the home
indicator.

### Desktop

The app owns the window. There is no floating 560px sheet and no desk around it:
the surface is full width, and the band, page content, reader chrome and tab-rail
items share a 720px centred column. The band and rail backgrounds stay full-bleed.

### The band

One band per surface, at the head:

```
surface #212a33
  wordmark, 17/24 600, with a 12/16 secondary context line
  optional stamp pill, right aligned
```

The stamp pill is a 20px-radius `#2d3a47` field: value 13/600 tabular in white,
label 11/400 in secondary. Pressing the wordmark returns to the index; the band
is not a utility bar and holds nothing else.

### The tab rail

A flat `#212a33` strip with a 1px `#111417` top edge. Four tabs — Profile, Ranks,
Issues, Library — each a 20px single-stroke icon over an 11px sentence-case label.
The shelf tab appears only when the server opens the library. The active tab is accent-coloured, not filled. The rail is
full width; its items are capped at 720px and centred.

## Components

### Grouped rows

The core shape of the app:

- Outer group: 8px radius, `overflow: hidden`, the ground showing through 1px gaps.
- Row: at least 42px tall (the app uses 56-58px for rank and shelf rows), square
  corners, surface ground, full row is the tap target.
- Hover: `#293440`; the viewer's own row: `#2d3a47`.
- Leading rank badge: 32px circle, `#2d3a47`; first place and the viewer's rank
  use the action blue.
- Row body: title 15/600 white over a 12/400 secondary line; the title truncates.
- Trailing value: right aligned, 15/600 tabular; a `%` unit is 11/500 secondary
  and sits on the same line as the number.
- Below-minimum attendance: the score only, in `#f88277`.

### The 75% line

A 2px `#f88277` rule drawn inside the ranked group after the last confirmed row.
Left label "75% minimum" 12/600 danger; right label "Below this line" 12/400
secondary. It is the only line in the list, and it is never decorative.

### League banner (home)

The first screen carries one banner for the week's Section Wars. It is a single
link, not a group: 8px radius, `#212a33`, 12px 14px padding, 16px side margins,
sitting between the band and the page title. The whole banner is the tap target.

- **Badge:** 40px circle `#2d3a47` with a 20px accent flag icon.
- **Text:** "Section Wars" 17/600 white over one 12/16 secondary line of state:
  "Today's run is open. 10 questions, 10 seconds each.", "Question 4 of 10 is
  waiting.", "Run done: 814 points.", or "Save your roll to play today's run."
- **Trailing:** the week label 11/14 secondary tabular over the accent action
  "Play", "Resume" or "Board" with a 14px chevron.
- **Destination:** a running or unstarted run opens the play screen at
  `#/play`; a finished run goes to the league board at `#/games`. The banner
  paints its fallback copy before the personal answer lands, and reserves its
  height, so the profile below never jumps.
- Hover `#293440`, press `#2d3a47`, the standard 2px accent focus ring. No shadow,
  no gradient, no dismiss chrome.

### Today's run (hidden play screen)

The banner opens `#/play`, a hidden route with no tab. The bot keeps its own chat
copy of the run; both surfaces read and write the same attempt. The screen is a
single question, one pick, then the next question.

- **Head:** page title "Question 3 of 10" 22/700; the countdown 13/600 tabular in
  accent at the right ("9s", then "Time's up" in `#f88277`). Under it the score
  line 13/18 secondary tabular, with the last answer on the right: "Correct
  +150" in `#7ed176`, "Too slow" in `#ff9953`, "Missed" secondary.
- **Clock:** a 2px accent rule under the head, draining with a 140ms linear
  transition. At zero it is empty; the picks stay available and still move the
  run on (the server scores them zero), exactly as a late tap behaves in the bot.
- **Question:** 17/24 600 white, 16px side margins.
- **Picks:** one grouped surface of four rows (minimum 56px), each a full-row
  button with a 28px `#2d3a47` letter badge (A to D) and the option 15/400
  white, wrapping. Disabled at 55% while an answer is on the way. Options are
  never colour-coded before the answer; the server holds the correct one.
- **Result:** page title "Run done" with "8 of 10 correct."; a profile-style
  group of rows (Run score, Season points, Today, Streak, Section) with tabular
  values, the no-section and already-played hints under it, then the filled
  "See the board" action and a surface "Home" beside it.
- **States:** no roll gets "Save your roll to play" with a filled "Open
  profile"; a missing set or a failed read gets the standard state block with a
  "Try again" action; no Telegram gets "Open this inside Telegram"; the first
  paint is a skeleton of the head and four rows.
- No option feedback colours, no confetti, no emoji. One rule of progress, one
  countdown, sentence case throughout.

### Controls

- **Search:** 48px field, 12px radius, `#212a33`; 20px search icon at the left;
  clear button at the right. 16px input text so phones do not zoom.
- **Segmented control:** a `#212a33` container with 2px padding and a 10px radius;
  each segment is 13/500 secondary, 32px tall; the selected segment is a
  `#2d3a47` fill at 8px radius and turns white/600.
- **Filter button:** 48px square, 12px radius, surface ground, 20px sliders icon;
  the active-filter count is a 16px action-blue badge at the top-right.
- **Select rows:** 48px rows, 15/400 white label at the left, 14/500 secondary
  value at the right with a 13px drawn chevron.

### Forms

- Label: 15/18 400 white, 8px below.
- Field: `#212a33`, 8px radius, no border, 12px 14px padding, 16px text, white;
  placeholder `#8a98a6`.
- Focus: 2px `#4cb2ff` ring, 1px offset.
- Textarea: 132px minimum, 22px line height.
- Character count: 12/16 secondary, right aligned, tabular.
- Primary action: filled `#248bda`, 8px radius, 13/18 700 on phones and 15/18 700
  on desktop. Disabled keeps the fill and uses `#a6d8ff` text at reduced alpha.
- Secondary action: `#212a33` ground, white text; hover `#293440`.
- Link action: `#4cb2ff`, 13/500, underline only on hover.

### Question papers (hidden intake)

- The page opens from a direct link (`#/papers`), never a tab. It is a
  collection form, not a gallery: there is no public list or image viewer.
- Photos: an empty field is one full-width surface tile with a 28px accent
  photo icon and "Add pages"; once picked, up to five 72px previews with round
  remove buttons sit above an "Add another" row.
- Fields: Subject and Exam (single line, required), then an optional Note with
  a tabular character count. The filled action is "Add to the collection".
- Receipt: a surface panel with a green "Paper received" sentence and one
  filled "Add another paper" action. No image URLs are returned.
- Admin processing list: a table with a 40×52 cover, subject over exam/page
  count, the note, uploader, added time, a "View pages" action that opens the
  full drawer, and a danger-text Remove action.

### Profile summary

The saved profile is a read-only group, not a permanently open form:

- Rows: Roll number (15/600 tabular), Display name (quiet "Not set" when empty),
  College record, Class (year · section · branch).
- A 12/16 secondary hint under the group explains that the leaderboard shows the
  display name when set, otherwise the college record.
- One full-width primary "Edit profile" with a 16px pencil icon.
- Edit opens the standard form with "Save changes" and "Cancel"; a successful
  save returns to the summary with a green "Saved." note, and an unregistered
  user sees the form immediately.
- A stale roll keeps the summary but adds the warning note and still offers
  Edit.

### Run history

- Sits under the saved profile group: a 17/600 "Your runs" head with a 12/16
  secondary count at the right, then one grouped surface (8px radius, 1px gaps,
  `#111417`) of 56px rows.
- Row: the IST day 15/600 white over "8 of 10 correct · 814 score" 12/16
  secondary, with the season points 15/600 tabular at the right edge and a
  11/500 secondary "pts" unit. No avatar, no rank badge, no colour coding.
- Newest first, ten at most. With none, one 12/16 secondary line ("No runs yet.")
  and the accent "Play today's run" link, never an empty group.
- The home banner's finished state says "Run done: N points." and its trailing
  action is "Your runs"; it opens the profile and scrolls to this group. The
  action never says "Board" — the league board is one tap away in the result
  screen and the channel.

### Issue reports

- List: one grouped surface, 1px gaps, 8px outer radius. Each tile is a full-row
  button with 12px 14px padding.
- Issue id 13/600 tabular white; status 12/500 with a 7px dot (open secondary,
  answered `#ff9953`, resolved `#7ed176`); unread count is an action-blue pill.
- Message preview: 14/20 white, clamped to two lines.
- Admin reply: an accent wash (`rgba(76,178,255,0.10)`) with a 6px radius and an
  "reply from the admin" line in `#4cb2ff` 11/600.
- Foot: 12/16 secondary, tabular time.

### Conversation

- Messages sit in one grouped surface with 1px gaps; the admin's side carries the
  same accent wash as the reply block. No chat bubbles, no tails.
- Meta line: 12/16 secondary; the author is 12/600 white (admin: accent).
- Body: 14/20 white, pre-wrap.
- Composer: the standard field and primary button, 12px above.
- A resolved thread replaces the composer with the closed note and a primary
  "File a new report".

### Library

- Subject row: title 15/600 white over the subject code 12/400 secondary; the
  trailing state is 13/400 secondary with a small chevron. Held subjects open;
  "not yet" subjects are quiet and not buttons.
- Unit row: the whole left side opens the reader; a separated right column is the
  accent download icon, divided by the 1px ground gap.
- The reader owns the screen: the band and tab rail step away.

### Reader

- Head: surface `#212a33`, full width, padding-top includes the safe area.
- Row one: 40px accent back chevron, title 15/600 white with a 12/16 secondary
  "Unit 1 · 42 pages" line, accent download icon at the right.
- Row two: page count `n / total` 12/16 tabular (current page white), zoom controls
  as 32px surface-hover targets.
- Progress: 2px accent rule along the head's bottom edge.
- Pages: white sheets on the dark ground, square, with a soft float shadow; the
  PDF's own layout is the page.
- End: secondary "End of Unit" and a surface "Back to units" button.

### Verification and privacy

- Verified note: surface panel, 13/18, `#7ed176`.
- Privacy options: one grouped surface with 1px gaps; each row is 12/14 padding,
  13/18 secondary with a 600 white title. The checkbox is a 24px circle with a
  1.6px `#838f9c` ring; checked fills `#248bda` with a white check.

### Empty and error states

- Centred, 56px single-stroke icon in secondary, title 15/600 white, description
  13/18 secondary, one action button.
- Errors keep the surface shape: a 13/18 danger sentence inside a surface panel,
  with an accent "Try again" link.

## Motion

- Default transition: 200ms ease. Row and button hovers may use 120ms.
- Bottom sheet: 200ms, opacity 0.6 to 1 and translateY 24px to 0.
- Reader progress: 140ms linear.
- Haptics: selection change on tabs and filters, notification feedback on a sent
  report or a failed send.
- No decorative loops, no bouncing cards. Loading is a skeleton row or a spinner.

## Do's and Don'ts

### Do

- **Do** fill the screen: fullscreen on phones, safe-area padding, a 720px column
  on desktop.
- **Do** separate rows with a 1px ground gap inside an 8px group.
- **Do** keep figures tabular and right aligned.
- **Do** use `#248bda` only for filled actions and `#4cb2ff` only for pointers.
- **Do** sentence case everything.
- **Do** keep red for danger, thresholds and corrections.
- **Do** let the native Telegram back button and the app's back chevron do the
  same thing.

### Don't

- **Don't** draw a fake Telegram header, a floating card, or a 560px desk sheet.
- **Don't** use tracked uppercase labels or serif display type in the Mini App.
- **Don't** use red as a background, gradient or decoration.
- **Don't** use the action blue as decoration; it marks the one primary action, an
  unread badge, or a checked state.
- **Don't** use unicode glyphs as icons; draw single-stroke SVG at 1.5-2px with
  round caps.
- **Don't** use monospace faces; tabular Figtree carries the data.
- **Don't** float the tab rail or give it a shadow.

## Source

The native surface was extracted on 2026-11-14 from the publicly served shell
and assets of the BotFather Mini App:

- `https://webappinternal.telegram.org/botfather`
- `/css/botfather.css?55`
- `/js/webapp-common.js?5`
- `/js/botfather.js?70`

The `tgWebAppData` fragment from the session link is a Telegram credential and is
intentionally not reproduced. The extraction is based on the unauthenticated shell
plus the shipped CSS/JS.

NbkristQik's adaptations: Figtree instead of Product Sans, tabular numerals on all
rank figures, the 75% rule, the band's stamp pill, the issue/thread surfaces and
the reader toolbar. The paper register it replaced is retired.
