---
name: NbkristQik — Telegram Native (Experimental)
description: A dark, flat utility surface extracted from BotFather's Mini App. Native header, grouped rows, Product Sans, two blues.
colors:
  app-bg: "#1a2026"
  surface: "#212a33"
  surface-hover: "#293440"
  table-header: "#293440"
  footer-bg: "#111417"
  text: "#ffffff"
  text-secondary: "#8794a1"
  text-tertiary: "#8494a3"
  placeholder: "#8a98a6"
  accent: "#4cb2ff"
  action: "#248bda"
  action-hover: "#207cc2"
  action-disabled-text: "#a6d8ff"
  accent-soft: "rgba(77, 178, 255, 0.10)"
  danger: "#ff5863"
  danger-text: "#f88277"
  warning: "#ff9953"
  good: "#7ed176"
  dropdown-bg: "#2e3a47"
  dropdown-hover: "#384553"
  tooltip-bg: "#2d3c4c"
  toast-bg: "#374657"
typography:
  body:
    fontFamily: "Product Sans, -apple-system, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  section:
    fontFamily: "Product Sans, -apple-system, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: "28px"
  row-value:
    fontFamily: "Product Sans, -apple-system, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "18px"
  description:
    fontFamily: "Product Sans, -apple-system, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "15px"
  label:
    fontFamily: "Product Sans, -apple-system, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "18px"
  mono:
    fontFamily: "ui-monospace, 'Roboto Mono', Menlo, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
rounded:
  group: "8px"
  field: "8px"
  button: "8px"
  popup: "12px"
  pill: "20px"
  toast: "50px"
  circle: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "0"
    padding: "9px 24px 9px 14px"
  section-header:
    textColor: "{colors.text}"
    padding: "9px 12px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: "11px 14px"
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.text}"
    rounded: "{rounded.button}"
    padding: "12px 15px"
  pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
  toast:
    backgroundColor: "{colors.toast-bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.toast}"
    padding: "11px 16px"
---

# Design System: Telegram Native (Experimental)

> **Status: experimental, not binding.** `DESIGN.md` remains the shipped design
> system. This document records the BotFather Mini App's actual visual rules so
> a Telegram-native direction can be prototyped without guessing.

## What BotFather actually is

BotFather's Mini App is not a chat screen. It is a dark utility app made of
grouped setting rows, section headings, forms, toggles and native Telegram
controls. It does not draw a fake Telegram header, chat bubbles or a custom
navigation bar. That is why it feels native: Telegram owns the chrome, and the
web app owns the content.

The app deliberately forces its own dark surface even when Telegram's theme is
light or a custom theme:

- header `#212a33`
- background `#1a2026`
- bottom bar `#212a33`
- primary action `#248bda` with white text

It calls `requestFullscreen()` on iOS and Android, disables vertical swipes,
uses the native BackButton and MainButton, and pads the content with Telegram's
safe-area and content-safe-area insets.

## The native contract

These are the rules that make the surface feel like a Telegram tool rather than
a website.

**One header, and it belongs to Telegram.** Do not draw a second title bar.
The native header carries the title, back button and close button. The app
starts directly with content.

**Safe areas are layout, not padding hacks.** The content starts at
`max(12px, content-safe-area-top + safe-area-top)` and ends at
`safe-area-inset-bottom`. The sheet never sits under the status bar or home
indicator.

**One primary action.** The native MainButton is reserved for the single
primary action of a screen. Secondary and destructive actions stay inline.

**Dark only.** This extracted system has no light variant. BotFather ignores
Telegram's light theme and renders the same dark surface on both platforms.

**No borders between rows.** Separation is a 1px gap of the page ground
(`#1a2026`) between surfaces. Groups get an 8px outer radius; the rows inside
stay square.

**Rows are 42px minimum.** A row is a full-width tap target with a 24px leading
icon, a 14px label, an optional 12px description, and a 9x17 chevron at the
right edge.

**Two blues, no more.** `#4cb2ff` is the link and icon accent. `#248bda` is the
filled primary action. Do not use one for the other.

**Product Sans, sentence case.** No uppercase tracked labels. The type scale
does the work.

**Motion is short and quiet.** 200ms is the default. There are no bouncing
cards or decorative reveals.

## Colors

