#!/usr/bin/env bash
#
# Nightly consistent backup of the bot's embedded SQLite database.
#
# Uses SQLite's VACUUM INTO, which writes a fully consistent copy from a live
# connection — safe while the bot is running, unlike copying the file directly
# under WAL (that can capture a torn write). The copy is then verified with
# PRAGMA integrity_check before it replaces the previous backup.
#
# The off-box copy is part of the backup contract: if the remote host is
# unreachable the script exits non-zero (cron mails the log) but keeps the
# verified local backup intact.
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
# a failed vacuum/integrity check must not leave a half-written .tmp behind
trap 'rm -f "$TMP"' ERR

DB_URL="$DB_URL" TMP="$TMP" node --input-type=module -e '
const { createClient } = await import("@libsql/client");
const c = createClient({ url: process.env.DB_URL });
await c.execute("VACUUM INTO \u0027" + process.env.TMP + "\u0027");
await c.close();

// verify the copy, not the live database: this is what a restore would open
const copy = createClient({ url: "file:" + process.env.TMP });
const check = await copy.execute("PRAGMA integrity_check");
const value = check.rows[0] ? Object.values(check.rows[0])[0] : null;
await copy.close();
if (value !== "ok") {
  console.error(
    new Date().toISOString(),
    "INTEGRITY CHECK FAILED on",
    process.env.TMP,
    "->",
    JSON.stringify(check.rows.slice(0, 5)),
  );
  process.exit(1);
}
console.log(new Date().toISOString(), "vacuum + integrity ok ->", process.env.TMP);
'

mv "$TMP" "$DEST"

# keep the newest $KEEP backups
ls -1t "$OUT_DIR"/qik-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

# off-box copy: a second copy on another VM so a lost disk is survivable.
# The local backup stays in place whatever happens below; a failure exits
# non-zero so cron cannot mistake a local-only night for a successful backup.
REMOTE="${BACKUP_REMOTE-ubuntu@140.245.255.152}"
REMOTE_DIR="${BACKUP_REMOTE_DIR:-/home/ubuntu/qik-backups}"
offbox_failed=0
if [ -z "$REMOTE" ]; then
  offbox_failed=1
  echo "  ERROR: BACKUP_REMOTE is empty — no off-box copy was attempted" >&2
elif ! ssh -o BatchMode=yes -o ConnectTimeout=8 "$REMOTE" "mkdir -p '$REMOTE_DIR'" 2>/dev/null; then
  offbox_failed=1
  echo "  ERROR: off-box host unreachable ($REMOTE)" >&2
elif ! scp -q "$DEST" "$REMOTE:$REMOTE_DIR/"; then
  offbox_failed=1
  echo "  ERROR: off-box copy failed ($DEST -> $REMOTE:$REMOTE_DIR/)" >&2
else
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$REMOTE" "ls -1t '$REMOTE_DIR'/qik-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f" || true
  echo "  off-box copy -> $REMOTE:$REMOTE_DIR/$(basename "$DEST")"
fi

if [ "$offbox_failed" -ne 0 ]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) BACKUP INCOMPLETE: verified local backup kept at $DEST ($(du -h "$DEST" | cut -f1)), but the off-box copy failed" >&2
  exit 1
fi

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup ok: $DEST ($(du -h "$DEST" | cut -f1)), kept $(ls -1 "$OUT_DIR"/qik-*.db 2>/dev/null | wc -l), off-box ok"
