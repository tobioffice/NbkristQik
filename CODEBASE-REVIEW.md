# NbkristQik — whole-codebase review

**Date:** 4 November 2026  
**Scope:** every surface in the repository — bot, API, database, library, admin panel, status page, web apps, tests, CI and deployment.  
**Method:** a lead review plus seven independent critics (architecture, security/privacy, data/reliability, product/UX, frontend, testing/CI/ops, maintainability) and a judge agent that re-checked the highest-impact claims and adjudicated the findings. All criticism below is source-grounded.

> **Resolution (4 November 2026):** the actionable findings in this review were implemented in the same session. See [`FIXES.md`](FIXES.md) for the change record, verification results and the deliberately deferred product decisions. This document is the "before" picture; `FIXES.md` is the "after".

---

## 1. Bird's-eye view

NbkristQik is a campus utility with unusually wide reach for its size: a Telegram bot, an Express API, four web surfaces, an admin panel, an external uptime monitor and a static marketing site — all maintained by one person for one college.

### What it does

- **Core loop:** a student sends a roll number in Telegram and gets attendance, mid-term marks and a bunk plan read from the college portal.
- **Retention loop:** an optional roll registration, a live leaderboard, a daily channel check-in, and a threaded issue desk.
- **Content bet:** a Telegram-only, watermarked, page-by-page library of semester material. The shelf is currently admin-only.
- **Operator loop:** a private admin panel (overview, students, live feed, reports, health), a public 90-day status page, and an external monitor that alerts on state changes.

### Runtime shape

```
Telegram users ──> bot (long polling) ──> portal scraper ──> college portal (plain HTTP)
                       │                       │
                       ├──> Redis cache ───────┘
                       ├──> libSQL (embedded SQLite or Turso)
                       └──> activity tracker ──> libSQL
Mini apps ──> Express API ──> Redis + libSQL
Operator ──> admin panel (Express, session cookie)
oracle2 monitor ──> /internal/health + /internal/uptime ──> Express (oracle3)
```

One Node process serves the bot, API, admin panel and status data. The mini app is served same-origin at `/library/`; the marketing site is static on GitHub Pages. The schema is created idempotently at boot; there is no migration step. The monitor is a separate, dependency-free program on a second host.

### Code map

| Area | What lives there | Size |
|---|---|---|
| `src/bot/` | entry point, commands, academic flow, daily check-in, `/syncdb` | ~2.1k LOC |
| `src/api/` | Express app, public/identity routes, admin panel, internal routes | ~3.6k LOC |
| `src/db/` | libSQL client, schema, models (students, stats, reports, library) | ~1.5k LOC |
| `src/services/` | portal scraper, Redis, tracker, reports, library, maintenance | ~3.2k LOC |
| `src/monitor/` | external uptime probes, spool, alerts | ~0.7k LOC |
| `src/web/` | React 19 mini apps, reader, static site | ~7.1k LOC |
| `tests/` | 35 files, 270 tests | ~4.6k LOC |

### Baseline evidence

- `tsc --noEmit`: clean.
- ESLint over `src` and `tests`: clean.
- Vitest: **35 files / 270 tests pass in ~1.7s**.
- Coverage: **59.34% statements, 73.49% branches, 73.07% functions, 59.34% lines** — against a configured floor of 25/55/40/25.
- Git: `main`, last commit 27 Oct 2026, 21 uncommitted paths (the external-monitor split).
- Environment: Node 20 pinned in CI and `.nvmrc`; Node 20 reached end-of-life in April 2026.

### What is genuinely good

