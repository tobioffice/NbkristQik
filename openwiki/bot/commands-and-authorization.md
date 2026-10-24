---
type: reference
title: Bot Commands and Authorization
description: Every Telegram command and its access rules, the one shared authorization gate in bot/authorization.ts, the shared reply copy, the library entry, and the channel and chit-chat special cases.
tags: [bot, commands, authorization, membership, telegram]
sources:
  - id: openwiki-source-04d02aea694a5ea720fe8290
    resource: repo://src/bot/academics/academicHandler.ts
  - id: openwiki-source-9628533565ba429ce21df54f
    resource: repo://src/bot/authorization.ts
  - id: openwiki-source-4619143558848c5c520eb41f
    resource: repo://src/bot/commands/library.ts
  - id: openwiki-source-c86189a5f8e6fd33c86b338e
    resource: repo://src/bot/commands/registered.ts
  - id: openwiki-source-308f6e34ec7631b1d21bdb80
    resource: repo://src/bot/commands/report.ts
  - id: openwiki-source-fa3223f94368ddae4eaa77ed
    resource: repo://src/bot/commands/start.ts
  - id: openwiki-source-3ebd6f4f014383801d77ef53
    resource: repo://src/bot/commands/startPayload.ts
  - id: openwiki-source-6f6092aa1dab5986520d8c68
    resource: repo://src/bot/mentionNormalizer.ts
  - id: openwiki-source-1d45088626f10df0fdd2b150
    resource: repo://src/bot/replies.ts
  - id: openwiki-source-a2138ded0dee8ee4f9165d66
    resource: repo://src/bot/setup.ts
  - id: openwiki-source-2c2f76c1ef875a091a93cc02
    resource: repo://src/bot/syncdb.ts
  - id: openwiki-source-f3a065ecee23ee5a53fe9d83
    resource: repo://src/constants/index.ts
  - id: openwiki-source-01c18f4f46266f7ff236c3b4
    resource: repo://src/constants/telegram.ts
  - id: openwiki-source-87c47a793c4a631e2439348f
    resource: repo://src/constants/webapp.ts
  - id: openwiki-source-bee4bb8d3bf8f1191c290348
    resource: repo://src/services/student.utils/checkMembership.ts
  - id: openwiki-source-a7cc3bce3c9730332b62de43
    resource: repo://src/web/src/AppShell.tsx
generated: { by: "opencode", at: "2026-10-24T11:41:29.189Z" }
verified:
  - by: openwiki/0.7.2
    at: 2026-10-24T11:41:29.189Z
---

# Bot Commands and Authorization

All bot handlers live under `src/bot/` and register themselves on import; `setupBot` additionally advertises the public command list to Telegram (`src/bot/setup.ts`): `/start`, `/attendance`, `/midmarks`, `/bunk`, `/register`, `/report`, `/help`, and `/leaderboard`, plus `/library` once `LIBRARY_ACCESS=all`. Command names are sent **without** the leading slash because that is what Telegram's `setMyCommands` API requires, and the call's failure is logged rather than swallowed. The hidden admin commands (`/setsem`, `/syncdb`, `/postcheckin`, `/postopen`) are registered by their modules but deliberately not advertised.

The chat **menu button** is always the app, labelled "Open app": every button in the bot now points into one web app (see [Web App](../web/leaderboard.md)), and the register, the roll and the issue desk are useful whatever the shelf holds. While the library is still the admin's, the button opens the shelf section instead, since that is the page being worked on. Only the command list follows `LIBRARY_ACCESS`.

## Commands

| Command | Trigger | Who | Behavior |
|---|---|---|---|
| `/start` | `/^\/start/` | anyone | Welcome text with the sender's first name, asking for a roll number. `?start=library` is the exception: it opens the library entry instead (see below). |
| `/help` | `/\/help/` | anyone | Usage instructions: send a roll number for attendance and mid-marks; `/register` enables the one-tap `/attendance`, `/midmarks`, `/bunk` shortcuts; `/report` files a trackable issue. |
| `/report [message]` | `/\/report$/` and `/\/report (.+)/` | anyone | Bare `/report` opens the issue form plus a "My reports" button (web_app buttons in private chats, URL buttons in groups). `/report <message>` files a tracked report through the report service — 10–1000 characters, one report per minute per user — which DMs the issue id; groups get an inline confirmation too. |
| `/leaderboard` | `/\/leaderboard/` | anyone | Sends a button opening the Telegram Web App leaderboard. |
| `/register` | `/\/register/` | anyone | Explains optional registration and opens the standalone profile mini app via a `web_app` button. |
| `/library` | `/^\/library$/` | admin, or everyone once the library is open | Sends "Your subjects, ready to read." with a one-tap button into the app's library section (`#/library`) — a `web_app` button in private, a plain URL in a group. Closed to non-admins, who get a single line in private and nothing at all in a group. See [Library Subsystem](../library/overview.md). |
| `/attendance` | `/\/attendance/` | registered | Instant attendance for the caller's registered roll. |
| `/midmarks` | `/\/midmarks/` | registered | Instant mid-term marks for the registered roll. |
| `/bunk` | `/\/bunk/` | registered | Instant bunk plan for the registered roll. |
| `/setsem 1\|2` | `/\/setsem ?([12])?$/` | admin | Sets/reports the active semester type for sync. See [Semester Sync](checkin-and-syncdb.md). |
| `/syncdb [1\|2] [YYYY-YY]` | `/\/syncdb( .+)?$/` | admin | Runs the semester rollover scrape. |
| `/postcheckin` | `/^\/postcheckin$/` | admin | Posts and pins today's check-in card and turns the gate on. See [Semester Sync and Daily Check-in](checkin-and-syncdb.md). |
| `/postopen` | `/\/postopen$/` | admin | Reposts the "open me in private" card to the channel. |

