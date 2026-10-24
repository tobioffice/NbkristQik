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

echo "==> Checking before anything ships"
# A green build is not a green product. The attendance table once shipped
# missing because the tests of the day had been rewritten to match it, and
# a build-only deploy cannot notice that. These checks run first; set -e
# stops the deploy on the first red test.
pnpm run typecheck
pnpm run lint
pnpm exec vitest run
(cd src/web && pnpm exec vitest run)

echo "==> Building locally"
pnpm build

echo "==> Building the library web app"
(cd src/web && pnpm install --frozen-lockfile && pnpm run build:library)

echo "==> Syncing dist/ + manifest to $HOST:$DIR"
ssh "$HOST" "mkdir -p '$DIR'"
rsync -az --delete dist/ "$HOST:$DIR/dist/"
rsync -az package.json pnpm-lock.yaml "$HOST:$DIR/"

echo "==> Syncing the library bundle and the syllabus catalogue"
ssh "$HOST" "mkdir -p '$DIR/public/library' '$DIR/data'"
rsync -az --delete src/web/dist-library/ "$HOST:$DIR/public/library/"
rsync -az data/syllabus-catalog.json "$HOST:$DIR/data/syllabus-catalog.json"

echo "==> Installing production dependencies on server"
ssh "$HOST" "cd '$DIR' && export PATH=\$HOME/.local/bin:\$PATH &&
  command -v pnpm >/dev/null 2>&1 || { export NPM_CONFIG_PREFIX=\$HOME/.local; npm install -g pnpm@10; } &&
  pnpm install --prod --frozen-lockfile"

echo "==> Restarting systemd service '$SERVICE'"
ssh "$HOST" "sudo systemctl restart '$SERVICE' && sleep 2 && systemctl is-active '$SERVICE'"

echo "==> Deployed."