1. **The design system is real.** `DESIGN.md` is binding, the tokens are machine-readable, the register metaphor is carried through the leaderboard, profile, issue desk, status page and admin panel, and measured contrast/focus/reduced-motion are present rather than asserted.
2. **The security thinking is above average.** Library sessions are 32-byte Redis cookies with HttpOnly/Secure/SameSite=strict and per-page entitlement re-checks; admin sessions store only `HMAC(token, password)`; `/internal` hashes both sides before `timingSafeEqual`; SQL is parameterized; Telegram HTML and SVG share one `escapeHtml`.
3. **The data layer has good bones.** Report threads are atomically batched, startup order is fail-closed (schema → handlers → API → polling), UTC storage with IST at the edges is consistent, and Redis is treated as a cache with a cooldown rather than a hard dependency in most paths.
4. **The frontend has taste and memory discipline.** The leaderboard aborts superseded requests and never wipes a loaded sheet on a failed later page; the reader holds a small page window and releases distant pages on visibility change; back-button and band/stamp contracts handle Telegram WebView quirks deliberately.
5. **The external monitor is well built.** `assertConfig` refuses weak secrets and plain HTTP, redirects are disabled so the bearer is never replayed, spool/state writes are atomic and 0600, and the systemd unit is hardened.

The rest of this review is about where that quality stops.

---

## 2. The seven critics in one page

| Lens | Verdict in one line | Strongest finding | Main overreach / caveat |
|---|---|---|---|
| **Architecture** | Right shape for one maintainer; the split stops at the deployment boundary. | The status page the monitor work edits has no `/status` route and is not shipped by `deploy.sh`. | The API-doesn't-run-without-bot coupling is real but not urgent; the API is intentionally in-process. |
| **Security & privacy** | No RCE; the carefully designed surfaces are solid; the unowned ones leak. | A 24-hour Telegram `initData` bearer is placed in GET query strings on `/api/me`, `/api/profile`, `/api/myreports`, `/api/thread`. | Roll-claiming (no unique index) is social identity, not a data breach; it is dormant while the library is admin-only. |
| **Data & reliability** | Two live ways to publish wrong numbers: leaderboard writes gated behind Redis, and SQLite in rollback-journal mode with no busy timeout. | `persistSectionWrites` calls `getClient()` before writing any stat, so a Redis outage silently freezes every rank. | The migration finding assumes a fresh local DB; if `studentsnew` is populated by a prior sync, the cutover is safe. |
| **Product & UX** | Core loop is good; the front door is jammed. | The daily "I'm a robot" gate throws away the roll lookup it interrupted, every day. | "Attention farm" is an internal comment, not necessarily the owner's product intent; but the user impact is real. |
| **Frontend** | Best design system in the repo; the shipped shell is the artifact CI never builds. | `/library/` HTML is cached for an hour while deploy deletes the hashed assets it references. | The white-sheet hit rate depends on Telegram WebView caching; the mechanism is certain, the frequency is not. |
| **Testing/CI/ops** | A green suite that proves less than it appears to. | `scripts/deploy.sh` ships the working tree, `rsync --delete`s the old build, applies boot-time migrations, and has no rollback. | Whether nginx hand-serves `/status` or `/internal` is not in the repo; verify on oracle3. |
| **Maintainability** | No fire; compounding interest. | The 95-day retention job never runs at normal deploy cadence, because every restart re-arms a 24-hour timer. | The status-page deploy gap is inferred from scripts; an out-of-repo nginx alias could explain it. |

### The findings that recur across critics

These are the ones to treat as structural, not stylistic:

1. **Deployment is not a release process.** It ships a dirty working tree, deletes the old build before proving the new one, runs schema init at boot with no rollback, and verifies only `systemctl is-active`.
2. **The shell users open is not the artifact CI builds.** CI builds the legacy GitHub Pages pages; `deploy.sh` builds the library app. There is no CI build of `/library/`, no render test, and no `no-cache` on its HTML.
3. **Identity is leaky in the read paths and fail-open in configuration.** `initData` in query strings; `ENV=development` accepts bare `userId`; leaderboard is unauthenticated.
4. **The leaderboard's data path has a hidden hard dependency on Redis.** A cache outage stops `student_stats` writes without an error the operator sees.
5. **The Turso→embedded cutover is not safe as written.** The merge tool omits `studentsnew` and `student_stats`; SQLite is not in WAL and has no busy timeout, so the nightly `VACUUM INTO` can make writes fail instantly.
6. **The product front door contradicts the product promise.** The menu button opens a closed library; the daily gate discards the lookup; cached portal data is served as if fresh; non-consenting students' names and marks are public.
7. **The library is a large, closed bet.** ~3.6k lines of backend + reader code, phases 6–7 unbuilt, no corpus in the repo, and a tab/index row visible to students who cannot use it.

