#!/usr/bin/env bash
# Deploys the external uptime monitor to oracle2.
#
# The monitor is a single dependency-free file (dist/monitor/index.js). It is
# staged through the oracle3 relay because oracle2 is not expected to be
# reachable directly from every workstation. The host-side environment file
# (/etc/nbkristqik-uptime.env) is never copied to this workstation or printed
# by this script.
#
# After the service starts, the deploy calls /internal/health with the ingest
# secret read from that env file (remote command substitution, never echoed)
# and fails on any status other than 200, so a missing or mismatched secret
# cannot ship as a monitor that silently records nothing. The URL defaults to
# <MONITOR_BASE_URL>/internal/health; set MONITOR_PREFLIGHT_URL in the env
# file to probe a different hostname (for example the loopback address).
#
# Usage:
#   scripts/deploy-monitor.sh
#
# Overridable:
#   MONITOR_RELAY   SSH alias used to reach oracle2 (default: oracle3)
#   MONITOR_HOST    address of oracle2 as seen from the relay
#                   (default: 140.245.255.152)
#   MONITOR_DIR     install directory on oracle2 (default: /opt/nbkristqik-uptime)
#   MONITOR_SERVICE systemd unit name (default: nbkristqik-uptime)
#   MONITOR_ENV     root-only environment file (default: /etc/nbkristqik-uptime.env)
set -euo pipefail

RELAY="${MONITOR_RELAY:-oracle3}"
HOST="${MONITOR_HOST:-140.245.255.152}"
DIR="${MONITOR_DIR:-/opt/nbkristqik-uptime}"
SERVICE="${MONITOR_SERVICE:-nbkristqik-uptime}"
ENV_FILE="${MONITOR_ENV:-/etc/nbkristqik-uptime.env}"

echo "==> Checking before anything ships"
pnpm run typecheck
pnpm run typecheck:tests
pnpm run lint
pnpm exec vitest run

echo "==> Building the monitor"
pnpm build
test -f dist/monitor/index.js

echo "==> Staging through $RELAY"
scp -q dist/monitor/index.js "$RELAY:/tmp/nbkristqik-monitor.mjs"
scp -q scripts/nbkristqik-uptime.service "$RELAY:/tmp/nbkristqik-uptime.service"
ssh "$RELAY" "scp -q /tmp/nbkristqik-monitor.mjs /tmp/nbkristqik-uptime.service ubuntu@$HOST:/tmp/"

echo "==> Installing on $HOST"
REMOTE_SCRIPT="$(mktemp)"
trap 'rm -f "$REMOTE_SCRIPT"' EXIT
cat >"$REMOTE_SCRIPT" <<'REMOTE'
set -euo pipefail
DIR="__DIR__"
SERVICE="__SERVICE__"
ENV_FILE="__ENV_FILE__"

if ! id -u qik-uptime >/dev/null 2>&1; then
  sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin qik-uptime
fi

if ! sudo test -f "$ENV_FILE"; then
  echo "missing $ENV_FILE on the monitor host" >&2
  echo "create it root-owned 0600 with UPTIME_INGEST_SECRET, MONITOR_TELEGRAM_BOT_TOKEN and ADMIN_ID" >&2
  exit 1
fi

env_meta="$(sudo stat -c '%a %U:%G' "$ENV_FILE")"
if [ "$env_meta" != "600 root:root" ]; then
  echo "$ENV_FILE must be 600 root:root (found $env_meta)" >&2
  exit 1
fi

for key in UPTIME_INGEST_SECRET MONITOR_TELEGRAM_BOT_TOKEN ADMIN_ID; do
  if ! sudo grep -q "^${key}=." "$ENV_FILE"; then
    echo "$ENV_FILE is missing $key" >&2
    exit 1
  fi
done

secret_len="$(sudo awk -F= '$1 == "UPTIME_INGEST_SECRET" { print length($2) }' "$ENV_FILE")"
if [ "${secret_len:-0}" -lt 32 ]; then
  echo "UPTIME_INGEST_SECRET in $ENV_FILE is shorter than 32 characters" >&2
  exit 1
fi

# Preflight BEFORE installing/restarting: a bad secret or unreachable API must
# leave the old monitor running, not replace it with one that will alert wrongly.
preflight_url="$(sudo awk -F= '$1 == "MONITOR_PREFLIGHT_URL" { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE")"
if [ -z "$preflight_url" ]; then
  base_url="$(sudo awk -F= '$1 == "MONITOR_BASE_URL" { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE")"
  base_url="${base_url%/}"
  preflight_url="${base_url:-https://checker.tobioffice.dev}/internal/health"
fi
preflight_secret="$(sudo awk -F= '$1 == "UPTIME_INGEST_SECRET" { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE")"
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required on this host for the /internal/health preflight" >&2
  exit 1