Admin commands compare `msg.from?.id !== ADMIN_ID` and silently return for non-admins — there is no rejection message, so the commands are invisible to regular users.

Roll-number messages are not commands: any text matching `ROLL_REGEX` enters the academic menu flow described in [Academic Data Flow](academic-flow.md).

## The `/start` payload

`startPayload(text)` (`src/bot/commands/startPayload.ts`) reads the argument of `/start <payload>`, which is how `https://t.me/<bot>?start=library` reaches the handler. The only payload the bot acts on today is `library` (case-insensitive): it calls `sendLibraryEntry`, the same function `/library` uses, so the channel's "Open the library" button and the command cannot diverge — both land on the app's `#/library` route. Anything else falls through to the ordinary welcome. The welcome text escapes the first name through `escapeHtml` before it is put in HTML.

## Group mention normalization

In groups Telegram appends the bot username to typed commands (`/report@NbkristQik_bot`), which an anchored `/^\/report$/` would never match. `stripOwnMention` (`src/bot/mentionNormalizer.ts`) rewrites `/cmd@OURBOT` to `/cmd` on every incoming message before the handlers see it, and leaves commands addressed to another bot alone so they stay ignored, as Telegram intends. The username itself, the channel username and the deep-link builders (`botLink`, `channelLink`) live in `src/constants/telegram.ts`.

## The app links

Every button that leaves the chat points into the app, and the URLs are built in one place, `src/constants/webapp.ts`: `APP_WEBAPP_URL` for the index, and hash routes for the register (`#/rank`), the roll (`#/profile`), the shelf (`#/library`) and the issue desk (`#/issues`, `#/issues/reports`, `#/issues/QIK-0007`). The hash routes must match `parseRoute` in `src/web/src/AppShell.tsx`; a link that does not is silently treated as the index.

## Shared reply copy

The sentences a student can see twice live in `src/bot/replies.ts`: the rate-limit line, the "something broke" apology, the bad-roll line, the check-in prompt and the join-the-channel line. Both the roll-number flow and the registered shortcuts send the same words for the same situation.

## Registered shortcut commands

`/attendance`, `/midmarks`, and `/bunk` are thin wrappers around the same `studentActions` flow used by the inline menu, with three extra steps (`src/bot/commands/registered.ts`):

1. **Chit-chat silence** — in `CHIT_CHAT_ID` the command message is deleted and nothing else happens.
2. **Same gates** — the command rate limit and the shared authorization gate apply exactly as in the roll-number flow.
3. **Registered roll resolution** — `resolveRegisteredRoll` looks up the caller's registration row; if none exists the bot sends a prompt with a "Register your roll" `web_app` button; if the registered roll has left `studentsnew` (semester rollover) the bot sends an update-your-profile prompt; otherwise it refreshes the `tgusers` mapping and returns the roll.

The three lookups are one `Lookup` union and one handler, with the tracked activity name in a `LOOKUP_TRACKED_AS` map, so adding a fourth shortcut is a map entry rather than a fourth copy of the gate order.

## The authorization gate

`isAuthorizedUser` (`src/bot/authorization.ts`) is the only gate: the roll-number flow, the registered shortcuts, the academic callbacks and any future entry point all call it, so there is one order to know and one place to change. It takes `{userId, chatId, replyToMessageId?, joinPromptChatId?}` and runs:

1. **Admin bypass** — `userId === ADMIN_ID` is always allowed, with no membership check and no check-in.
2. **Cached membership** — check the `redisKeys.isMember(userId)` Redis key for the literal `"true"`; a Redis failure logs and falls through to the live check instead of failing.
3. **Live membership** — on cache miss, `checkMembership(userId)` calls `bot.getChatMember(CHANNEL_ID, userId)` and treats `member`, `creator`, and `administrator` as members, caching a positive result for 24 hours. Negative results are not cached, so rejoining is picked up immediately. A throwing membership check is treated as "allow" rather than locking users out.
4. **Join prompt** — non-members outside `PROTECTED_CHAT_ID` receive the join card, which by default goes to the chat that asked; the roll-number flow overrides that with `joinPromptChatId: userId` so a group never sees a card meant for one reader. Inside the protected group, membership is waived so the bot works there.
5. **Daily check-in** — a student who has not tapped today's check-in gets the pinned post's link instead of their answer.
6. **Broadcast audience** — `rememberStudent(userId)` adds the caller to the `qik:users` set (best-effort; failures are logged and never block).

## Special groups

`src/constants/index.ts` defines two hardcoded chat IDs with distinct behavior:

- **`PROTECTED_CHAT_ID`** (`-1002435023187`) — a group where channel membership is not required (step 4 above is skipped).
- **`CHIT_CHAT_ID`** (`-1003179479637`) — a chat where the bot is effectively silent: roll-number messages are deleted with a self-deleting 15-second notice pointing users to DM, and callback taps are answered with a "The bot doesn't reply here" alert rather than executed.

## Callback handling

Academic inline buttons (attendance, mid-marks, bunk plan) are handled by a shared `callback_query` listener wrapped in a try/catch that answers with an error alert on unexpected failures. Inside, channel taps are dismissed, chit-chat taps are answered and dropped, then the command rate limit and the shared authorization gate apply. `dailycheck` taps are left entirely to `src/bot/dailyCheckIn.ts`. See [Academic Data Flow](academic-flow.md) for the full callback dispatch.

## Related pages

- [Academic Data Flow](academic-flow.md)
- [Library Subsystem](../library/overview.md)
- [Registration and Profile](../registration.md)
- [Semester Sync and Daily Check-in](checkin-and-syncdb.md)
- [Runtime Architecture](../architecture.md)