---

## 3. Judge's synthesis

### Verdict

NbkristQik is a real, useful product: a Telegram attendance and mid-marks checker with a register-style leaderboard, issue threads and a carefully designed mini app, built by one person for one college. The core loop works and the craft is well above the norm for a solo project. Its state is **good bones, pre-launch discipline**: the front door is broken, the deploy cannot roll back, and the data path has several silent-failure modes. The central risk is not a crash — it is **confidently presenting stale, partial or fabricated numbers as current**, while a deploy ships uncommitted work that removes the old uptime probe before its replacement exists.

### Scorecard

| Area | Grade | Why |
|---|---|---|
| Architecture | **B−** | Right single-process shape; but the API depends on the bot singleton, private routes ride the public listener, command registration is an untyped side-effect list, config is spread across a dozen files. |
| Security / privacy | **C+** | Library sessions, admin cookies, report authorization and SQL are well built; `initData` travels in URLs and named marks are public. No unauthenticated RCE. |
| Data / reliability | **C** | Redis gates every `student_stats` write, embedded SQLite has no WAL or busy timeout, the cutover import omits the student directory, `/syncdb` reports success on partial scrapes, retention never starts. |
| Product / UX | **B−** | Core loop and register metaphor are strong; the menu button opens a closed library, the daily check-in loses the lookup it interrupts, stale cache is unlabeled, the library is a dead end for students. |
| Frontend | **B−** | Design system is the best part; the shipped shell is cached for an hour while hashed assets are deleted on deploy, most requests have no timeout, drafts die on tab change, pinch zoom is disabled. |
| Testing / ops | **C−** | 270 green tests prove less than they seem: the portal parser fixture produces zero subjects, monitor failure paths are untested, deploy has no rollback, backup failures are warnings, CI runs EOL Node 20. |
| Maintainability | **B−** | Strict TypeScript, zero `any`, good docs; but a 39.6 KB untested admin template, tests never typechecked, dead code kept alive by a test, retention tied to process uptime. |

### The seven changes that matter now (ordered)

#### 1. Make deploy reversible, complete and cache-correct — **ship blocker**

- **Change:** clean-tree guard; build to `dist.new`, keep `dist.prev`; `VACUUM INTO` before restart; restart; curl `/health`, `/status`, `/library/` and authenticated `/internal/health`; roll back on failure. Serve the status page from Express or copy it into the shipped tree. `Cache-Control: no-store` (or `no-cache`) for HTML, `immutable` for `/assets/*`.
- **Evidence:** `scripts/deploy.sh:22-49` has no git check, no `dist.prev`, only `is-active`; `rsync --delete` removes the old build. `src/api/server.ts:54-68` caches the whole library mount for an hour and has no `/status` route, while `README.md:217` advertises `/status` live. `src/status/index.html:150` fetches `/api/status`.
- **Why now:** the working tree removes the old in-process uptime probe, so a normal deploy can freeze the status page. The status page is advertised but not shipped by the repo's deploy path.
- **Effort:** M. **Success:** a clean-tree deploy returns 200 on all four URLs; a forced bad build leaves the previous build serving in under five minutes; a second deploy never makes a cached shell request a deleted asset.

#### 2. Fix the front door: menu button and closed library — **ship blocker**

- **Change:** always point the persistent menu button at `APP_WEBAPP_URL`. Hide the Library tab and index row unless `libraryOpenToAll` is true (add a small `GET /api/config` if needed). Delete “I'll tell you here when it does,” or implement the notification.
- **Evidence:** `src/bot/setup.ts:29-32` sends every user to `LIBRARY_WEBAPP_URL` while `src/services/library/access.ts:14-19` defaults to admin-only; `src/web/src/views/LibraryView.tsx:90` renders “The library opens soon”; `src/web/src/AppShell.tsx:196-205` renders the library route, and the tab is unconditional at `:229-247`. `src/bot/commands/library.ts:22` promises a ping that does not exist.
- **Why now:** every student's one-tap entry opens a dead shelf. One-file bug, highest-visibility product defect.
- **Effort:** S. **Success:** a non-admin account taps the menu button and lands on the app index; no menu-reachable screen says “The library opens soon.”

