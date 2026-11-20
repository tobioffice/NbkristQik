# Leaderboard: the section board and share cards

**Status:** shipped: section ranks, the named section board, the drawn card and
the share sheet. Phase 4 (public OG page, section invite link, page-loading
jump-to-me, QR) is not built.
**Reads "rank on the section" as:** your rank inside your own section, not a
ranking of sections against each other.

## 1. What is wrong today

1. **Two ranks on one screen.** The "Your rank" strip comes from `/api/me`,
   which ranks the whole register. The rank badges in the list are computed by
   `/api/leaderboard` over the current filter set. With "My section" on, the
   strip can say `#247` while your own row says `#4`. The same student, two
   numbers, no explanation.
2. **The board is never named.** "My section" is a toggle, not a title. The
   list below it still says "All students", even when it is 63 people from
   CSE 3A.
3. **The top three are split off.** In section mode the podium takes ranks 1–3
   and the list starts at 4, so a 63-person class board is two stacked blocks
   and "all of the students" is never one list.
4. **Sharing is text-only and global.** The only share is a prepared Telegram
   article with the global rank. No card, no story, no WhatsApp, no link for a
   class group. And the number it shares may not be the number on screen.

## 2. The idea

**A board with a name, one true rank, and a card worth posting.**

- The scope switch moves to the top and becomes the board switch. "My section"
  turns the screen into *your class board*, named `CSE · Year 3 · Section A`.
- The personal strip uses the rank **in that board** (`4 of 63`), the same
  number the list prints. The list shows all 63, top three included, with your
  row highlighted. All-students keeps its podium and its global rank.
- A **Share** action opens a sheet with a live preview of a 9:16 **rank card**
  and the destinations that actually work: Telegram, Telegram story, the OS
  share sheet (Instagram, WhatsApp, anything), WhatsApp directly, copy message,
  save image.
- The card carries only your own rank, score and the board's ranked count. No
  classmate's name, roll or score ever appears on it.

The section is the unit worth sharing: `#4 of 63 in CSE 3A` is a story.
`#412 of 3,180` is a statistic.

## 3. What the screen looks like

### 3.1 Order

```
Band: Leaderboard                          [1,284 ranked]
┌ My section ────────┬ All students ──────┐   ← board switch
Your section                        Share      ← board head
┌────────────────────────────────────────────┐
│ (4)  CSE · Year 3 · Section A              │   ← tap: go to my row
│      63 students ranked                    │
│                              87.40%        │
│                      1.9 above 75%         │
└────────────────────────────────────────────┘
[Search.....................] [Filters]
[ Attendance │ Mid marks ]
63 ranked · synced 2 hours ago
─────────────────────────────────────────────
1   A. Student                 94.20%
2   B. Student                 92.80%
3   C. Student                 90.10%
4   D. Student        YOU      87.40%      ← highlighted, in context
...
63  ...
```

All-students mode:

```
All students                        Share
┌────────────────────────────────────────────┐
│ (412) All students                         │
│       3,180 students ranked                │
│                              87.40%        │
│                      1.9 above 75%         │
└────────────────────────────────────────────┘
...
Top three
┌────────────────────────────────────────────┐
│ (1) ...  (2) ...  (3) ...                  │
└────────────────────────────────────────────┘
All students                                 3,180
4 ...                                       ← list starts at 4
```

### 3.2 The personal strip

- **Section mode:** head `Your section`, action `Share`; row badge = section
  rank; title = the section label; sub = `63 students ranked`; trailing score
  and the 75% distance.
- **All mode:** head `Your rank`, action `Share`; row badge = global rank;
  title = `All students`; sub = `3,180 students ranked`; same trailing figure.
- The badge is the action-blue circle only for the viewer, as today.
- Tapping the row scrolls to the viewer's row; if it is not loaded yet, it
  falls back to the existing roll search.
- Hidden when there is no saved roll, no rank for the chosen metric, an active
  search, or manual filters (the strip's number would not describe those
  views). The list still marks `YOU`.

### 3.3 The list

- **Section mode:** one continuous list of every student, ranks 1..N, no
  podium. A class of 63 is a register, not a podium. The viewer's row is
  highlighted.
- **All mode:** keep the podium and start the list at #4, as today.
- List head: `Ranked students` in section mode, `All students` in all mode,
  `Search results` for a search. The ranked count stays on the right. It is
  never "all 63 students": the register only knows the rows it has ranked.
- The 75% rule still crosses the list after the last confirmed row.
- Manual filters: the head names the filter (`CSE · Year 3`) and the personal
  strip hides.

### 3.4 Empty and unresolved states

- No saved roll: only "All students"; "My section" is disabled with the
  existing tooltip.
- Registered but the server cannot resolve a section: show "All students" as
  active and one hint, "We don’t know your section yet."
