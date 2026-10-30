#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="$APP_DIR/.runtime/node/bin/node"
if [[ ! -x "$NODE" ]]; then NODE="$(command -v node)"; fi
BOARD_URL="$("$NODE" "$APP_DIR/scripts/board-url.ts")"
CHROMIUM="$(command -v chromium || command -v chromium-browser)"
mkdir -p "$APP_DIR/data/chromium"
# A second graphical-session autostart must not launch another kiosk.
exec 9>"${XDG_RUNTIME_DIR:-$APP_DIR/data}/family-board-kiosk.lock"
flock -n 9 || exit 0
while true; do
  until curl --silent --fail --max-time 2 "$BOARD_URL/health" >/dev/null; do sleep 2; done
  "$CHROMIUM" --kiosk --no-first-run --noerrdialogs \
    --user-data-dir="$APP_DIR/data/chromium" --disk-cache-size=104857600 \
    --disable-session-crashed-bubble "$BOARD_URL" || true
  sleep 3
done
