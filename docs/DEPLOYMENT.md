# NbkristQik Deployment

> **Note:** The generated wiki is authoritative; see
> [`openwiki/operations.md`](openwiki/operations.md). If this file disagrees
> with the code, the code wins.

## Environment variables

| Variable | Consumer | Notes |
|---|---|---|
| `ENV` | `src/config/environmentals.ts` | `production` (default) or `development`; switches token/channel selection. The dev `userId` shortcut also needs `ALLOW_DEV_IDENTITY=1` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_TOKEN_DEV` | bot, initData HMAC | Production vs dev token |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | `src/db/db.ts` | Turso connection |
| `REDIS_URL` | Redis client | Cache |
| `N_USERNAME` / `N_PASSWORD` | portal session + `/syncdb` | College portal credentials |
| `ADMIN_ID` | command handlers | Telegram id for admin commands and report forwarding |
| `PROD_CHANNEL` / `TEST_CHANNEL` | config | Channel selected by `ENV` |
| `ADMIN_PANEL_PATH` / `ADMIN_PANEL_PASSWORD` | admin panel | Panel disabled unless both are set; production also refuses a password shorter than 16 characters |
| `CORS_ORIGINS` | API | Comma-separated allowlist; default `https://checker.tobioffice.dev` |
| `PORTAL_BASE_URL` | constants | Optional; default `http://103.203.175.91` |
| `HOST` / `PORT` | API | Bind address and port; defaults `127.0.0.1:3000` |
| `STATUS_PAGE_PATH` | `src/api/server.ts` | Optional override for the `/status` file; defaults to `public/status/index.html` |
| `UPTIME_INGEST_SECRET` | `src/api/internal.ts` | Shared secret for `/internal/*`; unset disables both routes |
| `MONITOR_*` | `src/monitor/index.ts` | Only read by the oracle2 monitor, not the bot |

Start from [`.env.example`](../.env.example).

## Build and run

Node 22 or 24 is required (`.nvmrc` pins 24; Node 20 is EOL). The web app is a
separate package with its own lockfile.

```bash
pnpm install
pnpm dev        # TypeScript, bot + API
pnpm build      # tsc -> dist/
pnpm start      # node dist/bot/index.js
(cd src/web && pnpm install && pnpm build:library)  # /library/ bundle
```

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm exec vitest run` (or
`test:coverage`). `build`/`build:library` build only the `/library/` app; the
static marketing site publishes separately with `cd src/web && pnpm deploy:site`
(it stages `public/site/` and runs `gh-pages -d dist-site --nojekyll`).

## Production deployment

The bot runs as the `nbkristqik` **systemd** service on the production server.
The server has very little RAM, so the TypeScript build runs locally and only
`dist/` and the built static surfaces are shipped:

```bash
DEPLOY_DB_URL=file:/home/ubuntu/nbkristqik/data/qik.db scripts/deploy.sh
```

### Clean tree

The deploy ships a commit, not the working tree. It stops before the checks or
the build when `git diff`, `git diff --cached` or
`git ls-files --others --exclude-standard` report anything. Commit or stash
first. The only escape is `ALLOW_DIRTY_DEPLOY=1`, reserved for an emergency
hotfix; it prints a warning and continues.

### What the script does

1. Preflight: `pnpm run typecheck`, `pnpm run typecheck:tests`, `pnpm run lint`,
   the root Vitest suite and the `src/web` Vitest suite, then `pnpm build` and
   `pnpm run build:library`.
2. On `$HOST`: `mkdir -p $DIR`; refuse to start if an unfinished previous
   release left `$DIR/dist.old` in place.
3. Sync the compiled `dist/` into `$DIR/dist.new/`, then swap it into `$DIR/dist`
   while moving the live build to `$DIR/dist.old`. A failed rsync never touches
   the live `dist/`.
4. Sync the manifests, the ops scripts (`backup-db.sh`, `restore-db.sh`,
   `import-turso-snapshot.mjs`), then `src/status/` →
   `$DIR/public/status/`, `src/web/dist-library/` → `$DIR/public/library/` and
   `data/syllabus-catalog.json` → `$DIR/data/`.
5. `pnpm install --prod --frozen-lockfile` (pnpm is installed into `~/.local`
   if the server does not have it).
6. The optional `VACUUM INTO` backup described below.
7. `sudo systemctl restart $SERVICE`.
8. Smoke checks with `curl` from the server itself: retry `/health` for about
   30 s, then require `/status`, `/library/` and the hashed JS asset referenced
   by the freshly built HTML to return 200 (`-L` follows the `/status` →
   `/status/` redirect if the route is mounted as a static directory). With
   `DEPLOY_INTERNAL_SECRET` set, the authenticated `/internal/health` must also
   return 200; otherwise that check is skipped with a note.
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

### Deploy overrides

| Variable | Default | Purpose |
|---|---|---|
| `DEPLOY_HOST` | `oracle3` | SSH alias of the production host |
| `DEPLOY_DIR` | `/home/ubuntu/nbkristqik` | Application directory on the server |
| `DEPLOY_SERVICE` | `nbkristqik` | systemd unit to restart |
| `DEPLOY_BASE_URL` | `http://127.0.0.1:3000` | Base URL the smoke checks call from the server |
| `DEPLOY_DB_URL` | unset | Server-side SQLite URL for the pre-restart backup |
| `DEPLOY_DB_BACKUP_DIR` | `$DEPLOY_DIR/backups` | Where pre-deploy backups are written |
| `DEPLOY_INTERNAL_SECRET` | unset | Adds the authenticated `/internal/health` smoke check |
| `ALLOW_DIRTY_DEPLOY` | unset | `1` bypasses the clean-tree guard (hotfix only) |

