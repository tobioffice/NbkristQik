# NbkristQik Deployment

## Environment variables

| Variable                                        | Consumer                           | Notes                                                                                                                                  |
| ----------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ENV`                                           | `src/config/environmentals.ts`     | `production` (default) or `development`; switches token/channel selection. The dev `userId` shortcut also needs `ALLOW_DEV_IDENTITY=1` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_TOKEN_DEV` | bot, initData HMAC                 | Production vs dev token                                                                                                                |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`       | `src/db/db.ts`                     | Turso connection                                                                                                                       |
| `REDIS_URL`                                     | Redis client                       | Cache                                                                                                                                  |
| `N_USERNAME` / `N_PASSWORD`                     | portal session + `/syncdb`         | College portal credentials                                                                                                             |
| `ADMIN_ID`                                      | command handlers                   | Telegram id for admin commands and report forwarding                                                                                   |
| `PROD_CHANNEL` / `TEST_CHANNEL`                 | config                             | Channel selected by `ENV`                                                                                                              |
| `ADMIN_PANEL_PATH` / `ADMIN_PANEL_PASSWORD`     | admin panel                        | Panel disabled unless both are set; production also refuses a password shorter than 16 characters                                      |
| `CORS_ORIGINS`                                  | API                                | Comma-separated allowlist; default `https://checker.tobioffice.online`                                                                 |
| `PORTAL_BASE_URL`                               | constants                          | Optional; default `http://103.203.175.91`                                                                                              |
| `HOST` / `PORT`                                 | API                                | Bind address and port; defaults `127.0.0.1:3000`                                                                                       |
| `STATUS_PAGE_PATH`                              | `src/api/server.ts`                | Optional override for the `/status` file; defaults to `public/status/index.html`                                                       |
| `UPTIME_INGEST_SECRET`                          | `src/api/internal.ts`              | Shared secret for `/internal/*`; unset disables both routes                                                                            |
| `MONITOR_*`                                     | `src/monitor/index.ts`             | Only read by the monitor-host monitor, not the bot                                                                                     |
| `ATTENDANCE_WIDGET`                             | `src/bot/academics/widgetCard.ts`  | `off` (default) while Telegram rejects widgets; `admin` tests it on `ADMIN_ID`; `all` opens it to every private chat                   |
| `GAME_CHANNEL_POSTS`                            | `src/games/channel.ts`             | `on` keeps the channel's live weekly board (students and sections) in sync; default off                                                |
| `GAME_SEASON`                                   | `src/games/config.ts`              | Season key for the weekly boards; default `S1`                                                                                         |
| `PDFSTAMP_BIN`                                  | `src/services/library/pdfstamp.ts` | Optional override for the native PDF stamp; default `bin/pdfstamp` at the repository root                                              |

Start from [`.env.example`](../.env.example).

## Build and run

Node 22 or 24 is required (`.nvmrc` pins 24; Node 20 is EOL). Rust 1.88 or
newer is required to build the library's PDF stamp; the production host does
not need it, because the deploy ships the built binary. The web app is a
separate package with its own lockfile.

```bash
pnpm install
pnpm dev        # TypeScript, bot + API
pnpm build      # tsc -> dist/
pnpm run build:pdfstamp   # native/pdfstamp -> bin/pdfstamp
pnpm start      # node dist/bot/index.js
(cd src/web && pnpm install && pnpm build:library)  # /library/ bundle
```

The PDF download path runs `bin/pdfstamp`. `scripts/build-pdfstamp.sh` builds
it, and the Vitest suite builds it on first use when `bin/pdfstamp` is
missing. Without the binary, library downloads answer 500 and the log names
the script; every other surface keeps working.

Anything imported by `src/` at runtime belongs in `dependencies`, not
`devDependencies`: the server installs with `pnpm install --prod`.
`tests/unit/runtimeDependencies.test.ts` fails the suite when a runtime import
is only a dev dependency. The deploy's rollback reinstalls the full tree
before restarting the old build for the same reason.

