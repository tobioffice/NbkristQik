#!/usr/bin/env bash
# Deploys NbkristQik to the production server.
#
# The server has very little RAM, so everything that needs memory happens
# here: the TypeScript build runs locally and only dist/ is shipped.
# The bot runs as the systemd service "nbkristqik".
#
# Usage: scripts/deploy.sh
# Requires: ssh access to $HOST (the "oracle3" ssh alias), rsync, curl on the
#           server, and pnpm on the server (auto-installed to ~/.local if
#           missing).
#
# The deploy is reversible: the previous dist/ is kept at dist.prev before
# the new build is synced, and a failed smoke check restores it and restarts
# the old build. Set DEPLOY_DB_URL to a server-side SQLite URL to take a
# VACUUM INTO backup before the restart. Set ALLOW_DIRTY_DEPLOY=1 to deploy a
# working tree that is not committed (hotfix only).
set -euo pipefail

HOST="${DEPLOY_HOST:-oracle3}"
DIR="${DEPLOY_DIR:-/home/ubuntu/nbkristqik}"
SERVICE="${DEPLOY_SERVICE:-nbkristqik}"
# Smoke checks go to loopback so they do not depend on nginx, DNS or TLS.
BASE_URL="${DEPLOY_BASE_URL:-http://127.0.0.1:3000}"
BASE_URL="${BASE_URL%/}"
BACKUP_DIR="${DEPLOY_DB_BACKUP_DIR:-$DIR/backups}"

echo "==> Checking the working tree"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "ERROR: scripts/deploy.sh must run from a git checkout." >&2
  exit 1
}

if [[ "${ALLOW_DIRTY_DEPLOY:-0}" == "1" ]]; then
  echo "    WARNING: ALLOW_DIRTY_DEPLOY=1 — shipping uncommitted changes."