#### 3. Make the leaderboard write path durable — **ship blocker**

- **Change:** in `persistSectionWrites`, write the DB stat first, unconditionally, in a `try/catch` that logs; treat Redis as best-effort per key. Stop awaiting `getClient()` before any DB write. Add `PRAGMA journal_mode=WAL`, `busy_timeout=5000`, `synchronous=NORMAL` after client creation. Add `PRAGMA integrity_check` to backups, fail or alert on off-box copy failure, and add a documented restore drill.
- **Evidence:** `src/services/redis/storeAttOrMidToRedis.ts:36-44` awaits Redis before starting writes and swallows DB errors with `.catch(() => {})`; `src/db/db.ts:15-20` sets no pragmas. Measured on this checkout: `journal_mode=delete`, `busy_timeout=0`, `foreign_keys=1`, `synchronous=2`. `scripts/backup-db.sh:30` runs `VACUUM INTO` without an integrity check, and `:43-52` exits 0 on off-box failure.
- **Why now:** a Redis outage silently freezes every rank while the bot still answers; after cutover, the embedded DB is the only source of truth.
- **Effort:** S/M. **Success:** with Redis stopped, one `/attendance` lookup increments `student_stats`; `PRAGMA journal_mode` returns `wal` and `busy_timeout ≥ 5000`; a failed off-box backup exits non-zero or alerts; a restore drill restores a readable DB.

#### 4. Take identity out of URLs and names out of anonymous responses — **ship blocker**

- **Change:** accept `initData` in `X-Telegram-Init-Data` for GETs; keep the query fallback for one release; scrub/rotate logs. Without verified `initData`, `/api/leaderboard` returns no `name`, disables name search, and stays `Cache-Control: public`; with verified identity it may return names, set `private`, and allow name search. Wire `display_name` as the pseudonym/opt-out in the same change.
- **Evidence:** `src/web/src/api.ts:61-64,102-110,171-179,214-231` put `initData` in query strings; `src/api/resolveUser.ts:22-24` reads query first. `src/api/server.ts:211-239` serves the leaderboard without identity; `src/db/student_stats.model.ts:82-87` searches names and `:113-119` returns `s.name`.
- **Why now:** anyone with nginx log access can replay a 24-hour student credential; anyone with curl can enumerate named marks. The app already has `initData`; this is mechanical.
- **Effort:** M. **Success:** a day of access logs contains zero `initData=`; anonymous `/api/leaderboard?search=<name>` returns no `name` field and no named match; an identified call still returns names.

#### 5. Make the data path trustworthy before the Turso cutover — **ship blocker for cutover**

- **Change:** add `studentsnew` and `student_stats` to the import plan (primary-key `ignore`, then verify). Make `/syncdb` throw before upsert/flush when `failed > 0` or `students.size === 0`. Replace the parser fixture with a real masked portal response and assert every subject's attended/conducted; add a banner-row negative case.
- **Evidence:** `scripts/import-turso-snapshot.mjs:62-70` omits `studentsnew` and `student_stats`; `src/db/student_stats.model.ts:113-119` inner-joins `studentsnew`, so an empty directory means every roll fails. `src/bot/syncdb.ts:261-268` counts transport failures but continues; `:437-440` flushes caches unconditionally. The fixture has two rows; the parser reads rows 1–3 (`src/services/student.utils/parsers.ts:37-40`); the exact fixture yields `subjects: []`. The test asserts only totals (`tests/unit/academic.test.ts:217-228`).
- **Why now:** Turso reads are blocked around November 2026. Cutover without the directory lands on a box where no roll resolves and no student ranks.
- **Effort:** M. **Success:** on a copy, import yields `studentsnew` count equal to source and `student_stats > 0`; 20 random rolls resolve; leaderboard total > 0; the parser test fails if one banner row is added.