`DEPLOY_INTERNAL_SECRET` must match the server's `UPTIME_INGEST_SECRET`.
Otherwise `/internal/health` answers 401 (or 404 when the route is disabled)
and the smoke check correctly rolls the release back. Leave it unset when the
private routes are off.

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

The backup exits non-zero if the off-box copy fails, so cron mail or an
external check sees an incomplete night. Restore is manual:
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

## External uptime monitor (oracle2)

The probes are splitting in two. `src/monitor/index.ts` is a standalone,
dependency-free Node program that runs on a second host, so a dead or paused
production VM still records a down transition and still sends the Telegram
alert. It probes:

| Probe | What it proves |
|---|---|
| `GET /health` on `MONITOR_BASE_URL` | the public API and nginx path are reachable |
| `GET /internal/health` with the ingest secret | the database and Redis are alive inside the app |
| `GET` on `MONITOR_PORTAL_URL` | the college portal host answers |

The monitor writes the heartbeats back to `/internal/uptime`; when the API is
down the rows go into a local JSONL spool and replay when it returns. The
production API keeps the history, the 90-day bars and the status page. The old
in-process probe still starts from `src/bot/index.ts` and stays enabled until
the external monitor has produced fresh heartbeats in the 90-day history;
remove it only after that, and keep `dist.prev` in the meantime so a rollback
still has it.

### One-time host setup

On oracle2, create a dedicated system user and the root-only environment file.
The monitor never reads `/home`, so it cannot see the password manager or any
other user data on that host.

```bash
sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin qik-uptime
sudo install -d -m 0700 -o qik-uptime -g qik-uptime /var/lib/nbkristqik-uptime
sudo install -m 0600 /dev/null /etc/nbkristqik-uptime.env
```

Put these in `/etc/nbkristqik-uptime.env` (root:root 0600):

```dotenv
UPTIME_INGEST_SECRET=<same 64-hex value as oracle3>
MONITOR_TELEGRAM_BOT_TOKEN=<dedicated alert bot token>
ADMIN_ID=<telegram id>
MONITOR_BASE_URL=https://checker.tobioffice.dev
MONITOR_STATE_DIR=/var/lib/nbkristqik-uptime
```

Use a dedicated bot for alerts. The monitor falls back to
`TELEGRAM_BOT_TOKEN` only for a single-host development setup; keeping the
production bot token off oracle2 means a compromise there cannot take over the
student bot. The admin must have started the alert bot once.

### Deploy and verify

```bash
scripts/deploy-monitor.sh
```

The script type-checks, lints and tests, builds `dist/monitor/index.js`, copies
it and `scripts/nbkristqik-uptime.service` to oracle2 through the `oracle3`
relay, installs the unit and restarts it. It expects
`/etc/nbkristqik-uptime.env` to exist and to be root-owned 0600; it never reads
or prints the secret.

```bash
ssh oracle2 'systemctl status nbkristqik-uptime --no-pager'
ssh oracle2 'journalctl -u nbkristqik-uptime -n 30 --no-pager'
```

A healthy start logs `[monitor] starting`, then `[cycle] api=up portal=up
database=up redis=up` after the first probe. `systemctl is-active` alone is not
enough: the first-cycle line is the proof the secret was accepted and the rows
were stored.

### Security boundaries

- `/internal/*` is protected by a constant-time bearer check, a rate limit and
  an nginx `allow` rule for oracle2's address. Disabling the secret removes the
  routes entirely. Add this block to the
  `checker.tobioffice.dev` server before `location /`:

  ```nginx
  location /internal/ {
      allow 140.245.255.152;
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

The public status page still lives on oracle3, served by Express at `/status`.
The external monitor makes the measurement independent and the alerts
independent; it does not make the page itself survive an oracle3 outage. If the
page must stay up during a full oracle3 failure, host the static page and
`/api/status` on a third origin.

## CI

`.github/workflows/test.yml` runs two jobs on pushes and PRs to `main` /
`develop`:

- **test** — lint, typecheck, production dependency audit and coverage on Node
  22 and 24 with pnpm, uploading to Codecov.
- **web** — lint, unit tests and the one same-origin `/library/` build of
  `src/web`, on Node 24 with pnpm caching that keys off
  `src/web/pnpm-lock.yaml`.

`.github/workflows/openwiki-update.yml` refreshes the generated wiki daily and
opens a pull request.