- A section with no ranked rows: "No one in CSE · 3A has checked yet. Be the
  first." with the register action.

## 4. The share card

### 4.1 Format

- 1080 × 1920 JPEG (9:16), dark ground `#1a2026`, Figtree, tabular figures.
- All content sits between y=260 and y=1560 so story UI does not cover it.
- Only the viewer's figure and aggregate counts. No names, no rolls, no other
  students' scores.

### 4.2 Layout

```
NbkristQik
Attendance register

        Attendance rank
             #4
   CSE · Year 3 · Section A
          87.40%
   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬  ← 75% tick, red, labelled
      63 students ranked

See where you stand
t.me/NbkristQik_bot
```

- The rank numeral is the hero (260px), with `#` at 0.55×.
- Attendance: a 10px track, white fill to the score, a 4px `#f88277` tick at
  75%, label `75% minimum` under the tick. Below 75, the score turns
  `#f88277`, exactly as the row does.
- Mid marks: no bar; a quiet `Average of M1 and M2` line instead.
- Scope variants: section label, or `All students`.
- `63 students ranked`, never `63 students`: the register is partial.

### 4.3 Drawing

- Client-side Canvas 2D. Figtree is already loaded; wait on
  `document.fonts.ready`, then draw at a fixed 1080×1920.
- `canvas.toBlob("image/jpeg", 0.9)`, roughly 80–200 KB. JPEG because
  Telegram's `photo_url` requires it and stories accept it.
- Pure `cardModel(data)` builds strings and percentages for unit tests;
  `drawRankCard(ctx, model)` only paints.
- The sheet draws and uploads the card **as it opens**, not after the tap:
  `shareToStory` and `navigator.share` should run inside the tap, and the
  preview can say "Preparing card" for the second the upload takes.
- Why not server-side: no new native image dependency (the repo avoids
  libvips), the phone already has the font and the pixels, and the server
  stays a small Express box.

## 5. The share sheet

Opened by the `Share` action. Native `<dialog>` sheet, same shape as Filters.

```
        ── grabber ──
Share your rank                         [x]
Your card shows your rank and score.

┌───────────────┐
│  card preview │   9:16, ~150 wide
└───────────────┘

┌──────────────────────────────────────────────┐
│ (plane)   Send in Telegram                   │
│           Opens the share sheet.             │
├──────────────────────────────────────────────┤
│ (story)   Add to story                       │
│           Telegram story.                    │
├──────────────────────────────────────────────┤
│ (save)    Save to photos                     │
│           For Instagram and WhatsApp.        │
├──────────────────────────────────────────────┤
│ (chat)    WhatsApp                           │
│           Sends the message and link.        │
├──────────────────────────────────────────────┤
│ (link)    Copy message                       │
│           Text and link, for any app.        │
└──────────────────────────────────────────────┘
Rank from the register · synced 2 hours ago
```

Rows are full-width grouped buttons with 20px single-stroke icons, sentence
case, no filled primary: the sheet is a set of destinations, not one action.
The set is composed from what the client can do:

- **Mobile Telegram:** Send in Telegram, Add to story, Save to photos,
  WhatsApp, Copy message.
- **Desktop:** Send in Telegram, Save image, WhatsApp, Copy message.
- **Where the Web Share API actually exists:** Share image replaces the two
  save rows.

### 5.1 Destinations, honestly

| Row | What happens | When it cannot work |
| --- | --- | --- |
| Send in Telegram | Upload the card once, `POST /api/rank/share` with the board scope and card id, server prepares an `InlineQueryResultPhoto` (card + caption + "Open the register" button), then `WebApp.shareMessage`. | Older client: fall back to copy. Telegram rejects the photo: retry as the text article. |
| Add to story | `WebApp.shareToStory(cardUrl, { text, widget_link })` opens the native story editor. | No `shareToStory`: hide. No Premium: Telegram shows its own upsell. |
| Save to photos | `POST /api/rank/card/send`: the bot sends the card to the caller's own chat, then a native alert says "Sent to your chat. Long-press the card to save it to your photos." The student saves it and adds it in Instagram. | Bot blocked: alert with the failed send. No upload yet: the row waits. |
| Share image | `navigator.share({ files: [card] })`; the OS sheet offers Instagram, WhatsApp, anything. | Not available in Telegram webviews on Android or iOS: hide the row and keep Save to photos. |
| WhatsApp | `openLink("https://wa.me/?text=" + text + link)`. Text and link, reliable everywhere WhatsApp is installed. | Outside Telegram, use `window.open`. |
| Copy message | Text plus link, for any app. | Clipboard denied: selectable fallback. |
| Save image | `WebApp.downloadFile({ url: cardUrl + "?download=1", file_name })` when the Web Share API is absent but the client supports downloads; anchor download otherwise. | Desktop and some clients: prefer Save to photos. |