#### 6. Remove the daily check-in gate — **ship blocker for bot UX**

- **Change:** delete the `isDailyUnlocked` gate from authorization; remove `/postcheckin` or make it a normal channel post with no gate. If a gate is kept, store the pending roll and answer it on `start=unlocked`, and rewrite the copy honestly. Delete the “attention farm” comment.
- **Evidence:** `src/bot/authorization.ts:103-107` gates every lookup; `src/bot/dailyCheckIn.ts:2` calls itself an “attention farm for channel ad impressions”; `:183-186` returns `start=unlocked`, but `src/bot/commands/start.ts:12-15` handles only `library`. The typed roll is persisted before auth (`src/bot/academics/academicHandler.ts:105`), so the mapping survives; the answer does not.
- **Why now:** when the gate is active, a student's first lookup is replaced by a fake robot check and a channel detour. This is a trust problem, not a growth tactic.
- **Effort:** S. **Success:** a new user sends a roll without checking in and receives attendance; `grep -R "attention farm\|I'm not a robot" src/bot` returns nothing; `/postcheckin` cannot make lookups fail.

#### 7. Revert the bot-side monitor split now; amend and ship it later — **important, not a bot ship blocker**

- **Change:** restore `services/uptime.ts` and `startUptimeMonitor` in `src/bot/index.ts` until the external monitor is live. Then deploy the monitor first, verify fresh heartbeats, and only then remove the old probe. Before that: a deep-health failure must record only `api`/unknown, not database plus Redis down; a fresh state must alert on a down component; `deploy-monitor.sh` must call `/internal/health` with the secret and fail on non-200; add tests for `runCycle`, spool replay and notify transitions; bind `/internal/*` to loopback or refuse a short secret.
- **Evidence:** `git show HEAD:src/bot/index.ts` imports `services/uptime.js` and calls `startUptimeMonitor`; the working tree removes both. `src/monitor/index.ts:614-628` converts any deep-health error or API-down into database plus Redis down; `src/api/internal.ts:122-128` silently disables the routes when the secret is unset; `scripts/deploy-monitor.sh:108` does not match `[probe] deep health failed`; `tests/unit/monitor.test.ts:2-8` imports only pure helpers.
- **Why now:** deploying the current tree stops the old probes before the new monitor exists; after 15 minutes `src/api/server.ts:349-367` marks every component stale/down. That is a self-inflicted false outage.
- **Effort:** M. **Success:** with the secret unset the monitor exits non-zero; a 404 from `/internal/health` records only `api=down`; a replay test preserves the spool tail; `deploy-monitor.sh` fails on deep-health 404.

### Product steering decisions

- **Daily check-in: remove it.** Do not keep a daily CAPTCHA. Keep the channel-join prompt only if the channel is the official notice channel; make it one-time, clearly explained, and never block a private answer on it. Delete the “attention farm” framing from code and docs.
- **Public leaderboard: gate names, keep aggregate scores.** Anonymous web/curl gets `roll_no`, `attendance_percentage`, `mid_marks_avg`, `rank`, `total`, no `name`, and roll-only search. Verified Telegram identity gets names and name search, with `Cache-Control: private`. `display_name` becomes the pseudonym/opt-out, not an inert form field. Remove the Pages leaderboard so there is no second public copy.
- **Library: hide now, freeze development, decide 2026-12-15.** Do not open it to students this month. Open only if four gates pass: (1) one full semester's core subjects ingested and reviewed; (2) unique-roll registration; (3) 16-byte watermark and built-in-secret refusal; (4) reader tested on a low-end Android. If not, kill it and delete the tab, route, code and the 660-line plan. Do not build phases 6–7 or readiness notifications.
- **Two web builds / Pages: cut the legacy Pages mini apps.** Keep one app build at `/library/` and the static `public/site` marketing site. Delete the three Pages inputs, `gh-pages` deploy, Pages URLs in `constants.ts`, and the Pages CORS default. Add a redirect/notice for old bookmarks, then remove the build.
- **Monitor split: revert the bot-side split now; amend and ship in 2–6 weeks.** Do not ship it as-is. If the amendments are not done by 2026-11-30, keep the old in-process uptime probe and defer the split.
- **Turso → embedded SQLite: cut over by 2026-11-22, only when all of these are true.** `studentsnew` and `student_stats` imported (or a successful `/syncdb` with zero failures and > 0 students); WAL/busy timeout and backup/restore verified; a copy-of-production import resolves 20 random rolls and shows a non-empty leaderboard; a written runbook with a maintenance window and local-backup rollback. No dual-write, no lazy cutover, and no cutover on the same day as the monitor or library changes.

