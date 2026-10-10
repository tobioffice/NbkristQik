---
type: reference
title: Bot Commands and Authorization
description: Every Telegram bot command and its access rules, the shared authorization gate combining channel membership and the daily check-in unlock, and the special handling of the protected and chit-chat groups.
tags: [telegram, commands, authorization, membership, groups]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-09T23:13:13.880Z
sources:
  - id: openwiki-source-04d02aea694a5ea720fe8290
    resource: repo://src/bot/academics/academicHandler.ts
  - id: openwiki-source-6c7324f06cdecc8331ea5889
    resource: repo://src/bot/commands/help.ts
  - id: openwiki-source-a5076d4fd97354fd817e65d6
    resource: repo://src/bot/commands/leaderboard.ts
  - id: openwiki-source-c86189a5f8e6fd33c86b338e
    resource: repo://src/bot/commands/registered.ts
  - id: openwiki-source-308f6e34ec7631b1d21bdb80
    resource: repo://src/bot/commands/report.ts
  - id: openwiki-source-fa3223f94368ddae4eaa77ed
    resource: repo://src/bot/commands/start.ts
  - id: openwiki-source-f7b94ca1aeafebacf0189de2
    resource: repo://src/bot/dailyCheckIn.ts
  - id: openwiki-source-a2138ded0dee8ee4f9165d66
    resource: repo://src/bot/setup.ts
  - id: openwiki-source-2c2f76c1ef875a091a93cc02
    resource: repo://src/bot/syncdb.ts
  - id: openwiki-source-f3a065ecee23ee5a53fe9d83
    resource: repo://src/constants/index.ts
  - id: openwiki-source-bee4bb8d3bf8f1191c290348
    resource: repo://src/services/student.utils/checkMembership.ts
generated: { by: "opencode", at: "2026-10-09T23:13:13.880Z" }
---

# Bot Commands and Authorization

All bot handlers live under `src/bot/` and register themselves on import; `setupBot` additionally advertises the public command list to Telegram (`src/bot/setup.ts`): `/start`, `/attendance`, `/midmarks`, `/bunk`, `/register`, `/report`, `/help`, and `/leaderboard`. Command names are sent **without** the leading slash because that is what Telegram's `setMyCommands` API requires, and the call's failure is logged rather than swallowed. The hidden admin commands (`/setsem`, `/syncdb`, `/postcheckin`) are registered by their modules but deliberately not advertised.

## Commands

| Command | Trigger | Who | Behavior |
|---|---|---|---|
| `/start` | `/\/start(?:\s+(.+))?/` | anyone | Welcome text asking for a roll number. A `?start=unlocked` deep-link payload gets a dedicated "You're unlocked for today!" message (`src/bot/commands/start.ts`). |
| `/help` | `/\/help/` | anyone | Short usage instructions: send a roll number for attendance and mid-marks, plus a pointer to the registered shortcuts (`src/bot/commands/help.ts`). |
| `/report [message]` | `/\/report$/` and `/\/report (.+)/` | anyone | Without a message, explains the syntax. With a message, forwards it to `ADMIN_ID` with the sender's name, ID, and HTML-escaped text, then confirms to the user. If `ADMIN_ID` is unset the report is dropped with a warning (`src/bot/commands/report.ts`). |
| `/leaderboard` | `/\/leaderboard/` | anyone | Sends a button opening the Telegram Web App leaderboard (`src/bot/commands/leaderboard.ts`). |
| `/register` | `/\/register/` | anyone | Explains optional registration and opens the standalone profile mini app via a `web_app` button (`src/bot/commands/register.ts`). |
| `/attendance` | `/\/attendance/` | registered | Instant attendance for the caller's registered roll (`src/bot/commands/registered.ts`). |
| `/midmarks` | `/\/midmarks/` | registered | Instant mid-term marks for the registered roll. |
| `/bunk` | `/\/bunk/` | registered | Instant bunk plan for the registered roll. |
| `/setsem 1\|2` | `/\/setsem ?([12])?$/` | admin | Sets/reports the active semester type for sync (`src/bot/syncdb.ts:337-362`). See [Daily Check-in and Semester Sync](checkin-and-syncdb.md). |
| `/syncdb [1\|2] [YYYY-YY]` | `/\/syncdb( .+)?$/` | admin | Runs the semester rollover scrape (`src/bot/syncdb.ts:366-466`). |
| `/postcheckin` | `/\/postcheckin/` | admin | Posts and pins the daily check-in message (`src/bot/dailyCheckIn.ts:104-124`). |

