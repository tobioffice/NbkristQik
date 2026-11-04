# NbkristQik remediation — 4 November 2026

This is the implementation record for the whole-codebase review in
[`CODEBASE-REVIEW.md`](CODEBASE-REVIEW.md). The work was split across parallel
workstreams and then independently verified. **Nothing was committed, pushed
or deployed.**

## What changed

### Release and status

- `scripts/deploy.sh` now refuses a dirty tree by default (`ALLOW_DIRTY_DEPLOY=1`
  for a documented hotfix), stages `dist/` as `dist.new` and keeps the live
  build as `dist.old` until every smoke check passes, then promotes it to
  `dist.prev`; takes a `VACUUM INTO` backup before restart when `DEPLOY_DB_URL`
  is set; ships `src/status/` and the backup/restore/import scripts; and
  smoke-checks `/health`, `/status` and `/library/` with rollback on failure.
- `scripts/deploy-monitor.sh` preflights `/internal/health` with the secret,
  greps deep-health failures, and restores the previous monitor binary/unit if
  the new one fails to start or complete a cycle.
- Express serves `/status` from `public/status/index.html`; `/library` HTML is
  `no-cache` and hashed `/assets/*` are immutable.
- `src/status/index.html` no longer loads Google Fonts, has labelled bars and
  keyboard/tap detail, and does not call a stale component "down".
- CI runs Node 22/24, typechecks tests, and builds the `/library/` app. The
  legacy GitHub Pages mini-app build is removed; only the static marketing
  site remains (`pnpm deploy:site`).

### Identity and privacy

- `X-Telegram-Init-Data` is the preferred identity header; query/body
  `initData` remain as one-release compatibility. Invalid presented identity
  is a 401, never downgraded to anonymous.
- The unsigned `userId` dev shortcut requires `ALLOW_DEV_IDENTITY=1` or
  `ENV=test`; `ENV` defaults to `production`.
- `/api/leaderboard` is public but anonymous rows have `name: null` and
  name search is roll-only. Verified Telegram users get names and name search,
  with `private` caching and identity-segregated Redis keys. `display_name`
  now really overrides the college name.
- `/api/config` exposes `{ libraryOpen, admin }` so a closed shelf is not
  offered.
- `/api/me` prefers the explicit registration over the last-lookup `tgusers`
  mapping and reports `source`.
- A roll can belong to one account: app-level guard + dedupe + unique index;
  duplicate claims return 409.
- Admin panel gets a per-request nonce CSP, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `nosniff`, a production 16-character password gate, and a
  lockout counter that increments only on failed passwords.
- Watermark tokens are 16 hex chars (64 bits, `NBK-XXXX-XXXX-XXXX-XXXX`) and
  the repo-literal fallback is gone; a missing secret yields 503 rather than a
  forgeable mark.
- The server binds `127.0.0.1` by default; CORS defaults to the same-origin app;
  `/internal` refuses a set-but-short secret.

### Data and cutover

- Embedded SQLite configures `journal_mode=WAL`, `busy_timeout=5000`,
  `synchronous=NORMAL`, `foreign_keys=ON`; `PRAGMA user_version=1` guards future
  schema changes.
- Leaderboard stats are written to the DB independently of Redis; cache writes
  are best-effort and logged.
- `/syncdb` aborts before upsert/cache flush on any failed section or zero
  students, and writes the directory in atomic batches.
- Retention runs at startup and covers `uptime_log`, `activity_log`, expired
  `admin_sessions` and `library_reads`.
- Backups run `PRAGMA integrity_check` and exit non-zero on an off-box failure;
  `scripts/restore-db.sh` is a manual, verified restore.
- The Turso import now includes `studentsnew`, `student_stats`,
  `library_documents` and `library_reads`, skips missing source tables, and
  keeps local rows.
- Report creation is one transaction (report + opening thread entry + read
  marker); uptime heartbeats have a unique `(component, created_at)` key and
  spool replays write in one batch, so a retry is idempotent by construction.

### Monitor

- The old in-process probe is restored and starts in `src/bot/index.ts` until
  the external monitor is verified; the new monitor remains staged.
- The external monitor records only `api`/`portal` when the API or deep-health
  check is unavailable; it no longer fabricates database/Redis outages. A
  fresh state alerts once on a down component.
- Admin Health shows Operational / Down / No data and the last probe age.

### Bot and product

- The persistent menu button always opens the app index.
- The daily check-in gate is removed; channel membership remains. Check-in
  copy is no longer a "robot" gate, and the callback no longer sends an
  `unlocked` URL.
