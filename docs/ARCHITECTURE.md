# NbkristQik Architecture

> **Note:** Deep, source-grounded documentation is generated in [`openwiki/`](openwiki/quickstart.md)
> and refreshed by CI. This file is a concise hand-maintained overview; if the two
> disagree, the code and `openwiki/` are authoritative.

## Overview

NbkristQik is a Telegram bot that lets NBKRIST students check attendance and
mid-term marks by scraping the college portal. The same Node process serves:

- the Telegram bot (long polling),
- an Express REST API for the web leaderboard and status page,
- a private, password-protected admin panel for activity tracking and health.

```
Telegram users ──> bot handlers ──> portal scraper ──> college portal
                       │                 │
                       ├──> Redis <──────┘
                       ├──> Turso (libSQL)
                       └──> activity tracker ──> Turso
Web leaderboard ──> Express API ──> Redis + Turso
Operator ──> Admin panel (Express, session cookie)
```

## Runtime

- **Entry point:** `src/bot/index.ts`. It awaits `initDatabase()`, imports every
  handler module (registration is an import side effect), starts the uptime
  monitor and the Express server, and only then calls `bot.startPolling()`.
- **Shutdown:** `SIGINT`/`SIGTERM` stop polling, disconnect Redis, and exit 0.
- **Bot:** `node-telegram-bot-api`; see `src/bot/` for commands, the academic
  menu flow, the daily check-in gate, and `/syncdb`.

## Data layer

- **Turso (libSQL/SQLite)** — all persistence. Schema is created idempotently by
  `src/db/init.ts`: `fallbackResponses`, `tgusers`, `studentsnew`, `botusers`,
  `activity_log`, `admin_sessions`, `student_stats`, `uptime_log`.
- **Redis** — caches student records (7d), attendance (1h) and midmarks (2h) per
  roll, leaderboard responses (60s), membership (1d), the daily check-in gate,
  and the tracker's per-user write throttle.

## Scraping

`src/services/student.utils/` contains the portal integration: a generated
`PHPSESSID` session, login/renewal, retry on transient network errors, parse
helpers for attendance and midmarks, fallback to the last cached section
response, and typed errors (`ServerDownError`, `BlockedReportError`,
`NoDataFoundError`, `InvalidCredentialsError`, `StudentNotFoundError`).

## Leaderboard ranking

Scores are projected into `student_stats` when a section response is cached.
Ranks use `RANK()` over the **rounded** score only; the deterministic tiebreak
(`roll_no`) is applied in the outer `ORDER BY`. Adding a tiebreaker inside the
window `ORDER BY` makes Turso compute ranks over the full composite and collapse
ties — see the notes in `src/db/student_stats.model.ts`.

## Further reading

- [`openwiki/quickstart.md`](openwiki/quickstart.md) — wiki entry point
- [`openwiki/architecture.md`](openwiki/architecture.md) — runtime topology
- [`openwiki/portal/scraping.md`](openwiki/portal/scraping.md) — portal details
- [`openwiki/data/caching-and-stats.md`](openwiki/data/caching-and-stats.md) — caches and ranking
- [`openwiki/api/admin-panel.md`](openwiki/api/admin-panel.md) — admin panel
