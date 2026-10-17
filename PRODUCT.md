# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Students of NBKRIST** (engineering college; B.Tech, diploma, and M.Tech years, many branches and sections). They check attendance percentage and mid-term marks on their phone, almost always inside the Telegram webview, often right before or between classes, deciding whether they can skip a period.
- **The admin** (project owner, one person). Watches who uses the bot, from where (private chat, group, channel, web app), and whether the system and the college portal are healthy. Uses a desktop browser for the private admin panel.

## Product Purpose

Give students instant, low-friction access to their college attendance and mid-term marks without the slow college portal, and keep them coming back through a playful leaderboard that ranks students by attendance percentage or mid-marks. A built-in report channel carries problems and app feedback straight to the admin with a trackable issue id (e.g. QIK-0007). The admin keeps the service observable and issues answered. Success means students check in regularly through Telegram, the leaderboard drives engagement, and the admin sees activity, reports, and health at a glance.

## Positioning

The product lives entirely inside Telegram — no install, no separate account — and speaks the college's own language: roll numbers, branch, section, attendance percentage, mid marks. Registered students get one-tap instant commands; everyone else can look up by roll number in chat. A competing app would have to replicate both the portal integration and the chat-native habit.

## Operating Context

- Used one-handed on phones inside the Telegram webview; light/dark surroundings vary.
- Students reason in roll numbers, sections, branches, and percentages; "how much can I bunk?" is the recurring question.
- The leaderboard is filtered by year, branch, and section, searchable by roll, and ranked by attendance or mid-marks; it shows the viewer's own rank when identity is known.
- Registration is optional and editable at any time; registered users unlock `/attendance`, `/midmarks`, `/bunk` instant commands.
- Reports get an issue id; the admin replies from the admin panel (or `/reply`), and the reply reaches the student on the report page and in Telegram.
- All wall-clock times shown anywhere are IST (Asia/Kolkata), 12-hour AM/PM, regardless of the UTC storage.
- Admin panel views: login, Overview (30-day activity pulse, surface split, top actions), Students (searchable table + drill-down), Live (10 s feed), Health (90-day uptime for API, database, Redis, college portal), Reports.
- Deployment: the Mini Apps are built with Vite and served from GitHub Pages; the status page and admin panel are served by the Express backend; the bot runs as a systemd service.

## Capabilities and Constraints

- **Capabilities (web surface):** leaderboard with podium, search, infinite scroll, personal-rank banner; profile/register page; issue report form with history and admin replies; public status page (live health, 90-day uptime); password-protected admin panel with the five views above.
- **Constraints:**
  - The three Mini Apps run inside the Telegram WebApp SDK; identity comes from signed `initData` (a dev `userId` shortcut exists outside Telegram).
  - The admin panel is served as server-rendered vanilla HTML/CSS/JS from the Express backend; the Mini Apps are React 19 + Vite + Tailwind; the status page is a single static HTML file. The redesign must fit each surface's existing delivery mechanism.
  - The college portal is plain HTTP and unreliable; data can be missing or stale.
  - The admin panel path and password come from env vars; if unset the panel is disabled.
- **Undecided / open:** none recorded.

## Brand Commitments

- Keep the product name **NbkristQik**.
- The current dark-slate + indigo/cyan look is explicitly the anti-reference for the upcoming redesign; free rein on the new visual world (user decision, this session).

## Evidence on Hand

- Real student data via the college portal: attendance percentages, mid-term marks, roll numbers, names, branch/section/year.
- Real usage data behind the admin panel: activity events, surfaces, action counts, per-student histories.
- Real reports and admin replies already stored in the database.
- No testimonials, press, benchmarks, or marketing assets exist; none may be fabricated.

## Product Principles

1. **Instant by default.** The answer arrives in seconds, inside the chat the student already has open. Every interaction is sized for a phone in a corridor between classes.
2. **Honest data, never invented.** Numbers come from the college portal; when data is stale or missing, the interface says so plainly rather than manufacturing certainty.
3. **Playful competition, not pressure.** The leaderboard celebrates effort and rank; it never shames, and private data (marks, attendance of a named person) is treated with care.
4. **Telegram-native identity.** No accounts, no passwords, no onboarding ceremony for students — who you are in Telegram is who you are here.
5. **The admin sees everything relevant at a glance.** Activity, issues, and health are one screen deep, on a desktop, with real numbers.