Admin commands compare `msg.from?.id !== ADMIN_ID` and silently return for non-admins — there is no rejection message, so the commands are invisible to regular users.

Roll-number messages are not commands: any text matching `ROLL_REGEX` enters the academic menu flow described in [Academic Data Flow](academic-flow.md).

## Registered shortcut commands

`/attendance`, `/midmarks`, and `/bunk` are thin wrappers around the same `studentActions` flow used by the inline menu, with three extra steps (`src/bot/commands/registered.ts`):

1. **Chit-chat silence** — in `CHIT_CHAT_ID` the command message is deleted and nothing else happens.
2. **Same gates** — rate limit, channel membership, and the daily check-in gate all apply exactly as in the roll-number flow.
3. **Registered roll resolution** — `resolveRegisteredRoll` looks up the caller's registration row; if none exists the bot sends a prompt with a "Register your roll" `web_app` button; if the registered roll has left `studentsnew` (semester rollover) the bot sends an update-your-profile prompt; otherwise it refreshes the `tgusers` mapping and returns the roll.

`/attendance` and `/midmarks` dispatch to `sendAttendanceOrMidMarks`, `/bunk` to `sendBunkPlan`, both producing the same placeholder-then-edit replies. See [Registration and Profile](../registration.md) for the registration side.

## The authorization gate

`isAuthorizedUser(userId, chatId)` (`src/bot/academics/academicHandler.ts:40-90`) guards every roll lookup, registered shortcut, and academic callback, in this order:

1. **Admin bypass** — `userId === ADMIN_ID` is always allowed.
2. **Cached membership** — check the `redisKeys.isMember(userId)` Redis key for the literal `"true"`; a Redis failure logs and falls through to the live check instead of failing.
3. **Live membership** — on cache miss, `checkMembership(userId)` calls `bot.getChatMember(CHANNEL_ID, userId)` and treats `member`, `creator`, and `administrator` as members, caching a positive result for 24 hours (`src/services/student.utils/checkMembership.ts`). Negative results are not cached, so rejoining is picked up immediately. A throwing membership check is treated as "allow" rather than locking users out.
4. **Join prompt** — non-members outside `PROTECTED_CHAT_ID` receive a "Join our channel to use the bot in private" message with a join button, and the request stops. Inside the protected group, membership is waived so the bot works there.
5. **Daily check-in gate** — `isDailyUnlocked(userId)` may require tapping the pinned channel button (see the dedicated page). On failure the bot replies with the "Prove you're human!" prompt — in the group when used there, in DM otherwise.
6. **Broadcast audience** — authorized user IDs are added to the `redisKeys.broadcastUsers` (`qik:users`) Redis set (best-effort; failures are logged and never block).

## Special groups

`src/constants/index.ts` defines two hardcoded chat IDs with distinct behavior:

- **`PROTECTED_CHAT_ID`** (`-1002435023187`) — a group where channel membership is not required (step 4 above is skipped).
- **`CHIT_CHAT_ID`** (`-1003179479637`) — a chat where the bot is effectively silent: roll-number messages are deleted with a self-deleting 15-second notice pointing users to DM, and callback taps are answered with a "The bot doesn't reply here" alert rather than executed (`src/bot/academics/academicHandler.ts:167-208`).

## Callback handling

Academic inline buttons (attendance, mid-marks, bunk plan) are handled by a shared `callback_query` listener wrapped in a try/catch that answers with an error alert on unexpected failures. The daily check-in's `dailycheck` callback is explicitly ignored there because it is fully owned by `dailyCheckIn.ts`; otherwise it would be rate-limited and the pinned channel post deleted. See [Academic Data Flow](academic-flow.md) for the full callback dispatch.

## Related pages

- [Academic Data Flow](academic-flow.md)
- [Registration and Profile](../registration.md)
- [Daily Check-in and Semester Sync](checkin-and-syncdb.md)
- [Runtime Architecture](../architecture.md)
