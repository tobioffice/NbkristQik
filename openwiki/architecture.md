---
type: architecture
title: Runtime Architecture
description: Single-process runtime topology and lifecycle for NbkristQik — ordered startup of Turso schema init, self-registering bot handlers, and the Express API, plus component data flow and graceful shutdown.
tags: [architecture, lifecycle, runtime, telegram, express]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-09T23:13:13.880Z
sources:
  - id: openwiki-source-4c68ade5fe3d6523fb58350d
    resource: repo://src/bot/bot.ts
  - id: openwiki-source-70ae228271bbdb1aff4dc249
    resource: repo://src/bot/index.ts
  - id: openwiki-source-f11b9279af821abdb3463e06
    resource: repo://src/config/environmentals.ts
  - id: openwiki-source-51ebf01a6987b9612a7dd707
    resource: repo://src/db/init.ts
  - id: openwiki-source-290cb8a0cd25881741257ea3
    resource: repo://src/services/redis/getRedisClient.ts
  - id: openwiki-source-0be99d3f1664956f03d52278
    resource: repo://src/services/uptime.ts
generated: { by: "opencode", at: "2026-10-09T23:13:13.880Z" }
---

# Runtime Architecture

NbkristQik runs as a **single Node.js process**. The Telegram bot and the Express API are not separate services: `src/bot/index.ts` boots both, and the bot only starts polling after schema init, every handler module has registered itself, and the API server is listening.

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
graph TB
    subgraph Clients
        TG[Telegram users]
        WEB[Leaderboard and Profile Web Apps<br/>GitHub Pages]
        OPS[Operator browser<br/>admin panel]
    end

    subgraph "Node process"
        BOT[Telegram bot<br/>node-telegram-bot-api]
        HANDLERS[Command / callback handlers<br/>self-register on import]
        API[Express API<br/>src/api/server.ts]
        UPTIME[Uptime probes every 5 min<br/>api / turso / redis / portal]
        TRACK[Activity tracker]
    end

    subgraph Data and external
        REDIS[(Redis cache)]
        TURSO[(Turso / libSQL)]
        PORTAL[College portal<br/>HTTP]
    end

    TG -->|getUpdates polling| BOT
    WEB -->|HTTPS /api| API
    OPS -->|session cookie| API
    BOT --> HANDLERS
    HANDLERS --> TRACK
    HANDLERS --> PORTAL
    HANDLERS --> REDIS
    HANDLERS --> TURSO
    API --> REDIS
    API --> TURSO
    UPTIME --> API
    UPTIME --> TURSO
    UPTIME --> REDIS
    UPTIME --> PORTAL
    TRACK --> TURSO
```

## Startup sequence

`startBot()` in `src/bot/index.ts:38-83` runs these steps in order:

1. **Warn on missing admin** — if `ADMIN_ID` is unset, admin commands and report forwarding are disabled (`src/bot/index.ts:40-44`).
2. **`initDatabase()`** — the single schema entry point (`src/db/init.ts:12-86`) creates every table and index (fallbackResponses, tgusers, studentsnew, botusers, activity_log, admin_sessions, registrations, student_stats, uptime_log) before anything reads or writes.
3. **`setupBot(bot)`** — registers the command list shown in Telegram's menu (`src/bot/setup.ts`).
4. **Dynamic `import()` of all handler modules** — `help`, `start`, `report`, `leaderboard`, `register`, `registered`, `academicHandler`, `dailyCheckIn`, `syncdb`, `uptime`, and the API server (`src/bot/index.ts:53-65`). Registration happens as an import side effect; see below.
5. **Explicit setup calls** — `registerSyncDbCommand()`, `startUptimeMonitor()`, `startServer()`.
6. **`bot.startPolling()` last** — the bot is exposed to Telegram only when DB, handlers, and API are all ready (`src/bot/index.ts:74-76`).

This ordering is the reason `fetchFresh` in the scraper can assume `studentsnew` exists and why a fresh database boots cleanly.

## Handler registration by import side effect

`src/bot/bot.ts:17` creates the `TelegramBot` instance with `polling: false`. Each command and feature module calls `bot.onText(...)` or `bot.on("callback_query", ...)` at module scope — for example `src/bot/commands/start.ts`, `src/bot/commands/register.ts`, `src/bot/commands/registered.ts`, `src/bot/academics/academicHandler.ts`, and `src/bot/dailyCheckIn.ts`. Importing the module *is* the registration.

`bot.ts` also exits the process when no Telegram token is configured, except under `NODE_ENV=test`, where it falls back to a dummy token so tests can import modules (`src/bot/bot.ts:7-14`).

Configuration is read once in `src/config/environmentals.ts`: the bot token switches between `TELEGRAM_BOT_TOKEN` (production) and `TELEGRAM_BOT_TOKEN_DEV`, and the channel between `PROD_CHANNEL` and `TEST_CHANNEL`, based on `ENV`. The portal base URL is a constants-level value (`BASE_URL` in `src/constants/index.ts`) overridable with `PORTAL_BASE_URL`. The CORS allowlist comes from `CORS_ORIGINS` (default `https://tobioffice.github.io`).

## API and uptime

`startServer()` binds Express on `PORT` (`src/api/server.ts:264-272`). The app trusts one proxy hop for nginx and serves the leaderboard, `/api/me`, `/api/profile`, `/api/register`, `/health`, `/api/status`, and the admin panel under its secret path. See [REST API and Security](api/server.md) and [Admin Panel](api/admin-panel.md).

`startUptimeMonitor()` (`src/services/uptime.ts:150-168`) is idempotent (`inited` guard), takes an initial probe after 15 seconds so the API can bind first, then probes four components every 5 minutes — `api` (local `/health`), `turso` (`SELECT 1`), `redis` (PING), and `portal` (HTTP GET of the portal base URL) — recording per-component heartbeats to Turso. Up/down transitions DM the admin. A daily job prunes uptime rows, activity log rows (95-day retention), and expired admin sessions.

## Redis failure cooldown

`getClient()` (`src/services/redis/getRedisClient.ts`) caches the connect promise so concurrent first callers share one client. A failed connect clears the promise and records `lastFailureAt`; for the next 30 seconds callers get an immediate rejection (`Redis connect in cooldown after failure`) instead of re-paying the full reconnect timeout on every request. The reconnect strategy itself is bounded to about four attempts.

## Graceful shutdown

`SIGINT` and `SIGTERM` are handled once each by `shutdown()` (`src/bot/index.ts:14-36`):

1. Set a `shuttingDown` guard so repeated signals are ignored.
2. `bot.stopPolling({cancel: true})`, swallowing errors if polling already stopped.
3. Dynamically import the Redis client and `disconnect()`, tolerating a Redis that never connected.
4. `process.exit(0)`.

An `unhandledRejection` handler logs rejections rather than crashing the process (`src/bot/index.ts:7-9`).

## Cross-cutting patterns

- **Best-effort side effects** — activity tracking, roll mapping persistence (`persistRollMapping`), and section cache writes are all fire-and-forget; failures are logged at debug/warn level and never block a user reply.
- **Degrade instead of fail** — Redis failures fall through to Turso or the portal; the connect cooldown keeps request latency bounded while Redis is down.
- **Typed error propagation** — the scraping layer distinguishes "portal down" (fallback/ServerDownError) from "student not in records" (StudentNotFoundError), so a missing roll is never masked as an outage.

## Related pages

- [Overview](overview.md)
- [Registration and Profile](registration.md)
- [Bot Commands and Authorization](bot/commands-and-authorization.md)
- [REST API and Security](api/server.md)
- [Caching and Leaderboard Stats](data/caching-and-stats.md)