| Token | Value | Use |
| --- | --- | --- |
| Page | `#1a2026` | The content ground behind every group |
| Surface | `#212a33` | Rows, fields, grouped panels |
| Surface hover | `#293440` | Tappable row and default button hover |
| Table header | `#293440` | Table head and grouped header caps |
| Footer | `#111417` | The outer page behind the content; visible at the bottom edge |
| Text | `#ffffff` | Titles, row labels, values |
| Text secondary | `#8794a1` | Descriptions, helper copy, section notes |
| Text tertiary | `#8494a3` | Secondary metadata |
| Placeholder | `#8a98a6` | Input placeholders |
| Link / accent | `#4cb2ff` | Links, icons, add-row actions, active affordances |
| Primary action | `#248bda` | Filled primary buttons, toggles on, checkboxes on |
| Primary hover | `#207cc2` | Primary button hover |
| Primary disabled text | `#a6d8ff` | Disabled primary label |
| Accent wash | `rgba(77, 178, 255, 0.10)` | Selected/soft accent surfaces |
| Danger | `#ff5863` | Destructive text and alert states |
| Danger text | `#f88277` | Destructive row labels, error toasts |
| Warning | `#ff9953` | Warning text and icons |
| Good | `#7ed176` | Success text and icons |
| Dropdown | `#2e3a47` | Menus and popovers |
| Dropdown hover | `#384553` | Menu item hover |
| Tooltip | `#2d3c4c` | Tooltips |
| Toast | `#374657` | Neutral toast surface |
| Row gap | `#1a2026` | The 1px gap between rows is the page ground showing through |

BotFather's `--header-bg-color` is actually `rgba(33, 42, 51, 0.9)`. On the
page ground this reads as the solid `#212a33`; use the solid value in
implementation unless you want the slight translucency.

### Color rules

- The page ground and footer are darker than every raised surface. There is no
  white card.
- Primary blue appears only on actions. Links and icons use the lighter accent.
- Danger red is text, not a filled background. The one exception in BotFather
  is the toggle-off state, which is red; see the toggle note below.
- Status colors are muted in normal UI and brighten only when the state itself
  is the message.

## Typography

**Family:** Product Sans, with `-apple-system, system-ui, sans-serif` as the
fallback. Tokens and IDs use `ui-monospace, "Roboto Mono", Menlo, Consolas,
monospace`.

**Font licensing:** Product Sans is proprietary. Do not vendor the TTF served
by Telegram into this repository. Use a licensed copy or a close open
alternative; if the alternative changes the feel, update this document before
implementation.

| Role | Mobile | Desktop | Weight |
| --- | --- | --- | --- |
| Intro title | 22 / 30 | 28 / 36 | 700 |
| Section header | 18 / 28 | 22 / 36 | 700 |
| Form label | 15 / 18 | 15 / 18 | 400 |
| Body / row | 14 / 20 | 14 / 20 | 400 |
| Row value | 14 / 18 | 14 / 18 | 600 |
| Secondary | 13 / 18 | 13 / 18 | 400 |
| Description | 12 / 15 | 12 / 15 | 400 |
| Button | 13 / 18 | 15 / 18 | 700 |
| Tab / pill | 13 / 17 | 13 / 17 | 600 |
| Table header | 12 | 12 | 400 |

- Sentence case everywhere. BotFather does not use tracked uppercase labels.
- Line heights are tight and utilitarian: 20px for 14px body, 18px for 14px
  values, 15px for 12px descriptions.
- Long descriptions wrap to `text-wrap: pretty` in the intro and clip with an
  ellipsis in rows.
- **Adaptation for NbkristQik:** keep tabular numerals on ranks, rolls,
  percentages and counts. BotFather's utility type does not use them, but the
  register does; this is the one deliberate departure.

## Layout

### Content width

- Mobile: `.tm-main` is `480px` wide, `max-width: 100%`, centered, with 12px
  bottom padding.
- Desktop (768px and up): `720px` content box, centered, with
  `env(safe-area-inset-left/right)` padding.
- Desktop section headers get more air: 22px 0 14px, with 22/36 text.
- Mobile section padding is `0 16px 12px`.

### Page shell

```
safe-area top
  native Telegram header
    content (page #1a2026)
      section heading
      section description
      grouped rows (8px group radius, 1px gaps)
      fields and inline actions
    bottom safe area
```

The app has no footer navigation in BotFather. If NbkristQik keeps its tab rail,
render it as a flat `#212a33` strip with a 1px `#111417` top gap, no shadow,
and one accent-filled selection. Do not float it.

