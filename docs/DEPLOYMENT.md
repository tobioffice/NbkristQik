# NbkristQik Deployment

> **Note:** The generated wiki is authoritative; see
> [`openwiki/operations.md`](openwiki/operations.md). If this file disagrees
> with the code, the code wins.

## Environment variables

| Variable | Consumer | Notes |
|---|---|---|
| `ENV` | `src/config/environmentals.ts` | `production` or `development`; switches token/channel selection |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_TOKEN_DEV` | bot, initData HMAC | Production vs dev token |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | `src/db/db.ts` | Turso connection |
| `REDIS_URL` | Redis client | Cache |
| `N_USERNAME` / `N_PASSWORD` | portal session + `/syncdb` | College portal credentials |
| `ADMIN_ID` | command handlers | Telegram id for admin commands and report forwarding |
| `PROD_CHANNEL` / `TEST_CHANNEL` | config | Channel selected by `ENV` |
| `ADMIN_PANEL_PATH` / `ADMIN_PANEL_PASSWORD` | admin panel | Panel disabled unless both are set |
| `CORS_ORIGINS` | API | Comma-separated allowlist; default `https://tobioffice.github.io` |
| `PORTAL_BASE_URL` | constants | Optional; default `http://103.203.175.91` |
| `PORT` | API | Default 3000 |

Start from [`.env.example`](../.env.example).

## Build and run

```bash
pnpm install
pnpm dev        # TypeScript, bot + API
pnpm build      # tsc -> dist/
pnpm start      # node dist/bot/index.js
```

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (or `test:coverage`).
The web app is a separate package: `cd src/web && pnpm install && pnpm build`.

## Production deployment

The bot runs as the `nbkristqik` **systemd** service on the production server.
The server has very little RAM, so the TypeScript build runs locally and only
`dist/` is shipped:

```bash
scripts/deploy.sh
```

The script builds locally, rsyncs `dist/` and the manifests, installs
production dependencies with a frozen lockfile, restarts the service, and
verifies it is active. Defaults: host `oracle3`, directory
`/home/ubuntu/nbkristqik`, service `nbkristqik` — override with `DEPLOY_HOST`,
`DEPLOY_DIR`, `DEPLOY_SERVICE`.

The web leaderboard deploys separately as a static site to GitHub Pages via
`src/web`'s `deploy` script (`gh-pages -d dist`).

## CI

`.github/workflows/test.yml` runs two jobs on pushes and PRs to `main` /
`develop`:

- **test** — lint, typecheck, and coverage on Node 20 with pnpm, uploading to
  Codecov.
- **web** — lint, unit tests, and production build of `src/web`.

`.github/workflows/openwiki-update.yml` refreshes the generated wiki daily and
opens a pull request.