---

## 4. Roadmap, metrics and anti-recommendations

### 0–2 weeks (by 2026-11-18) — must

- Items 1–6 above, in order.
- Restore the old uptime probe or deploy the monitor first; do not deploy the dirty tree.
- Turso import, `/syncdb` integrity and cutover by 2026-11-22.
- **Should:** call `void prune()` at startup in `src/services/maintenance.ts`; Node 24 in CI and `.nvmrc`; parser fixture if not already in item 5.

### 2–6 weeks (to 2026-12-31) — should

- Monitor amendments, tests, deploy verification; then ship.
- `/syncdb` fail-closed integration test; test typecheck config; `build:library` in CI; coverage floor near baseline (not 25%).
- Draft persistence; one `request()` with `AbortSignal.timeout(15000)`; reader scroll reset; remove `user-scalable=no`.
- Unique roll index; watermark 16 bytes; admin CSP/`frame-ancestors`; library decision prep.
- Node 22/24 runtime; remove dead `recordHeartbeat`.

### 6–12 weeks (to 2027-02) — could

- Library decision: open with a pilot or kill and remove.
- `display_name` opt-out end to end; admin health `current`/`stale`; status page ARIA and tap tooltips.
- Schema `PRAGMA user_version` migrations; `last_seen_sync` for departed students; config consolidation only where it removes a real footgun.
- Do not start a new surface in this window.

### Metrics and guardrails

**North Star: Weekly Answered Students (WAS)** — distinct Telegram users who receive a **non-fallback** attendance or mid-marks answer in a week. Instrument one boolean (`fresh|fallback`) in the existing activity log; target at least 40% of weekly active registered students and a rising four-week trend. This measures the core value, not messages sent.

| Guardrail | Threshold | Source |
|---|---|---|
| Freshness honesty | 0 unlabeled fallback cards; at least 98% of answers < 24h old | daily synthetic lookup + card marker |
| Leaderboard durability | Redis-down lookup writes `student_stats`; rank total within 1% of `studentsnew` | weekly synthetic check |
| Deploy safety | 100% of deploys pass four smoke URLs; rollback < 5 min; 0 dirty-tree deploys | deploy log |
| Uptime truth | heartbeat age < 15 min; 0 fabricated database/Redis down rows; “not checked” when stale | `/api/status` + monitor log |
| Privacy | 0 `initData=` in access logs; 0 anonymous `name`; 0 duplicate rolls | weekly log grep + API test |
| Cutover | complete by 2026-11-30; row counts match; restore drill passes | import report |

No total-users, messages-sent, coverage-percentage or “tests passing” as success metrics.

### What not to do

1. **No microservices, queue, Kubernetes, Redis HA, ORM migration, React rewrite or design-system rewrite.** One event loop and one SQLite file are correct here.
2. **No new surfaces** — admin views, library phases 6–7, readiness notifications, another mini app — until items 1–6 ship.
3. **No public launch of named marks as-is.** Do not ship an opt-out that no query reads.
4. **No dual-write Turso + SQLite and no “lazy” cutover.** One cutover, one backup, one runbook.
5. **No deploy of the dirty tree or the monitor split as-is.** The old uptime probe must not be removed before the new one is verified.
6. **No coverage-percentage chasing or snapshot tests.** Fix the parser fixture and the failure paths instead.
7. **No Pages resurrection or second web build.** One app, one static site.
8. **No “finish the library” before content, entitlement and watermark gates.** Hiding it is a valid outcome; killing it is also valid.

