#!/usr/bin/env bash
#
# Nightly consistent backup of the bot's embedded SQLite database.
#
# Uses SQLite's VACUUM INTO, which writes a fully consistent copy from a live
# connection — safe while the bot is running, unlike copying the file directly
# under WAL (that can capture a torn write).
#
# Installed as a cron job on the server:
#   15 2 * * * /home/ubuntu/nbkristqik/backup-db.sh >> /home/ubuntu/backups/backup.log 2>&1
#
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/nbkristqik}"
DB_URL="${LOCAL_DB_URL:-file:$APP_DIR/data/qik.db}"
OUT_DIR="${BACKUP_DIR:-/home/ubuntu/backups}"
KEEP="${BACKUP_KEEP:-7}"

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y-%m-%d)"
DEST="$OUT_DIR/qik-$STAMP.db"
TMP="$DEST.tmp"

cd "$APP_DIR"
rm -f "$TMP"

DB_URL="$DB_URL" TMP="$TMP" node --input-type=module -e '
const { createClient } = await import("@libsql/client");
const c = createClient({ url: process.env.DB_URL });
await c.execute("VACUUM INTO \u0027" + process.env.TMP + "\u0027");
console.log(new Date().toISOString(), "vacuum ->", process.env.TMP);
'

mv "$TMP" "$DEST"

# keep the newest $KEEP backups
ls -1t "$OUT_DIR"/qik-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

# off-box copy: a second copy on another VM so a lost disk is survivable.
# Failure here is reported but never fails the backup itself.
REMOTE="${BACKUP_REMOTE:-ubuntu@140.245.255.152}"
REMOTE_DIR="${BACKUP_REMOTE_DIR:-/home/ubuntu/qik-backups}"
if [ -n "$REMOTE" ] && ssh -o BatchMode=yes -o ConnectTimeout=8 "$REMOTE" "mkdir -p '$REMOTE_DIR'" 2>/dev/null; then
  if scp -q "$DEST" "$REMOTE:$REMOTE_DIR/"; then
    ssh -o BatchMode=yes -o ConnectTimeout=8 "$REMOTE" "ls -1t '$REMOTE_DIR'/qik-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f" || true
    echo "  off-box copy -> $REMOTE:$REMOTE_DIR/$(basename "$DEST")"
  else
    echo "  WARN: off-box copy failed (local backup is fine)"
  fi
else
  echo "  WARN: off-box host unreachable — backup kept locally only"
fi

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup ok: $DEST ($(du -h "$DEST" | cut -f1)), kept $(ls -1 "$OUT_DIR"/qik-*.db 2>/dev/null | wc -l)"