**Why there is no direct Instagram button:** Instagram has no web endpoint
that accepts an image for a story, and Telegram's webviews do not implement
the Web Share API, so the OS share sheet is not dependable inside the Mini
App. The reliable route is the one the sheet offers: **Save to photos** sends
the card to the student's own Telegram chat, where a long-press saves it to
the phone's gallery; from there Instagram's story editor can pick it. The row
says "For Instagram stories or WhatsApp status" so the intent is clear. On a
desktop browser
where `navigator.share` exists, the sheet offers **Share image** instead.

### 5.2 Copy

Telegram caption (HTML):

```
🏆 <b>Attendance rank</b>
<code>25KB1A05AR</code>
<b>#4</b> of 63 in CSE · Year 3 · Section A
87.40% · 1.9 above 75%

<i>See where you stand in the register.</i>
```

WhatsApp / plain text:

```
I'm #4 of 63 in CSE · Year 3 · Section A at 87.40% attendance.
Where do you stand? https://t.me/NbkristQik_bot?startapp=rank
```

Story caption: `#4 of 63 in CSE · Year 3 · Section A · 87.40%` (under 200
characters). Mid marks: `#7 of 63 ... · 24.5 average`.

Every destination prints the same board, the same rank and the same score.
The server computes the rank for the message; the client draws the card from
the same `/api/me` answer.

## 6. Data and API

### 6.1 `/api/me` gains a section block

```ts
interface MeResponse {
  // unchanged: found, roll_no, attendance, midmarks, source, lastLookup
  section?: {
    year: string; // "3", the year digit
    branch: string; // "5"
    section: string; // "A"
    attendance: RankInfo | null;
    midmarks: RankInfo | null;
  } | null;
}
```

- Computed in the **same scan** as the global ranks: extend
  `getStudentRanks(rollNo)` with the section columns and add
  `RANK()` / `COUNT()` windows partitioned by
  `(SUBSTR(s.year, 1, 1), s.branch, s.section)`.
- Same guards as the list: `st.<metric> IS NOT NULL`, `st.year_sem = s.year`,
  the same rounded score, the same competition ranking. The section rank is
  therefore identical to the badge the list prints for that section.
- Partition by the year **digit**, not the raw year-semester, because the
  leaderboard filters `31` and `32` as year 3.
- `section: null` when the master row has no year, branch or section.
- One query on app open. No extra round trip, no extra Turso read.
- Tests: two semesters in one section; null section; null metric; section rank
  equals `getLeaderboard` with the same filters; ties.

Why not add `you` to `/api/leaderboard` page 1: that payload is Redis-cached
per section and shared by every student in it, so per-student rank data would
need an uncached side query on every page-1 request. `/api/me` is already
private, no-store, per-user, and called once per app open.

### 6.2 `POST /api/rank/share` accepts scope and card

```ts
{ sort: "attendance" | "midmarks", scope: "section" | "all", cardId?: string }
```

- The server resolves the rank itself, never from the client:
  `all` → `getStudentRank(roll, sort)`; `section` → registration → master row
  → `getStudentRank(roll, sort, filters)` (new optional filters on the model).
- With a `cardId` that belongs to the caller, prepare an
  `InlineQueryResultPhoto` with `photo_url` and `thumbnail_url` set to the card
  URL, the caption above, and the `Open the register` button.
- Without one, keep today's article. Older clients keep working.
- If Telegram cannot fetch the photo, retry once as the article and log.
- `scope=section` with no resolvable section falls back to `all`.
- Rate limits: share 30/15 min (existing); card upload 10/15 min.

### 6.3 `POST /api/rank/card`

- Identity required; body is raw `image/jpeg`, `express.raw({ limit: "1.5mb" })`.
- Validate the JPEG magic, not the client's word. Reject anything else.
- One live card per user; a new upload replaces the old. Random 24-byte id,
  30-minute TTL, in-memory map with a byte cap and a sweep on write. The
  production host runs one process; note this in the code.
- Response: `{ id, url }`, with the absolute URL built from `req.protocol`
  (trust proxy) and `req.get("host")`.