`pnpm run check:prod` is the stronger gate. It copies the manifest, lockfile,
`dist/` and `bin/pdfstamp` to a temporary directory, runs
`pnpm install --prod --frozen-lockfile`, resolves every bare import in the
compiled output, and runs the stamp. CI runs it on every push; the deploy runs
it before the first SSH command, so a missing production package stops the
release with the server untouched. It needs `pnpm build` and
`scripts/build-pdfstamp.sh` first.

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm exec vitest run` (or
`test:coverage`). `build`/`build:library` build only the `/library/` app; the
static marketing site publishes separately with `cd src/web && pnpm deploy:site`
(it stages `public/site/` and runs `gh-pages -d dist-site --nojekyll`).

## Telegram setup

The bot sets its command lists and menu button at startup (`setupBot`), so
there is nothing to paste into @BotFather for commands. The Main Mini App is
the one thing that needs a one-time BotFather step; the group privacy commands
are set by the bot itself.

### Main Mini App

The group buttons use direct links such as
`https://t.me/NbkristQik_bot?startapp=rank`. Telegram only opens those inside
the app when the bot has a **Main Mini App**. Without it, the link opens the
bot chat and the student has to tap the menu button.

1. Open [@BotFather](https://t.me/BotFather) → `/mybots` → the bot →
   **Bot Settings** → **Configure Mini App** → **Enable Mini App**.
2. Set the URL to `https://checker.tobioffice.online/library/`.
3. Optionally set a short name (`app`), which makes
   `https://t.me/NbkristQik_bot/app?startapp=rank` the explicit form.
4. Upload screenshots and a short demo video from the bot's profile page.
   These are what search and the Apps tab show.
5. Configure the splash screen with the app's dark ground (`#1a2026`) and
   surface (`#212a33`), and the app icon.

The Mini App reads `start_param` at startup (`takeStartParam` in
`src/web/src/route.ts`) and folds it into the hash route, so `rank`, `profile`,
`issues`, `issues_new` and `library` all land on the right screen. `?page=`
still works for every button already sent, so enabling the Main Mini App does
not break old links.

### Group privacy

`/attendance`, `/midmarks` and `/bunk` are registered as **ephemeral** commands
for groups. The command and the "open in the bot" link are visible only to the
student who sent it, and the card itself is rendered in the DM. If the client
cannot do ephemeral commands, the same link is posted publicly; either way the
bot never puts the card in the room. No BotFather setting is required.

### Attendance widget

`ATTENDANCE_WIDGET` controls the HTML widget card. The default is `off`
because Telegram currently rejects `sendWidget` in production with
`INPUT_MEDIA_WIDGET_NOT_ALLOWED`; widgets were disabled on 13 Nov 2026, two
days after Bot API 10.4. When the API returns, `admin` tests the card on
`ADMIN_ID` and `all` opens it to every private chat.

The widget is one fixed HTML/CSS/JS document; the bot changes its `chat_data`
on Attendance, Mid marks and Bunk taps, and the card redraws in place. It fits
under Telegram's 600px cap for a normal semester; a card whose state exceeds
the 1024-byte chat-state limit points at the Text card button instead. The
message caption is the fallback for clients without widget support.

### League

The league adds three private commands: `/quiz` (today's 10 questions),
`/duel` (the duel record and today's challenge) and `/league` (the weekly
board). A group gets a private deep link instead of a card.

The channel posts are opt-in:

```bash
# .env on the bot host
GAME_CHANNEL_POSTS=on
# GAME_SEASON=S1
```

With `GAME_CHANNEL_POSTS=on` and the bot an admin in `PROD_CHANNEL`, the bot
keeps exactly one message in the channel: the live board. It holds the
week's top three students and top three sections; the minute tick edits it in
place only when a number or a name actually changed, and an unchanged board
is never touched. The message id and the last data fingerprint are stored in
`game_channel_board`, so a restart edits the same message instead of posting
a second one. If the stored message was deleted by hand, the next change
posts a fresh one. The board's two buttons open today's run and the full league
board page (`#/games`, a hidden Mini App route).

`/gamepost` sends the current board to the admin DM as a preview, and
`/gamepost channel` creates or refreshes the live message immediately, which
is the launch path after a deploy or a channel clean-up. `/gamepost repost`
deletes the stored board message and posts a fresh one, so it becomes the
newest message in the channel (the bot needs delete permission there).

`GAME_SEASON` groups the weekly boards; change it when a new season starts.
The question bank is seeded from `src/games/questions.ts` once, keyed by slug.
Add questions by appending new slugs (a restart seeds them) or by inserting
rows directly; `active = 0` retires a question without deleting history.

League rules: one run attempt per account per IST day; each question closes
after 10 seconds and a late tap scores nothing; duels last 48 hours; only the
best ten verified players per section count on the weekly board; channel names are a
verified student's roll (masked when the owner hid the leaderboard) or an
unverified player's chosen display name, Telegram name or @username, never the
portal name.

## Production deployment

The bot runs as the `nbkristqik` **systemd** service on the production server.
The server has very little RAM, so the TypeScript build runs on the deploy
machine and only `dist/` and the built static surfaces are shipped:

```bash
DEPLOY_DB_URL=file:/home/ubuntu/nbkristqik/data/qik.db scripts/deploy.sh
```

### Deploy from GitHub Actions

`.github/workflows/deploy.yml` deploys on every push to `main` and on manual
dispatch. It runs the same `scripts/deploy.sh` on an ephemeral GitHub-hosted
runner, so the checks, staging, pre-restart backup, restart, smoke checks and
rollback path are unchanged. The job is limited to `main`, runs one release at
a time, and reads no ops file: it refuses a checkout that contains
`.env.deploy`.

Every deployment value comes from GitHub secrets, preferably on a `production`
environment (repository secrets with the same names also work). The three SSH
values fall back to the existing `SERVER_SSH_KEY`, `SERVER_HOST` and
`SERVER_USER` repository secrets; the `DEPLOY_*` names take precedence when
both exist. Check that the older values still point at the current production
host before relying on them.

| Secret                   | Required    | Purpose                                                                                                |
| ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------ |
| `DEPLOY_SSH_KEY`         | yes         | Private OpenSSH key for the deploy user, without a passphrase (`SERVER_SSH_KEY` fallback)              |
| `DEPLOY_SSH_HOST`        | yes         | Hostname or IP of the production host, not an ssh alias (`SERVER_HOST` fallback)                       |
| `DEPLOY_SSH_USER`        | yes         | Unix user that owns the checkout and may restart the unit (`SERVER_USER` fallback)                     |
| `DEPLOY_SSH_PORT`        | no          | SSH port, default `22`                                                                                 |
| `DEPLOY_KNOWN_HOSTS`     | no          | Pinned `known_hosts` line(s); when unset the job does `ssh-keyscan` for that run                       |
| `DEPLOY_DIR`             | no          | Defaults to `/home/ubuntu/nbkristqik`; do not reuse the old `SERVER_PATH`, which pointed at its parent |
| `DEPLOY_SERVICE`         | no          | Defaults to `nbkristqik`                                                                               |
| `DEPLOY_BASE_URL`        | no          | Defaults to `http://127.0.0.1:3000`                                                                    |
| `DEPLOY_DB_URL`          | recommended | Server-side `file:` URL for the pre-restart `VACUUM INTO` backup                                       |
| `DEPLOY_DB_BACKUP_DIR`   | no          | Defaults to `$DEPLOY_DIR/backups`                                                                      |
| `DEPLOY_INTERNAL_SECRET` | no          | Same value as the server's `UPTIME_INGEST_SECRET`; enables the authenticated smoke check               |

One-time setup:

1. Generate a dedicated key and install its public half for the deploy user:

   ```bash
   ssh-keygen -t ed25519 -C github-actions-deploy -f ~/.ssh/nbkristqik-gha -N ""
   ssh-copy-id -i ~/.ssh/nbkristqik-gha.pub deploy-user@deploy-host
   ```

2. Create the `production` environment under **Settings → Environments** and
   store the private key as `DEPLOY_SSH_KEY`, the hostname or IP as
   `DEPLOY_SSH_HOST`, and the Unix user as `DEPLOY_SSH_USER`. Use the
   `production` environment secrets so the values can be rotated in one place
   (repository secrets with the same names also work). If the repository still
   has `SERVER_SSH_KEY`, `SERVER_HOST` and `SERVER_USER` from the retired
   workflow, the job falls back to them; set the `DEPLOY_*` names when rotating
   or when the older values are stale.
3. Allow that user to restart only this unit without a password:

   ```sudoers
   deploy-user ALL=(root) NOPASSWD: /usr/bin/systemctl restart nbkristqik
   ```

   Put the line in `/etc/sudoers.d/nbkristqik-deploy` with mode `0440`. The
   script runs `systemctl is-active` without sudo.

4. Optionally pin the host key. For a non-default port the entry must include
   `[host]:port`:

   ```bash
   ssh-keyscan -p 22 -H deploy-host
   ```

   Store the output as `DEPLOY_KNOWN_HOSTS`.

The host must accept SSH from GitHub-hosted runner addresses. If its firewall
or nginx-equivalent allowlist only admits the operator's IP, allow GitHub's
runner ranges or run the workflow on a self-hosted runner on a trusted network.
The job is otherwise unattended: there is no TTY, so the deploy user needs the
passwordless sudo rule above.

Add required reviewers to the `production` environment if a push to `main`
should not deploy unattended. The private key exists on the runner only for the
life of the job and disappears with it.

### Logs and privacy

The repository is public, so the GitHub Actions logs are public. Debug logging
is disabled whenever `CI` or Vitest is set, and the test fixtures use synthetic
roll numbers; never put a real student identifier, portal response body, token
or secret in a test, a log line or a command line. `logger.info`, `warn` and
`error` remain available for debugging, but keep their messages free of student
data. GitHub masks repository secrets, and `deploy.sh` pipes the database URL
and internal secret over stdin so they do not appear in the remote process list
or the log.

Production application logs stay on the server in systemd-journald, which
rotates by size and age. Read them with `journalctl -u nbkristqik` and keep
queries keyword- or count-based; do not dump URLs because portal sessions carry
tokens. If the host's journal is not already capped, set `SystemMaxUse=500M`
and `MaxRetentionSec=30day` in `/etc/systemd/journald.conf` and restart
`systemd-journald`; that bounds the server log without a second application log
file. The Actions log is a few hundred KB per run and GitHub retains it for
90 days, so it does not need a separate file.

### Usage stats and history

`GET /stats` is the public usage page; `GET /api/stats` is the aggregate-only
JSON it reads. Both are public and read-only. The numbers come from the same
`getOverviewTotals()` queries as the admin Overview, so the two surfaces cannot
drift. The JSON is cached in Redis for five minutes, with a five-minute
in-process fallback, so the page cannot be used to load-test the database.
`uptime_90d` pools the same `uptime_log` probes that `/api/status` shows. The
response's `method` field restates the definitions, and the page links to
`src/api/publicStats.ts`.

The daily history lives in the repository, not only in the database.
`.github/workflows/stats-history.yml` runs at 23:30 IST, fetches `/api/stats`,
appends or replaces that IST date in `stats/history.csv`, regenerates
`stats/history.svg`, and commits both. The chart is embedded in the README.
The workflow pushes with the repository `GITHUB_TOKEN`, so that commit does not
trigger the test or deploy workflows. The CSV records
`date,registered_users,dau,wau,mau,commands_7d`; snapshots are taken near the
end of the IST day, so each daily figure is within a few minutes of the full
day. Only aggregates are stored; no usernames, user ids or per-student rows
leave the database.

### Clean tree

The deploy ships a commit, not the working tree. It stops before the checks or
the build when `git diff`, `git diff --cached` or
`git ls-files --others --exclude-standard` report anything. Commit or stash
first. The only escape is `ALLOW_DIRTY_DEPLOY=1`, reserved for an emergency
hotfix; it prints a warning and continues.

### What the script does

1. Preflight: `pnpm run typecheck`, `pnpm run typecheck:tests`, `pnpm run lint`,
   `scripts/build-pdfstamp.sh`, the root Vitest suite and the `src/web` Vitest
   suite, then `pnpm build`, `pnpm run check:prod` and
   `pnpm run build:library`.
2. On `$HOST`: `mkdir -p $DIR`; refuse to start if an unfinished previous
   release left `$DIR/dist.old` in place.
3. Sync the compiled `dist/` into `$DIR/dist.new/`, then swap it into `$DIR/dist`
   while moving the live build to `$DIR/dist.old`. A failed rsync never touches
   the live `dist/`.
4. Sync the manifests, the ops scripts (`backup-db.sh`, `restore-db.sh`,
   `import-turso-snapshot.mjs`), the native stamp to `$DIR/bin/pdfstamp`, then
   `src/status/` → `$DIR/public/status/`, `src/web/dist-library/` →
   `$DIR/public/library/` and `data/syllabus-catalog.json` → `$DIR/data/`.
5. `pnpm install --prod --frozen-lockfile` (pnpm is installed into `~/.local`
   if the server does not have it).
6. The optional `VACUUM INTO` backup described below.
7. `sudo systemctl restart $SERVICE`.
8. Smoke checks with `curl` from the server itself: retry `/health` for about
   30 s, then require `/status`, `/stats`, `/api/stats`, `/library/` and the
   hashed JS asset referenced by the freshly built HTML to return 200 (`-L`
   follows the `/status` → `/status/` redirect if the route is mounted as a
   static directory). With `DEPLOY_INTERNAL_SECRET` set, the authenticated
   `/internal/health` must also return 200; otherwise that check is skipped with
   a note.
9. Only after all checks pass, promote `dist.old` to `dist.prev`.

### Rollback

`dist.old` is the live build that was replaced by this release; it is kept until
every smoke check passes, then promoted to `dist.prev` as the manual snapshot
for the next release. If the restart fails or any smoke check is not 200, the
script restores `dist.old` (or `dist.prev` on an older layout), restarts the
service and exits non-zero with a rollback message. A failure before the restart
leaves `dist.old` in place; the next deploy refuses to start until the operator
restores it or clears it, so the known-good copy is never silently overwritten.
A first deploy has no `dist.old`; there is nothing to promote.

The static assets (`public/library`, `public/status`) are not rolled back; the
previous server build ignores the new files. No database restore is attempted
automatically — the pre-restart backup is for a deliberate manual restore.

Before restarting the old build, the rollback reinstalls the full dependency
tree from the manifest on the host (`pnpm install --prod=false`). A failed
release may have changed `package.json` and pruned a package the old build
needs; the 20 November outage was exactly that. The next successful release
prunes the dev dependencies again.

### Deploy overrides

| Variable                 | Default                   | Purpose                                               |
| ------------------------ | ------------------------- | ----------------------------------------------------- |
| `DEPLOY_HOST`            | required                  | SSH alias of the production host                      |
| `DEPLOY_DIR`             | `/home/ubuntu/nbkristqik` | Application directory on the server                   |
| `DEPLOY_SERVICE`         | `nbkristqik`              | systemd unit to restart                               |
| `DEPLOY_BASE_URL`        | `http://127.0.0.1:3000`   | Base URL the smoke checks call from the server        |
| `DEPLOY_DB_URL`          | unset                     | Server-side SQLite URL for the pre-restart backup     |
| `DEPLOY_DB_BACKUP_DIR`   | `$DEPLOY_DIR/backups`     | Where pre-deploy backups are written                  |
| `DEPLOY_INTERNAL_SECRET` | unset                     | Adds the authenticated `/internal/health` smoke check |
| `ALLOW_DIRTY_DEPLOY`     | unset                     | `1` bypasses the clean-tree guard (hotfix only)       |

`DEPLOY_INTERNAL_SECRET` must match the server's `UPTIME_INGEST_SECRET`.
Otherwise `/internal/health` answers 401 (or 404 when the route is disabled)
and the smoke check correctly rolls the release back. Leave it unset when the
private routes are off.

### Operations environment

No host alias, address or ssh user is committed. Copy `.env.deploy.example` to
`.env.deploy` at the repo root and fill in real values; it is gitignored, and
`deploy.sh` and `deploy-monitor.sh` source it before reading their
variables. `DEPLOY_ENV_FILE` points them at a different file. The GitHub Actions
deploy never reads this file: its values come from the secrets listed above,
and the job fails if `.env.deploy` is present in the checkout.

Required: `DEPLOY_HOST`, `MONITOR_RELAY`, `MONITOR_HOST`, `BACKUP_REMOTE`.
Everything else has a usable default. On the server, `backup-db.sh` also reads
`/etc/nbkristqik-backup.env` when it exists, so the cron job does not need the
values inline.

### Database backup before restart

Set `DEPLOY_DB_URL` to the server's SQLite URL. The deploy pipes it to node over
stdin and never echoes it or puts it on a command line, then runs `VACUUM INTO`
through the `@libsql/client` already installed in `$DIR`. The copy lands under
`$DEPLOY_DB_BACKUP_DIR` (default `$DIR/backups`) as
`qik-pre-deploy-<UTC>.db`; point the override at `/home/ubuntu/backups` if you
want it beside the nightly copies. A configured backup that fails aborts the
deploy before the restart.

When `DEPLOY_DB_URL` is unset, an absolute `file:` `LOCAL_DB_URL` (the same
production path exported for the app) is used if that file exists on the
server; a relative or development `LOCAL_DB_URL` is ignored with a warning.
With neither usable, the deploy prints a clear warning and continues: the
nightly [`scripts/backup-db.sh`](../scripts/backup-db.sh) copy is then the only
database protection for that deploy. This is expected on a Turso-only app,
where there is no server-side SQLite file to vacuum.

The deploy ships `backup-db.sh`, `restore-db.sh` and the Turso import helper to
`$DIR/`. Install the nightly cron once on the host (it is deliberately not
edited by the deploy script):

```cron
15 2 * * * /home/ubuntu/nbkristqik/backup-db.sh >> /home/ubuntu/backups/backup.log 2>&1
```

The off-box copy needs `BACKUP_REMOTE` (optionally `BACKUP_REMOTE_DIR`). Set it
in `/etc/nbkristqik-backup.env` or the cron environment. The backup exits
non-zero if the off-box copy fails or `BACKUP_REMOTE` is unset, so cron mail or
an external check sees an incomplete night. Restore is manual:
`sudo systemctl stop nbkristqik && /home/ubuntu/nbkristqik/restore-db.sh <backup>`.

### Status page and library

`src/status/` is rsynced with `--delete` to `$DIR/public/status/`; Express
serves `public/status/index.html` at `/status` (the JSON feed stays at
`/api/status`). `STATUS_PAGE_PATH` can point the route at another file for
development. The page has no external font request, and every 90-day bar
carries the day's status as text plus a keyboard/tap detail line.

The same-origin app is `src/web/dist-library/` → `$DIR/public/library/`, served
at `/library/` so its session cookie stays first-party. Only the syllabus
catalogue snapshot from `data/` is shipped; runtime data stays on the server.

### Host and loopback

The API binds `HOST` (default `127.0.0.1`) on `PORT` (default `3000`). Keep it
on loopback and let nginx terminate TLS and proxy to
`http://127.0.0.1:3000`; do not open `PORT` on the public interface. The smoke
checks default to `DEPLOY_BASE_URL=http://127.0.0.1:3000` and run over SSH, so
they exercise the app without depending on DNS, TLS or nginx. Override
`DEPLOY_BASE_URL` only if the service listens elsewhere.

### Node runtime

Node 20 is EOL. Use Node 22 (maintenance LTS) or 24 (the version `.nvmrc`
pins): `package.json` requires `>=22`. CI runs the root suite on both. Upgrade
the local checkout and the server before rolling this release, then restart the
unit; a build made on Node 22/24 is what the new `engines` field expects.

```bash
nvm install 24 && nvm use 24
node --version   # v24.x
```

The web app is built once by `build:library` and shipped by `scripts/deploy.sh`
to `public/library/`. The old GitHub Pages app build, the standalone
`index.html`/`register.html`/`report.html` pages and their `pnpm deploy` /
`gh-pages` flow are retired. The static marketing site under
`src/web/public/site/` keeps its own Pages-only deploy:
`cd src/web && pnpm deploy:site`. The Telegram WebApp SDK is vendored into
`src/web/public/telegram-web-app.js` (rev 59) instead of loaded from
telegram.org — telegram.org is slow on Indian networks and the SDK was the
render-blocking first script on the page. Re-vendor when bumping the revision;
the rev is noted in the app's HTML head.

## External uptime monitor (monitor-host)

The probes are splitting in two. `src/monitor/index.ts` is a standalone,
dependency-free Node program that runs on a second host, so a dead or paused
production VM still records a down transition and still sends the Telegram
alert. It probes:

| Probe                                         | What it proves                                  |
| --------------------------------------------- | ----------------------------------------------- |
| `GET /health` on `MONITOR_BASE_URL`           | the public API and nginx path are reachable     |
| `GET /internal/health` with the ingest secret | the database and Redis are alive inside the app |
| `GET` on `MONITOR_PORTAL_URL`                 | the college portal host answers                 |

The monitor writes the heartbeats back to `/internal/uptime`; when the API is
down the rows go into a local JSONL spool and replay when it returns. The
production API keeps the history, the 90-day bars and the status page. The old
in-process probe still starts from `src/bot/index.ts` and stays enabled until
the external monitor has produced fresh heartbeats in the 90-day history;
remove it only after that, and keep `dist.prev` in the meantime so a rollback
still has it.

### One-time host setup

On monitor-host, create a dedicated system user and the root-only environment file.
The monitor never reads `/home`, so it cannot see the password manager or any
other user data on that host.

```bash
sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin qik-uptime
sudo install -d -m 0700 -o qik-uptime -g qik-uptime /var/lib/nbkristqik-uptime
sudo install -m 0600 /dev/null /etc/nbkristqik-uptime.env
```

Put these in `/etc/nbkristqik-uptime.env` (root:root 0600):

```dotenv
UPTIME_INGEST_SECRET=<same 64-hex value as the production host>
MONITOR_TELEGRAM_BOT_TOKEN=<dedicated alert bot token>
ADMIN_ID=<telegram id>
MONITOR_BASE_URL=https://checker.tobioffice.online
MONITOR_STATE_DIR=/var/lib/nbkristqik-uptime
```

Use a dedicated bot for alerts. The monitor falls back to
`TELEGRAM_BOT_TOKEN` only for a single-host development setup; keeping the
production bot token off monitor-host means a compromise there cannot take over the
student bot. The admin must have started the alert bot once.

### Deploy and verify

```bash
scripts/deploy-monitor.sh
```

The script type-checks, lints and tests, builds `dist/monitor/index.js`, copies
it and `scripts/nbkristqik-uptime.service` to monitor-host through the
`MONITOR_RELAY` relay, installs the unit and restarts it. `MONITOR_RELAY` and
`MONITOR_HOST` are required; `MONITOR_USER` defaults to `ubuntu`. It expects
`/etc/nbkristqik-uptime.env` to exist and to be root-owned 0600; it never reads
or prints the secret.

```bash
ssh monitor-host 'systemctl status nbkristqik-uptime --no-pager'
ssh monitor-host 'journalctl -u nbkristqik-uptime -n 30 --no-pager'
```

A healthy start logs `[monitor] starting`, then `[cycle] api=up portal=up
database=up redis=up` after the first probe. `systemctl is-active` alone is not
enough: the first-cycle line is the proof the secret was accepted and the rows
were stored.

### Security boundaries

- `/internal/*` is protected by a constant-time bearer check, a rate limit and
  an nginx `allow` rule for monitor-host's address. Disabling the secret removes the
  routes entirely. Add this block to the
  `checker.tobioffice.online` server before `location /`:

  ```nginx
  location /internal/ {
      allow <monitor-host-ip>;
      deny all;
      proxy_pass http://127.0.0.1:3000;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_read_timeout 30s;
      proxy_connect_timeout 5s;
  }
  ```

  Run `nginx -t` and reload after adding it. If the monitor host moves, update
  the address here as well as its DNS.

- The unit runs as `qik-uptime` with `ProtectHome=true`, `ProtectSystem=strict`,
  an empty capability set, `NoNewPrivileges` and a state directory it owns.
  The monitor does not listen on any port.
- The state and spool files are created 0600 inside a 0700 directory; the env
  file is read by systemd as root and is not readable by the service user.
- The monitor refuses a secret shorter than 32 characters, a non-HTTPS base
  URL, and a base URL containing credentials. Telegram errors are logged
  without the request URL, so the bot token never reaches the journal.
- A watchdog exits the process if no cycle completes in time; systemd restarts
  it. This is what stops a silently hung monitor from looking healthy.

The public status page still lives on the production host, served by Express at `/status`.
The external monitor makes the measurement independent and the alerts
independent; it does not make the page itself survive a production host outage. If the
page must stay up during a full production host failure, host the static page and
`/api/status` on a third origin.

## CI

`.github/workflows/test.yml` runs two jobs on pushes and PRs to `main` /
`develop`:

- **test** — lint, typecheck, production dependency audit and coverage on Node
  22 and 24 with pnpm, uploading to Codecov.
- **web** — lint, unit tests and the one same-origin `/library/` build of
  `src/web`, on Node 24 with pnpm caching that keys off
  `src/web/pnpm-lock.yaml`.
