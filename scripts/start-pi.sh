#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME="$APP_DIR/.runtime"
NODE="$RUNTIME/node/bin/node"
NPM="$RUNTIME/node/bin/npm"
LOCK_MARKER="$RUNTIME/package-lock.sha256"

if [[ ! -x "$NODE" || ! -x "$NPM" ]]; then
  echo 'Node is not installed. Run the setup script for your Pi model first.' >&2
  exit 1
fi
export PATH="$RUNTIME/node/bin:$PATH"
cd "$APP_DIR"

# The Pi Zero service waits for Wi-Fi and DNS to settle before any network work.
# Other installations leave this unset and start immediately.
BOOT_DELAY="${BOARD_BOOT_DELAY_SECONDS:-0}"
if [[ ! "$BOOT_DELAY" =~ ^[0-9]+$ ]]; then
  echo 'BOARD_BOOT_DELAY_SECONDS must be a nonnegative number of seconds.' >&2
  exit 1
fi
if [[ "$BOOT_DELAY" != 0 ]]; then
  echo "Waiting ${BOOT_DELAY}s before the Git update and server startup."
  sleep "$BOOT_DELAY"
fi

# A fast-forward pull preserves local history. Ignored config.yml and data/ stay local.
# Network trouble or uncommitted tracked edits must not prevent an offline board.
GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ "$GIT_ROOT" == "$APP_DIR" ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo 'Skipping Git update because tracked files have local changes.' >&2
  else
    # Wi-Fi and DNS can become usable shortly after network-online.target.
    # Keep the retries bounded so an offline board still starts.
    for attempt in 1 2 3 4; do
      if timeout 10s env GIT_TERMINAL_PROMPT=0 git pull --ff-only --quiet; then
        echo 'Git update complete.'
        break
      fi
      if [[ "$attempt" -eq 4 ]]; then
        echo 'Git update unavailable after four attempts; starting from the existing checkout.' >&2
      else
        echo "Git update unavailable (attempt $attempt of 4); retrying shortly." >&2
        sleep 5
      fi
    done
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