fi
# Feed the Authorization header through stdin (-K -) so the secret never
# appears in curl's argv or in any process listing on the monitor host.
preflight_code="$(printf 'header = "Authorization: Bearer %s"\n' "$preflight_secret" |
  curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -K - "$preflight_url" 2>/dev/null || true)"
unset preflight_secret
if [ "$preflight_code" != "200" ]; then
  echo "$preflight_url returned HTTP ${preflight_code:-no response} with the ingest secret" >&2
  echo "check that UPTIME_INGEST_SECRET in $ENV_FILE is at least 32 characters and matches the API host" >&2
  echo "the existing monitor was left running" >&2
  exit 1
fi
echo "==> Deep-health preflight OK ($preflight_url)"

# Keep the previous monitor binary/unit until the new one has completed a
# cycle. Any failure after this point restores and restarts the old service.
RESTORE_PREV=0
restore_previous_monitor() {
  if [ "${RESTORE_PREV:-0}" = "1" ] && sudo test -f "$DIR/monitor.mjs.prev"; then
    echo "restoring the previous monitor after a failed start" >&2
    sudo install -m 0644 "$DIR/monitor.mjs.prev" "$DIR/monitor.mjs"
    if sudo test -f "/etc/systemd/system/$SERVICE.service.prev"; then
      sudo install -m 0644 "/etc/systemd/system/$SERVICE.service.prev" \
        "/etc/systemd/system/$SERVICE.service"
      sudo systemctl daemon-reload >/dev/null 2>&1 || true
    fi
    sudo systemctl restart "$SERVICE" >/dev/null 2>&1 || true
  fi
}
trap restore_previous_monitor EXIT

sudo install -d -m 0755 -o root -g root "$DIR"
if sudo test -f "$DIR/monitor.mjs"; then
  sudo cp -a "$DIR/monitor.mjs" "$DIR/monitor.mjs.prev"
fi
if sudo test -f "/etc/systemd/system/$SERVICE.service"; then
  sudo cp -a "/etc/systemd/system/$SERVICE.service" \
    "/etc/systemd/system/$SERVICE.service.prev"
fi
sudo install -m 0644 /tmp/nbkristqik-monitor.mjs "$DIR/monitor.mjs"
sudo install -m 0644 /tmp/nbkristqik-uptime.service "/etc/systemd/system/$SERVICE.service"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE" >/dev/null
RESTORE_PREV=1
START_TS="$(date '+%Y-%m-%d %H:%M:%S')"
sudo systemctl restart "$SERVICE"
sleep 2
systemctl is-active "$SERVICE"
MAIN_PID="$(systemctl show -p MainPID --value "$SERVICE")"
if [ -z "$MAIN_PID" ] || [ "$MAIN_PID" = "0" ]; then
  echo "the monitor has no main process after restart" >&2
  exit 1
fi

for _ in $(seq 1 24); do
  if sudo journalctl _PID="$MAIN_PID" --since "$START_TS" --no-pager 2>/dev/null | grep -qE '\[cycle\] .*='; then
    break
  fi
  sleep 5
done

logs="$(sudo journalctl _PID="$MAIN_PID" --since "$START_TS" --no-pager 2>/dev/null || true)"
if ! printf '%s\n' "$logs" | grep -qE '\[cycle\] .*='; then
  echo "the monitor did not complete a cycle; last log lines:" >&2
  sudo journalctl -u "$SERVICE" -n 30 --no-pager >&2
  exit 1
fi

if printf '%s\n' "$logs" | grep -qE '\[ingest\] write failed|\[spool\] replay failed|\[probe\] deep health failed|\[alert\] .*not delivered|Telegram .* (returned HTTP|request failed)'; then
  echo "the monitor completed a cycle but its ingest or alert channel is failing:" >&2
  printf '%s\n' "$logs" >&2
  exit 1
fi

printf '%s\n' "$logs" | tail -20
# The new monitor completed a cycle and its ingest/alert checks passed.
RESTORE_PREV=0
sudo rm -f "$DIR/monitor.mjs.prev" "/etc/systemd/system/$SERVICE.service.prev"
REMOTE

sed -i \
  -e "s|__DIR__|$DIR|g" \
  -e "s|__SERVICE__|$SERVICE|g" \
  -e "s|__ENV_FILE__|$ENV_FILE|g" \
  "$REMOTE_SCRIPT"

ssh "$RELAY" "ssh ubuntu@$HOST bash -s" <"$REMOTE_SCRIPT"

ssh "$RELAY" "rm -f /tmp/nbkristqik-monitor.mjs /tmp/nbkristqik-uptime.service; ssh ubuntu@$HOST 'rm -f /tmp/nbkristqik-monitor.mjs /tmp/nbkristqik-uptime.service'"

echo "==> Monitor deployed."
