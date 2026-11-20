#!/usr/bin/env bash
# Builds the native PDF stamp used by the library download path.
#
# The binary is built here, not on the production box: the server has no Rust
# toolchain and very little RAM. `scripts/deploy.sh` ships the result in
# `bin/pdfstamp` alongside `dist/`.
#
# If cargo is absent, an existing bin/pdfstamp is kept. That is deliberate:
# a machine that only runs the tests or edits TypeScript can use the last
# built binary, while a clean checkout without a compiler fails loudly.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT/bin/pdfstamp"
CRATE="$ROOT/native/pdfstamp"

if command -v cargo >/dev/null 2>&1; then
  echo "==> Building pdfstamp ($CRATE)"
  cargo build --release --locked --manifest-path "$CRATE/Cargo.toml"
  mkdir -p "$ROOT/bin"
  cp "$CRATE/target/release/pdfstamp" "$BIN"
  chmod 755 "$BIN"
  echo "    $("$BIN" --version) -> $BIN"
  exit 0
fi

if [ -x "$BIN" ]; then
  echo "WARNING: cargo is not installed; keeping the existing $BIN" >&2
  echo "         install Rust 1.88+ to rebuild it from native/pdfstamp" >&2
  exit 0
fi

cat >&2 <<'MSG'
ERROR: cargo is not installed and bin/pdfstamp does not exist.
       The library PDF download path needs the native stamp.

       Install Rust (https://rustup.rs), then run:

           scripts/build-pdfstamp.sh
MSG
exit 1
