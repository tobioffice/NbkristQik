#!/usr/bin/env bash
#
# Manual restore of the bot's embedded SQLite database from a verified
# backup produced by backup-db.sh.
#
#   scripts/restore-db.sh /home/ubuntu/backups/qik-2026-11-04.db
#   scripts/restore-db.sh /home/ubuntu/backups/qik-2026-11-04.db --force
#
# This script is intentionally manual: nothing in deploy, cron or the app
# calls it. Safety rules:
#   - the backup is integrity-checked before anything is touched
#   - the service (systemd "nbkristqik" or a running dist/bot/index.js) must be
#     stopped unless --force is given
#   - the current database is copied aside first
#   - the new file is written to a temp path, verified, then renamed into place
#     (atomic on the same filesystem)
#
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/nbkristqik}"
SERVICE="${DEPLOY_SERVICE:-nbkristqik}"
DB_URL="${LOCAL_DB_URL:-file:$APP_DIR/data/qik.db}"

usage() {
  cat >&2 <<EOF
usage: $(basename "$0") <backup.db> [--force]

Restores a verified backup over the embedded database.

  --force   proceed even if the service is still running (dangerous: the
            running process keeps its old connection and may still write)

Configure with APP_DIR, DEPLOY_SERVICE and LOCAL_DB_URL, same as the bot.
EOF
}

FORCE=0
BACKUP=""
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "error: unknown option: $arg" >&2; usage; exit 2 ;;
    *)
      if [ -n "$BACKUP" ]; then
        echo "error: more than one backup path given" >&2
        usage
        exit 2
      fi
      BACKUP="$arg"
      ;;
  esac
done

if [ -z "$BACKUP" ]; then
  usage
  exit 2
fi
if [ ! -f "$BACKUP" ]; then
  echo "error: backup not found: $BACKUP" >&2
  exit 1
fi
# resolve before any cd, so a relative argument keeps working from here
BACKUP="$(cd "$(dirname "$BACKUP")" && pwd)/$(basename "$BACKUP")"

case "$DB_URL" in
  file:*) ;;
  *)
    echo "error: LOCAL_DB_URL must be a file: URL for restore (got: $DB_URL)" >&2
    echo "       a remote Turso database is restored with turso's own tooling." >&2
    exit 1
    ;;
esac
# strip the file: scheme and any ?query suffix libsql accepts
DB_PATH="${DB_URL#file:}"
DB_PATH="${DB_PATH%%\?*}"
# the bot resolves a relative file: URL against its working directory
case "$DB_PATH" in
  /*) ;;
  *) DB_PATH="$APP_DIR/$DB_PATH" ;;
esac
DB_DIR="$(dirname "$DB_PATH")"

service_running() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl is-active --quiet "$SERVICE" 2>/dev/null && return 0
  fi
  # fallback for a manually started bot process
  pgrep -f "dist/bot/index\.js" >/dev/null 2>&1
}

verify() {
  local db="$1"
  (
    cd "$APP_DIR"
    DB_PATH="$db" node --input-type=module -e '
      const { createClient } = await import("@libsql/client");
      const c = createClient({ url: "file:" + process.env.DB_PATH });
      const res = await c.execute("PRAGMA integrity_check");
      const value = res.rows[0] ? Object.values(res.rows[0])[0] : null;
      await c.close();
      if (value !== "ok") {
        console.error(
          "integrity_check failed for " + process.env.DB_PATH + ":",
          JSON.stringify(res.rows.slice(0, 5)),
        );
        process.exit(1);
      }
      console.log("integrity ok:", process.env.DB_PATH);
    '
  )
}

if service_running; then
  if [ "$FORCE" -ne 1 ]; then
    echo "refusing to restore: '$SERVICE' is running (or a bot process is)." >&2
    echo "  stop it first: sudo systemctl stop $SERVICE" >&2
    echo "  then rerun this script (or pass --force to accept the risk)." >&2
    exit 1
  fi
  echo "WARNING: --force given while '$SERVICE' is still running." >&2
  echo "WARNING: the running process keeps its old connection; restart it right after." >&2
fi

echo "==> Verifying backup: $BACKUP"
verify "$BACKUP"

mkdir -p "$DB_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PREVIOUS="$DB_PATH.pre-restore-$STAMP"
TMP="$DB_PATH.restore-$STAMP"

cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

if [ -f "$DB_PATH" ]; then
  echo "==> Keeping the current database at: $PREVIOUS"
  cp -p "$DB_PATH" "$PREVIOUS"
fi

echo "==> Staging restored copy"
cp "$BACKUP" "$TMP"
if [ -f "$DB_PATH" ]; then
  # keep the database file's ownership and mode if we can
  chown --reference="$DB_PATH" "$TMP" 2>/dev/null || true
  chmod --reference="$DB_PATH" "$TMP" 2>/dev/null || true
else
  chmod 600 "$TMP"
fi

# verify what will actually land, not just the source file
verify "$TMP"

echo "==> Replacing $DB_PATH"
mv -f "$TMP" "$DB_PATH"
# -wal/-shm belong to the database we just replaced; leaving them behind can
# mix old pages into the restored file.
rm -f "$DB_PATH-wal" "$DB_PATH-shm"

cat <<EOF

==> Restore complete
    from:      $BACKUP
    database:  $DB_PATH
    previous:  ${PREVIOUS:-none}
    integrity: ok

Next steps:
  1. Start the bot:     sudo systemctl start $SERVICE
  2. Check it booted:   sudo systemctl status $SERVICE --no-pager
  3. Read the logs:     sudo journalctl -u $SERVICE -n 50 --no-pager
  4. Re-run /syncdb if the backup predates the current semester.
  5. If anything looks wrong: stop the service, move the "previous" file
     above back to $DB_PATH, and start it again.
EOF