### Grouped rows

- Outer group: 8px radius, `overflow: hidden`, background surface.
- Each row: at least 42px tall, `9px 24px 9px 14px`, with a 1px bottom gap
  that shows the page ground.
- Leading icon: 24px, 5px margin, flex-shrink 0.
- Body text: 14px white, one line with ellipsis.
- Description: 12/15 `#8794a1`.
- Trailing value: 14/18 600 white; secondary value `#8794a1`.
- Chevron: 9x17 at `right: 12px`, vertically centered.
- Tappable rows: pointer, hover `#293440`, full row is the target.
- Destructive rows: `#f88277`.
- Add row: `#4cb2ff`, no chevron.
- Row close / remove: 24px minus-circle, right-aligned.
- Checkbox: 24px circle, inset ring `1.6px #838f9c`; checked fills `#119bf7`
  with a white check.
- Toggle: 36x20, 2px padding, 16x16 handle. Off `#e3695d`; on `#248bda`.
  Handle travel 16px, 300ms `cubic-bezier(0.23, 1, 0.32, 1)`.
- User avatar: 34x34, 4px radius; user photo is circular.

## Components

### Section header

- Text: 18/28 700 white on mobile, 22/36 on desktop.
- Padding: `9px 12px` mobile; `22px 0 14px` desktop.
- Description: 13/18 `#8794a1`, offset `-8px 12px 12px` mobile and
  `-12px 14px 14px` desktop.
- Optional action: 14/28 700 accent `#4cb2ff`.

### Field

- Background `#212a33`, radius 8px, no border, no shadow.
- Input: 14/20, padding `11px 14px`, white text, placeholder `#8a98a6`.
- On focus the placeholder fades to 40% opacity; there is no thick focus ring
  in the source. Use a 2px accent focus ring for keyboard access.
- Field hint: 8px 14px margin, 13/18 secondary.
- Form label: 15/18 white, `15px 13px 10px`.

### Buttons

- Base: inline-flex, 13/18 700, padding `12px 15px`, radius 8px, no border.
- Primary: `#248bda` background, white label; hover `#207cc2`; disabled label
  `#a6d8ff` with the same filled background.
- Default: `#212a33` background, white label; hover `#293440`.
- Link: accent text, transparent background; hover uses `#212a33`.
- Desktop: 15/18, padding `14px 20px`.
- Pills (tabs, empty-state CTA): radius 20px, padding `5px 10px`, 13/17.
  Active pill `#2d3a47` with white text.

### Segmented tabs

- Horizontal flex, 8px gap, 8px bottom margin.
- Each tab: 13/17 600, `5px 10px`, radius 20px, inactive transparent.
- Active: `#2d3a47` fill, white text.
- No underline, no border.

### Toast

- Fixed, bottom 30px, centered, max width 500px, 20px side padding.
- Pill: radius 50px, background `#374657`, white 13px text, padding `11px 16px`.
- Shadow: `0 6px 20px rgba(0, 0, 0, 0.06)`.
- Enter/exit: translateY(120%) to 0, opacity 0 to 1, 300ms
  `cubic-bezier(0.25, 0.46, 0.45, 0.94)`.
- Error toast: `#f88277`. Success and warning toasts carry a 24px icon.
- Pair success/error/warning toasts with Telegram haptic notification feedback.

### Empty state

- 256px wide, centered, 14/19 secondary text.
- 56px icon in `--text-color`.
- Title 600 weight, 8px top margin; description 6px top margin.
- CTA: pill, `#248bda`, white, 13/17 500, `5px 10px`, 16px top margin.

### Dropdown / menu

- Background `#2e3a47`; hover `#384553`; 14/20 text; 6px vertical margin.
- Items have 13px icon spacing; selected item gets a checkmark.
- Open menus are flipped above the trigger when they would clip the viewport
  and shifted left when they would clip the right edge.
- Use native Telegram popups for destructive confirmation:
  `WebApp.showPopup` with `destructive` and `cancel` buttons.

### Safe-area and viewport contract

- On iOS and Android, request fullscreen and add `mobile`/`platform-*` classes.
- Disable vertical swipes.
- Content top padding:
  `max(12px, var(--tg-content-safe-area-inset-top, 0px) + var(--tg-safe-area-inset-top, 0px))`.
