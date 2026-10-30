#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME="$APP_DIR/.runtime"
NODE="$RUNTIME/node/bin/node"
NPM="$RUNTIME/node/bin/npm"
LOCK_MARKER="$RUNTIME/package-lock.sha256"

if [[ ! -x "$NODE" || ! -x "$NPM" ]]; then
  echo 'Node is not installed. Run bash scripts/setup-pi.sh first.' >&2
  exit 1
fi
export PATH="$RUNTIME/node/bin:$PATH"
cd "$APP_DIR"

# A fast-forward pull preserves local history. Ignored config.yml and data/ stay local.
# Network trouble or uncommitted tracked edits must not prevent an offline board.
GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ "$GIT_ROOT" == "$APP_DIR" ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo 'Skipping Git update because tracked files have local changes.' >&2
  elif timeout 45s env GIT_TERMINAL_PROMPT=0 git pull --ff-only --quiet; then
    echo 'Git update complete.'
  else
    echo 'Git update unavailable; starting from the existing checkout.' >&2
  fi
else
  echo 'No Git checkout found; starting from the existing files.' >&2
fi

LOCK_HASH="$(sha256sum package-lock.json | awk '{print $1}')"
INSTALLED_HASH="$(cat "$LOCK_MARKER" 2>/dev/null || true)"
if [[ ! -d node_modules || "$LOCK_HASH" != "$INSTALLED_HASH" ]]; then
  echo 'Installing locked Node packages.'
  "$NPM" ci --omit=dev --ignore-scripts --cache "$APP_DIR/.npm-cache" --prefer-offline --no-audit --no-fund
  printf '%s\n' "$LOCK_HASH" > "$LOCK_MARKER.tmp"
  mv "$LOCK_MARKER.tmp" "$LOCK_MARKER"
fi

exec "$NODE" "$APP_DIR/server/index.ts"