### Critic verdicts and corrections

| Critic | Strongest finding | Main overreach | Verdict |
|---|---|---|---|
| **Architecture** | Private monitor routes on the public listener; API imports the bot singleton; status not shipped | “K students = K fetches”; P1 treatment of the command registry | **Accept, corrected** |
| **Security/privacy** | `initData` in URLs; public named marks | `ENV` bypass severity; “anonymous gets names” | **Accept, corrected** |
| **Data/reliability** | Redis-gated stats; import omits student directory; no pragmas | P0 labels; backup-lock reproduction | **Accept, corrected** |
| **Product/UX** | Closed-library menu; inert `display_name`; stale cache unlabeled | Daily-gate P0; “deletes the request” | **Accept, corrected** |
| **Frontend** | One-hour shell cache plus deleted hashed assets; draft loss | P0 severity; some CSS-only inference | **Accept, corrected** |
| **Testing/ops** | Vacuous parser fixture; no rollback; monitor false-down | “Irreversible migrations”; “untested monitor split” | **Accept, corrected** |
| **Maintainability** | Retention reset; 39.6 KB untested panel; tests not typechecked | “No tool parses”; config-consolidation priority | **Accept, corrected** |

Key corrections the judge verified:

- **Redis-gated stats is P1, not P0:** it freezes ranks and `/api/me` but does not corrupt data; a later lookup rewrites the stat.
- **The daily gate is conditional:** it is dormant until `/postcheckin` sets `MSG_ID_KEY`; the typed roll mapping survives, but the answer is lost.
- **`ENV` is a footgun, not a normal-production bypass:** `ENV` also selects the bot token; a running production bot normally has `ENV=production`. Fix it with an explicit `ALLOW_DEV_IDENTITY`, but do not claim a silent production bypass.
- **“K students = K portal fetches” is wrong:** per-student Redis keys mean sequential lookups within the TTL hit cache; stampede is concurrent cold starts or a Redis outage.
- **“Irreversible migrations” is wrong:** `src/db/init.ts` is `CREATE TABLE IF NOT EXISTS` only. The real risk is the dirty tree, `rsync --delete`, no rollback and the uptime-probe removal. Deploy does run tests, lint and typecheck.
- **The backup lock reproduction is unverified:** the pragmas are measured, but the judge did not reproduce `SQLITE_BUSY`; fix WAL/busy timeout as a precaution, not as a proven outage.
- **The security fix must be consistent:** “anonymous gets roll+name+rank” still publishes names. Anonymous gets no names.

The judge's significant miss: deploying the current working tree **removes the old in-process uptime probe before the external monitor is deployed**. `HEAD` starts `startUptimeMonitor`; the working tree starts only maintenance. A normal deploy would freeze heartbeats and, after 15 minutes, `src/api/server.ts:349-367` marks every component down. That is the strongest argument against deploying the dirty tree and it fixes the deployment order: monitor first, verify, then remove the old probe.

### Open decisions for the owner

1. **Names policy:** is a named public leaderboard acceptable at all, or must the public web be pseudonymous? **Recommended default:** anonymous public leaderboard (roll + rank + score), names only inside verified Telegram, `display_name` as opt-out. If names must be public, get explicit consent and say so in `PRODUCT.md`; do not leave the current contradiction.
2. **Library bet:** is the library a real product bet for this semester, or a side project? **Recommended default:** hide and freeze now; decide on **2026-12-15** with the four gates above. If the content cannot be loaded by then, kill it and reclaim the scope.
3. **Turso deadline/window:** what is the exact date Turso reads stop, and what downtime/rollback window is acceptable? **Recommended default:** cut over by **2026-11-22**, 30-minute window, local `VACUUM INTO` backup plus verified restore, no dual-write. Confirm whether Turso remains readable long enough for a rollback; if not, the local backup is the only rollback.

---