- Content bottom padding: `var(--tg-safe-area-inset-bottom)`.
- Minimum height: `var(--viewport-height, 100vh)`.
- Progress bar on mobile anchors to the bottom, not the top.
- Floating bot anchor is BotFather-specific; do not copy it into NbkristQik.

## Motion

- Default transition: 200ms ease.
- Toggle thumb: 300ms `cubic-bezier(0.23, 1, 0.32, 1)`.
- Toast: 300ms `cubic-bezier(0.25, 0.46, 0.45, 0.94)`.
- Page/view transition: 200ms `cubic-bezier(0.26, 0.08, 0.25, 1)`, opacity
  0 to 1 and scale 1.02 to 1.
- Haptics: soft impact on navigation, selection changed on checkbox, and
  notification success/error/warning on toast.
- No decorative looping animation. Loading uses a simple spinner or progress bar.

## What to copy, and what not to

Copy:

- The native header, BackButton and MainButton contract.
- Safe-area and fullscreen handling.
- The dark page/surface relationship.
- 42px grouped rows, 1px gaps, 8px group radius.
- 24px leading icons and 9x17 chevrons.
- Product Sans and the 14/20 utility scale.
- Two-blue action hierarchy.
- 8px fields/buttons, 20px pills, 12px popups.
- The pill toast and the 256px empty state.
- Sentence case and quiet motion.

Do not copy:

- Chat bubbles, a chat composer, or a fake Telegram header. BotFather is a form
  app, not a conversation.
- Bot-authoring artifacts: token rows, webhook fields, command lists, the
  floating bot anchor.
- The red off-toggle for ordinary settings. In BotFather it is an observed
  quirk, not a universal Telegram rule. Use a neutral off state for
  non-destructive switches.
- Telegram logos or branding.
- The Product Sans TTF served by Telegram; it is proprietary.
- The 155KB BotFather stylesheet wholesale. Take the tokens and component
  geometry, not the one-off screens.

## Adoption notes for NbkristQik

This is a full visual break from `DESIGN.md`: paper and cloth become dark
surfaces, the cloth band becomes the native header, and the red-pen language
becomes Telegram's accent/action/danger language. `DESIGN.md` would need a
rewrite before any surface ships this way.

A Telegram-native mapping would look like:

- **Ranks:** grouped rows with rank, roll, name and percentage; tabular numbers;
  percentage values right-aligned; below-minimum values in `#f88277`; pass
  values in `#7ed176`.
- **Reports:** grouped list with a 24px leading icon, issue id, status trailing
  and chevron; section heading above; 256px empty state; toast after send.
- **Profile:** grouped rows for roll, name, verification and privacy; 8px
  fields; primary action in `#248bda`; destructive verification actions in
  `#f88277`.
- **Navigation:** either the native header menu or a flat `#212a33` tab rail
  with one accent selection. No floating dock, no shadows.
- **Forms:** 8px fields, 14/20 text, 15/18 labels, one filled primary button.
  Use the native MainButton only if the screen has exactly one primary action.

Risks to settle before adopting:

1. **Dark only.** BotFather forces dark regardless of the user's Telegram theme.
   NbkristQik's current design is light-only. A dark-only app is a product
   decision, not a CSS detail.
2. **Brand mimicry.** Copying Telegram's surface makes the app look like a
   Telegram settings page. BotFather can do that because it is Telegram.
3. **Status color semantics.** Telegram uses red for destructive actions. The
   register uses red for the 75% line and corrections. Those meanings cannot
   coexist without a new rule.
4. **Toggle off red.** The observed red off-state reads as danger. Use a
   neutral off-state unless the switch is genuinely destructive.
5. **Identity.** This removes the cloth-and-paper identity that the product
   currently owns. Prototype one screen before committing to the whole app.

## Source

Extracted on 2026-11-14 from the publicly served shell and assets of the
BotFather Mini App:

- `https://webappinternal.telegram.org/botfather`
- `/css/botfather.css?55`
- `/js/webapp-common.js?5`
- `/js/botfather.js?70`

The `tgWebAppData` fragment from the session link is a Telegram credential and
is intentionally not reproduced here. It was not used to open the authenticated
session and was not written to the repository. The extraction is based on the
unauthenticated shell plus the shipped CSS/JS, so screen-specific one-off
classes may exist beyond the reusable core documented above.