- `/register` and its prompting are group-safe (`url` button in groups,
  `web_app` in private) and no longer fail silently.
- The library tab/index row is hidden until the server says it is open; the
  false "I'll tell you when it opens" promise is gone.
- Roll mapping is written after authorization, so blocked/invalid lookups do
  not change "you".
- Cached portal data is explicitly labelled as a saved/fallback copy, with the
  year in the last-updated column.

### Web

- All API calls use a 15s timeout wrapper; no `initData` appears in URLs.
- Report and thread drafts persist in `sessionStorage`; failed thread messages
  no longer remain as if delivered; New report clears the old receipt.
- The reader resets scroll on open and restores the shelf position on close;
  failed pages are real buttons; controls are 44px; labels are at least 11px;
  pinch zoom is allowed again.
- The cover labels a mid-marks rank as mid-marks.
- One app is built (`app.html` → `AppShell` → `/library/`), and the legacy
  `index.html`/`register.html`/`report.html` roots are gone.

### Tests and docs

- The portal parser fixture now contains the full row shape and asserts each
  subject; both attendance and mid-marks parsing are covered.
- Tests are typechecked (`tsconfig.test.json`, `pnpm run typecheck:tests`), the
  embedded admin-panel JS is syntax-checked, and the coverage floor is
  70/75/82/70 (measured 72.28/76.79/83.84/72.28).
- Hand-written docs were synchronised with the code; `openwiki/` is generated
  and was deliberately not hand-edited.

## Verification

| Check | Result |
|---|---|
| Root `tsc --noEmit` | clean |
| Root `tsc -p tsconfig.test.json` | clean |
| Root ESLint (`src`, `tests`) | clean |
| Root Vitest | 55 files, 386 tests pass |
| Root coverage | 72.28 / 76.79 / 83.84 / 72.28; floor 70/75/82/70 |
| Web Vitest | 5 files, 38 tests pass |
| Web Vitest | 4 files, 36 tests pass |
| Web `npm run build` | pass, `dist-library/index.html` + hashed assets |
| Web lint | 0 errors, 8 pre-existing warnings |
| Shell scripts | `bash -n` clean |
| Workflow YAML | parses |
| Panel JS | parses via `new Function(panelJs)` |

## Operator steps before the next deploy

1. Commit this tree (the deploy guard refuses untracked/modified files by
   design) or intentionally use `ALLOW_DIRTY_DEPLOY=1` for a hotfix.
2. Run `scripts/backup-db.sh`; confirm the local copy and off-box copy both
   succeed. The off-box failure now exits non-zero on purpose.
3. Boot once against the embedded DB to apply WAL/pragmas, registration
   dedupe, the unique roll index and `user_version=1`.
4. Turso cutover: boot against the embedded DB, then run
   `node scripts/import-turso-snapshot.mjs <turso-export.db>`; verify
   `studentsnew`, `student_stats`, the library registry and a non-empty
   leaderboard.
5. Deploy the external monitor only after the old in-process probe is still
   running; verify fresh external heartbeats and a 200 `/internal/health`;
   only then remove the old probe.
6. Marketing site: `cd src/web && pnpm deploy:site` publishes `public/site/`.

## Deliberately not changed

These are strategic or product decisions, not defects that can be fixed
blindly:

- The library is still frozen for students: phases 6–7, the corpus and the
  open-to-all decision remain a product call. The tab is hidden until open.
- The college portal is still plain HTTP by default; credentials are now
  form-encoded, and the residual network risk is documented.
- Per-IP rate limits remain IP-keyed behind nginx (the server is loopback-only
  now). Reports use a per-user gate; the library has a per-reader burst
  warning, while its request limit is still the shared IP bucket.
- The command registration import list and the single-process bot/API coupling
  remain; they are maintainability refactors, not user-visible defects.
- The web package has 38 tests, including a server-render smoke test for the
  register row, but no web coverage run; the build typecheck plus that render
  smoke are the current React guards.
- The student directory is still append-only: `/syncdb` upserts but does not
  remove rows for students who left. A `last_seen_sync` column/filter is a
  schema change for the next sync pass, not something to infer from a partial
  scrape.
- There is no single-flight lock around a cold section scrape; concurrent
  first lookups for the same section can still make more than one portal
  request. Reports and stats are durable, so this is a portal-load issue, not
  a data-loss one.
- `openwiki/` is generated daily and was not hand-edited.
- The legacy `gh-pages` dependency remains in `src/web/package.json` for the
  marketing-site deploy; it is not used by the app build.