## 5. Reviewer additions (not owned by any single critic)

These are real but lower-severity items that fell between the seven lenses:

- **The merge tool also omits the library registry.** `scripts/import-turso-snapshot.mjs` copies reports, registrations, `tgusers`, `botusers` and `uptime_log`, but not `studentsnew`, `student_stats`, `library_documents` or `library_reads`. If the library registry lives only in Turso at cutover, the shelf disappears; if `library_reads` is not merged, the watermark/takedown trail is lost. Add the registry to the cutover checklist even if the pages themselves live on disk.
- **`library_reads` has no retention.** `prune()` covers `uptime_log`, `activity_log` and expired `admin_sessions` only. A page is one row; if the library opens, the audit table grows without bound. Add a retention window (or roll reads into a per-user/page counter) before opening.
- **`display_name` is an inert control.** The profile form stores it (`src/api/profile.ts:84`), and nothing reads it outside the form. Either print it on the leaderboard or remove the field; a privacy control that does nothing is worse than none.
- **`broadcastUsers` is written but never read.** The set is populated on check-in and roll lookups, and there is no broadcast path. This is the missing half of the "I'll tell you when the library opens" promise; remove the promise or implement one message.
- **The status page pulls Google Fonts** (`src/status/index.html:8-10`) although the redesign commit says fonts are self-hosted to avoid external dependencies. The page meant to work when things are slow is the one that blocks on fonts.
- **The README/PRODUCT deployment sentences are stale** (GitHub Pages vs Express-served `/library/`), and `openwiki/architecture.md` still documents the deleted `src/services/uptime.ts`. The code has moved; the docs have not.
- **`initData` comparison is not constant-time** (`src/services/telegramAuth.ts:38`), and the dev shortcut only checks `ENV !== "production"`. The second is the meaningful one; the first is a minor hardening item.
- **`MONITOR_SPOOL_LIMIT` is undocumented** in `.env.example` and `docs/DEPLOYMENT.md`; the monitor reads it.
- **`/register`, `/help`, `/leaderboard` regexes are unanchored**; `/registerfoo` matches. Low impact, easy to anchor.

## 6. What this review did not verify

- Whether oracle3's nginx serves `src/status/index.html` through an out-of-repo alias, and whether the `/internal/` `allow` rule is deployed. The repo has no nginx config; both are "verify on the host" items.
- The production `ENV`, `LIBRARY_ACCESS`, `UPTIME_INGEST_SECRET` values, and whether the pinned check-in post currently exists. Several P0/P1 findings are latent until those are enabled.
- Real portal HTML. The parser fixture is synthetic and does not exercise the subject-row layout; the review can prove the test is vacuous, not what the production page contains.
- Visual/touch behavior on a real phone. The accessibility findings come from CSS and flow, not a device run.
- Actual traffic. The rate-limit/NAT and cold-cache stampede findings are mechanism-level; the frequency is inferred.

## 7. Appendix: evidence index

Key files for each recurring finding:

- Deploy: `scripts/deploy.sh`, `scripts/backup-db.sh`, `src/bot/index.ts`, `src/db/init.ts`
- Static shell: `src/api/server.ts`, `src/web/vite.library.config.ts`
- Identity: `src/web/src/api.ts`, `src/api/resolveUser.ts`, `src/config/environmentals.ts`, `src/api/server.ts`
- Leaderboard data: `src/services/redis/storeAttOrMidToRedis.ts`, `src/db/student_stats.model.ts`
- Migration: `scripts/import-turso-snapshot.mjs`, `src/db/db.ts`
- Product front door: `src/bot/setup.ts`, `src/bot/authorization.ts`, `src/bot/dailyCheckIn.ts`, `src/bot/commands/start.ts`
- Library: `src/services/library/*`, `src/api/library.ts`, `src/web/src/views/LibraryView.tsx`, `docs/LIBRARY.md`
- Ops truth: `src/services/maintenance.ts`, `src/monitor/index.ts`, `src/api/internal.ts`, `src/api/admin/feed.ts`, `src/status/index.html`