else
  if ! git diff --quiet || ! git diff --cached --quiet ||
    [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
    cat >&2 <<'MSG'
ERROR: the working tree is not clean. The deploy ships what is committed, so
       a dirty tree can ship code that no one reviewed. Commit or stash the
       changes first. For an emergency hotfix only, re-run with:

           ALLOW_DIRTY_DEPLOY=1 scripts/deploy.sh
MSG
    exit 1
  fi
  echo "    clean: no staged, unstaged or untracked files."
fi

echo "==> Checking before anything ships"
# A green build is not a green product. The attendance table once shipped
# missing because the tests of the day had been rewritten to match it, and
# a build-only deploy cannot notice that. These checks run first; set -e
# stops the deploy on the first red test.
pnpm run typecheck
pnpm run typecheck:tests
pnpm run lint
pnpm exec vitest run
(cd src/web && pnpm install --frozen-lockfile && pnpm exec vitest run)

echo "==> Building locally"
pnpm build

echo "==> Building the library web app"
(cd src/web && pnpm run build:library)

echo "==> Preparing the release directory on $HOST"
ssh "$HOST" "mkdir -p '$DIR'"
# A previous run that failed after the swap leaves the known-good build in
# dist.old. Never delete it by starting another release on top of it.
if ssh "$HOST" "test -d '$DIR/dist.old'"; then
  cat >&2 <<MSG
ERROR: $HOST has an unfinished release at $DIR/dist.old.
       The live dist/ may be the unverified new build. Restore the known-good
       copy before retrying:
         ssh $HOST 'rm -rf $DIR/dist && mv $DIR/dist.old $DIR/dist'
         ssh $HOST 'sudo systemctl restart $SERVICE'
       Then re-run this script.
MSG
  exit 1
fi

echo "==> Syncing dist/ + manifest to $HOST:$DIR"
# Sync into a staging directory so a failed rsync can never leave the live
# dist/ half-deleted. The swap below keeps the previous directory as dist.old
# until the smoke checks pass; dist.prev is only updated after a good release.
ssh "$HOST" "rm -rf '$DIR/dist.new' && mkdir -p '$DIR/dist.new'"
rsync -az --delete dist/ "$HOST:$DIR/dist.new/"
ssh "$HOST" "set -e;
  if [ -d '$DIR/dist' ]; then mv '$DIR/dist' '$DIR/dist.old'; fi;
  if ! mv '$DIR/dist.new' '$DIR/dist'; then
    rm -rf '$DIR/dist';
    if [ -d '$DIR/dist.old' ]; then mv '$DIR/dist.old' '$DIR/dist'; fi;
    exit 1;
  fi"
rsync -az package.json pnpm-lock.yaml pnpm-workspace.yaml "$HOST:$DIR/"
# Ops scripts must exist on the host, not only in the git checkout: the cron
# backup and the manual restore are part of the release contract.
rsync -az scripts/backup-db.sh scripts/restore-db.sh \
  scripts/import-turso-snapshot.mjs "$HOST:$DIR/"

echo "==> Syncing the status page, library bundle and syllabus catalogue"
ssh "$HOST" "mkdir -p '$DIR/public/status' '$DIR/public/library' '$DIR/data'"
# src/status/ is shipped as public/status/; Express serves it at /status.
rsync -az --delete src/status/ "$HOST:$DIR/public/status/"
rsync -az --delete src/web/dist-library/ "$HOST:$DIR/public/library/"
rsync -az data/syllabus-catalog.json "$HOST:$DIR/data/syllabus-catalog.json"

echo "==> Installing production dependencies on server"
ssh "$HOST" "cd '$DIR' && export PATH=\$HOME/.local/bin:\$PATH &&
  command -v pnpm >/dev/null 2>&1 || { export NPM_CONFIG_PREFIX=\$HOME/.local; npm install -g pnpm@10; } &&
  pnpm install --prod --frozen-lockfile"

# --- pre-restart database backup -------------------------------------------
# VACUUM INTO writes a consistent copy from a live SQLite connection. The
# URL is piped to node over stdin, never placed on a command line or echoed,
# so a token embedded in a libsql:// URL stays out of process lists and logs.
DB_BACKUP_URL="${DEPLOY_DB_URL:-}"
DB_BACKUP_SOURCE="DEPLOY_DB_URL"

if [[ -z "$DB_BACKUP_URL" && -n "${LOCAL_DB_URL:-}" ]]; then
  if [[ "$LOCAL_DB_URL" == file:/* ]]; then
    DB_BACKUP_URL="$LOCAL_DB_URL"
    DB_BACKUP_SOURCE="LOCAL_DB_URL"
  else
    echo "    WARNING: LOCAL_DB_URL is not an absolute file: URL; it is a local" >&2
    echo "             development path and is ignored for the server backup." >&2
  fi
fi

# An absolute LOCAL_DB_URL inherited from a development shell may still point
# at this machine's disk. Use it only when that file exists on the server;
# DEPLOY_DB_URL is explicit and is allowed to fail loudly instead.
if [[ "$DB_BACKUP_SOURCE" == "LOCAL_DB_URL" && -n "$DB_BACKUP_URL" ]]; then
  backup_path="${DB_BACKUP_URL#file:}"
  backup_path="${backup_path#//}"
  if ! ssh "$HOST" "test -f '$backup_path'"; then
    echo "    WARNING: LOCAL_DB_URL points at '$backup_path', which is not on $HOST." >&2
    echo "             Skipping the server backup; pass DEPLOY_DB_URL to override." >&2
    DB_BACKUP_URL=""
  fi
fi

if [[ -z "$DB_BACKUP_URL" ]]; then
  echo "==> WARNING: no DEPLOY_DB_URL configured"
  cat >&2 <<'MSG'
             Skipping the pre-restart VACUUM INTO backup. The nightly
             scripts/backup-db.sh copy is the only DB protection for this
             deploy. Set DEPLOY_DB_URL to the production SQLite URL, e.g.:

                 DEPLOY_DB_URL=file:/home/ubuntu/nbkristqik/data/qik.db \
                   scripts/deploy.sh
MSG
else
  echo "==> Backing up the database on $HOST before restart ($DB_BACKUP_SOURCE)"
  BACKUP_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  BACKUP_DEST="$BACKUP_DIR/qik-pre-deploy-$BACKUP_STAMP.db"

  # The node program is sent base64-encoded so shell quoting cannot break it.
  # It reads the database URL from stdin and writes only the destination path.
  BACKUP_JS="$(cat <<'JS'
import { createClient } from "@libsql/client";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const url = Buffer.concat(chunks).toString("utf8").trim();
if (!url) {
  console.error("no database URL on stdin");
  process.exit(2);
}
const dest = process.env.DEST;
if (!dest) {
  console.error("no DEST in the environment");
  process.exit(2);
}
const literal = "'" + dest.replace(/'/g, "''") + "'";
const client = createClient({ url });
await client.execute(`VACUUM INTO ${literal}`);
console.log("    database backup written:", dest);
JS
)"
  BACKUP_JS_B64="$(printf '%s' "$BACKUP_JS" | base64 | tr -d '\n')"
  # Paths are base64-encoded too: they are decoded on the remote side, so a
  # directory containing spaces or quotes cannot corrupt the command or DEST.
  BACKUP_DIR_B64="$(printf '%s' "$BACKUP_DIR" | base64 | tr -d '\n')"
  BACKUP_DEST_B64="$(printf '%s' "$BACKUP_DEST" | base64 | tr -d '\n')"

  if ! printf '%s\n' "$DB_BACKUP_URL" | ssh "$HOST" "cd '$DIR' &&
    umask 077 &&
    backup_dir=\$(printf '%s' '$BACKUP_DIR_B64' | base64 -d) &&
    backup_dest=\$(printf '%s' '$BACKUP_DEST_B64' | base64 -d) &&
    mkdir -p \"\$backup_dir\" &&
    rm -f \"\$backup_dest\" &&
    DEST=\"\$backup_dest\" node --input-type=module -e \"\$(printf '%s' '$BACKUP_JS_B64' | base64 -d)\""; then
    echo "ERROR: VACUUM INTO backup failed, so the deploy stopped before restart." >&2
    echo "       Fix DEPLOY_DB_URL ($DB_BACKUP_SOURCE) and retry. To deploy" >&2
    echo "       without a pre-restart backup, unset it and accept the warning." >&2
    exit 1
  fi
fi

# --- restart, verify, roll back -------------------------------------------
restart_service() {
  ssh "$HOST" "sudo systemctl restart '$SERVICE' && sleep 2 && systemctl is-active '$SERVICE'"
}

rollback() {
  echo "==> ROLLBACK: restoring the previous build" >&2
  # The just-replaced live build is dist.old until the smoke checks pass.
  # Fall back to the last known-good dist.prev for an older layout.
  ROLLBACK_SRC="$DIR/dist.old"
  if ! ssh "$HOST" "test -d '$ROLLBACK_SRC'"; then
    ROLLBACK_SRC="$DIR/dist.prev"
  fi
  if ! ssh "$HOST" "test -d '$ROLLBACK_SRC'"; then
    echo "ROLLBACK IMPOSSIBLE: neither $DIR/dist.old nor $DIR/dist.prev exists." >&2
    echo "  The new build may be live and failing. Inspect it with:" >&2
    echo "    ssh $HOST 'journalctl -u $SERVICE -n 50 --no-pager'" >&2
    exit 1
  fi

  if ssh "$HOST" "rm -rf '$DIR/dist' && cp -a '$ROLLBACK_SRC' '$DIR/dist' &&
    sudo systemctl restart '$SERVICE' && sleep 2 && systemctl is-active '$SERVICE'"; then
    echo "ROLLBACK COMPLETE: $DIR/dist is the previous build and '$SERVICE' is active." >&2
    echo "  The snapshot is still at $ROLLBACK_SRC. The failed release's static" >&2
    echo "  assets (public/library, public/status) were not rolled back; the old" >&2
    echo "  build ignores the new ones. No database restore was attempted — use the" >&2
    echo "  backup written before the restart if data needs manual recovery." >&2
    # The restored build is now live; clear the failed-release marker so the
    # next deploy can take a fresh snapshot instead of refusing on dist.old.
    ssh "$HOST" "rm -rf '$DIR/dist.old'" || true
  else
    echo "ROLLBACK ERROR: the previous build was restored but '$SERVICE' is not active." >&2
    echo "  Check 'ssh $HOST journalctl -u $SERVICE -n 50 --no-pager' now." >&2
  fi
  exit 1
}

echo "==> Restarting systemd service '$SERVICE'"
if ! restart_service; then
  echo "ERROR: '$SERVICE' did not become active after the new build." >&2
  rollback
fi

echo "==> Waiting for the API to answer /health"
health_code=""
for _ in {1..15}; do
  health_code="$(ssh "$HOST" "curl -sS -o /dev/null -w '%{http_code}' --max-time 5 '$BASE_URL/health'" || true)"
  if [[ "$health_code" == "200" ]]; then
    break
  fi
  sleep 2
done

if [[ "$health_code" == "200" ]]; then
  echo "    OK   GET /health -> 200"
else
  echo "    FAIL GET /health -> ${health_code:-no response} after retrying (expected 200)" >&2
  rollback
fi

echo "==> Smoke-checking /status, /library/ and a hashed asset"
smoke_failed=0
SMOKE_PATHS=(/status /library/)
# A 200 on the shell proves nothing if its hashed JS is missing. Read the
# asset path out of the freshly built HTML and fetch that too.
ASSET_PATH="$(grep -oE '/library/assets/[^"]+\.js' src/web/dist-library/index.html 2>/dev/null | head -1 || true)"
if [[ -n "$ASSET_PATH" ]]; then
  SMOKE_PATHS+=("$ASSET_PATH")
else
  echo "    WARNING: could not find a hashed JS asset in the built index.html" >&2
fi
for path in "${SMOKE_PATHS[@]}"; do
  # -L is harmless for the direct /status response and covers a future static
  # mount that redirects /status to /status/. Connection failures leave the
  # code empty.
  code="$(ssh "$HOST" "curl -sS -L -o /dev/null -w '%{http_code}' --max-time 10 '$BASE_URL$path'" || true)"
  if [[ "$code" == "200" ]]; then
    echo "    OK   GET $path -> 200"
  else
    echo "    FAIL GET $path -> ${code:-no response} (expected 200)" >&2
    smoke_failed=1
  fi
done

if [[ -n "${DEPLOY_INTERNAL_SECRET:-}" ]]; then
  echo "    Checking authenticated GET /internal/health"
  # curl reads the Authorization header from stdin (--config -), so the
  # secret never appears in the remote process list or the script output.
  internal_code="$(printf 'header = "Authorization: Bearer %s"\n' "$DEPLOY_INTERNAL_SECRET" |
    ssh "$HOST" "curl -sS -o /dev/null -w '%{http_code}' --max-time 10 --config - '$BASE_URL'" || true)"
  if [[ "$internal_code" == "200" ]]; then
    echo "    OK   GET /internal/health -> 200"
  else
    echo "    FAIL GET /internal/health -> ${internal_code:-no response} (expected 200)" >&2
    smoke_failed=1
  fi
else
  echo "    SKIP GET /internal/health: DEPLOY_INTERNAL_SECRET is not set."
fi

if ((smoke_failed)); then
  echo "ERROR: post-deploy smoke checks failed; rolling back." >&2
  rollback
fi

# The new build has passed the smoke checks. Promote the replaced build to
# dist.prev only now, so a failed release never overwrites the known-good copy.
# A first deploy has no dist.old and nothing to promote.
if ssh "$HOST" "test -d '$DIR/dist.old'"; then
  if ! ssh "$HOST" "rm -rf '$DIR/dist.prev' && mv '$DIR/dist.old' '$DIR/dist.prev'"; then
    echo "WARNING: release is live, but the previous build could not be promoted" >&2
    echo "         from $DIR/dist.old to $DIR/dist.prev. The next deploy will refuse" >&2
    echo "         until that directory is cleaned up or promoted manually." >&2
    exit 1
  fi
fi

echo "==> Deployed. Service '$SERVICE' is active and /health, /status and /library/ return 200."
