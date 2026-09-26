#!/usr/bin/env bash
# Deploys NbkristQik to the production server.
#
# The server has very little RAM, so everything that needs memory happens
# here: the TypeScript build runs locally and only dist/ is shipped.
# The bot runs as the systemd service "nbkristqik".
#
# Usage: scripts/deploy.sh
# Requires: ssh access to $HOST (the "oracle3" ssh alias), rsync, and
#           pnpm on the server (auto-installed to ~/.local if missing).
set -euo pipefail

HOST="${DEPLOY_HOST:-oracle3}"
DIR="${DEPLOY_DIR:-/home/ubuntu/nbkristqik}"
SERVICE="${DEPLOY_SERVICE:-nbkristqik}"

echo "==> Building locally"
pnpm build

echo "==> Syncing dist/ + manifest to $HOST:$DIR"
ssh "$HOST" "mkdir -p '$DIR'"
rsync -az --delete dist/ "$HOST:$DIR/dist/"
rsync -az package.json pnpm-lock.yaml "$HOST:$DIR/"

echo "==> Installing production dependencies on server"
ssh "$HOST" "cd '$DIR' && export PATH=\$HOME/.local/bin:\$PATH &&
  command -v pnpm >/dev/null 2>&1 || { export NPM_CONFIG_PREFIX=\$HOME/.local; npm install -g pnpm@10; } &&
  pnpm install --prod --frozen-lockfile"

echo "==> Restarting systemd service '$SERVICE'"
ssh "$HOST" "sudo systemctl restart '$SERVICE' && sleep 2 && systemctl is-active '$SERVICE'"

echo "==> Deployed."