- `GET /api/rank/card/:id.jpg`: public (Telegram's servers fetch it), no
  cookies, unguessable id, `image/jpeg`, `Cache-Control: private, max-age=1800`,
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src
  'none'`, `X-Robots-Tag: noindex`. Mounted before the API middlewares with its
  own 1,200/min IP limiter, like report attachments. `?download=1` adds
  `Content-Disposition: attachment` and `Access-Control-Allow-Origin:
  https://web.telegram.org`, which `WebApp.downloadFile` asks for; the clean URL
  stays `inline` for Telegram's photo and story fetches.

### 6.4 `POST /api/rank/card/send`

- Identity required; body `{ cardId }`; the card must belong to the caller.
- The bot sends the JPEG to the caller's own private chat with `sendPhoto`
  (`disable_notification: true`), the caption "Your rank card. Long-press it to
  save it to your photos.", and an `Open the register` button.
- This is the reliable Instagram path: Telegram is the gallery hand-off, not
  Instagram. The Mini App shows a native alert after Telegram accepts the send.
- Rate limit 5/15 min per account; a blocked bot or a failed send answers with
  a clear error, never a silent success.

### 6.5 Client plumbing

- `api.ts`: `RankScope`, `SectionRank`, `RankCard`, parse `section` in `mapMe`.
- `identity.tsx` / `useTelegramUser`: keep the section in the snapshot.
- `Leaderboard.tsx`: pick the rank for the active board, pass the board and
  card data to the sheet, hide the strip where it would lie.
- New: `shareCard.ts` (model + canvas), `ShareRankSheet.tsx`.
- `telegram.ts`: add `shareToStory`, `downloadFile`, and
  `initDataUnsafe.user.is_premium`.

## 7. Privacy, security, honesty

- The card and the message never contain a classmate's name, roll or score.
- The image has **no roll**; the Telegram caption keeps the roll, matching
  today's share. (Decision 2 below.)
- Names stay limited to verified identities. Nothing about the share flow
  widens who sees names.
- A hidden row still ranks; its owner may share their own rank. The privacy
  switch hides the row, not the student's voice.
- Denominator language is always "ranked": the register is partial.
- Below 75% gets no celebratory copy; the card shows the figure and the red
  minimum line.
- Upload is identity-gated, JPEG-only, ≤1.5 MB, one per user, 30-minute TTL,
  unguessable, no HTML, no directory listing.
- Analytics: `rank_share` detail becomes `sort:scope:channel`
  (`telegram`, `story`, `image`, `whatsapp`, `copy`, `save`). Counts only.

## 8. Edge cases

- No registration: no strip, no Share, only the all-students board.
- Registered, no resolvable section: all-students is active; no section card.
- No rank for the chosen metric: no strip, no Share for that tab.
- Search: strip hides, head says `Search results`.
- Manual filters: strip hides, head names the filter.
- Ties: competition rank, printed as-is; the total is the ranked count.
- Mid marks: the existing "compare within a section" hint stays; the card
  labels the average.
- Old Telegram client: story and image rows degrade; Telegram and copy work.
- Desktop: no story; Telegram, save and copy work.
- Upload fails: text share still works; the sheet shows a retry.
- Telegram cannot fetch the card: the prepared message falls back to text.

## 9. Testing

- **DB:** section partitions match the list filters; two semesters in one
  section; null section; null metric; ties.
- **`/api/me`:** section block shape, null section, unchanged global fields,
  still one rank query.
- **`/api/rank/share`:** section caption; photo result with card; article
  fallback; a card owned by someone else rejected; invalid scope rejected.
- **`/api/rank/card`:** auth, content type, magic bytes, size, TTL,
  one-per-user, GET headers, 404 on expiry.
- **`/api/rank/card/send`:** auth, ownership, blocked bot, rate limit, the
  photo goes only to the caller's chat.
- **Web:** `mapMe` section mapping; card model strings (rank, score, gap,
  below-min, plural); no names in the model.
- **Manual matrix:** iOS, Android, desktop; Telegram, story, WhatsApp,
  Instagram; #1, below 75, no registration, no section, hidden identity.
- `pnpm exec vitest run`, `pnpm run typecheck`, `pnpm run lint`, web
  `pnpm test`, web `tsc -b`.

## 10. Phases

**Phase 1 — one true rank.** `/api/me` section block, web mapping, the strip's
number follows the board, the board gets a name, the strip hides where it
cannot be truthful. Small, shippable, no UI rewrite.

**Phase 2 — the section board.** One continuous list in section mode, podium
stays for all students, list heads and counts, jump-to-me, empty-state copy.

**Phase 3 — card and sheet.** Canvas card, preview, upload/serve, the sheet,
the photo share, story, OS share, WhatsApp, copy, save, analytics.

**Phase 4 — only if Phase 3 earns it.** A public `/r/<token>` page with OG
meta (rich WhatsApp previews, an Instagram bio link), an "invite your section"
deep link, page-loading jump-to-me, a QR on the card.

## 11. Decisions taken

1. **Section mode:** one continuous list of all students, no podium. Built.
2. **Card identity:** no roll on the image; the Telegram caption keeps it.
   Built.
3. **Release:** Phase 1, 2 and 3 built together; Phase 4 waits for demand.
