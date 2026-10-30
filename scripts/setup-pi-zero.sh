#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "$(uname -s)" != Linux || "$(uname -m)" != armv6l ]]; then
  echo 'Run this installer on an original Raspberry Pi Zero or Zero W (ARMv6), as your normal desktop user.' >&2
  exit 1
fi
if [[ "$EUID" -eq 0 ]]; then echo 'Run as your normal desktop user; the script uses sudo when needed.' >&2; exit 1; fi
if [[ "$APP_DIR" == *[[:space:]]* || "$APP_DIR" == *'"'* || "$APP_DIR" == *'%'* || "$APP_DIR" == *'\'* ]]; then
  echo 'Use a project directory without whitespace, quotes, percent signs, or backslashes.' >&2; exit 1
fi
if [[ ! -f "$APP_DIR/config.yml" ]]; then
  cp "$APP_DIR/config.example.yml" "$APP_DIR/config.yml"
  echo 'Created config.yml. Fill in your private links and settings, then rerun this script.'
  exit 0
fi
if ! command -v raspi-config >/dev/null; then echo 'This installer requires Raspberry Pi OS with a desktop.' >&2; exit 1; fi
if ! command -v chromium-browser >/dev/null && ! command -v chromium >/dev/null; then
  echo 'Chromium is not installed. Install it through Raspberry Pi OS before running this script.' >&2
  exit 1
fi
for required in curl git tar xz sha256sum flock timeout; do
  if ! command -v "$required" >/dev/null; then
    echo "Missing required command: $required. Install it through Raspberry Pi OS, then rerun this script." >&2
    exit 1
  fi
done
if [[ "$(git -C "$APP_DIR" rev-parse --show-toplevel 2>/dev/null || true)" != "$APP_DIR" ]]; then
  echo 'Clone the Git repository onto the Pi before running this installer.' >&2
  exit 1
fi

echo 'Installing Family Board for Pi Zero W with the existing Chromium browser.'
mkdir -p "$APP_DIR/.runtime" "$APP_DIR/data"
chmod 600 "$APP_DIR/config.yml"
chmod 700 "$APP_DIR/data"

# ARMv6 is not supplied by the official Node.js releases. Pin a published build URL
# and verify the archive against the checksum published by the build project.
RUNTIME="$APP_DIR/.runtime"
NODE_VERSION=22.23.4
BASE_URL="https://unofficial-builds.nodejs.org/download/release/v$NODE_VERSION"
ARCHIVE="node-v$NODE_VERSION-linux-armv6l.tar.xz"
curl --fail --silent --show-error --location "$BASE_URL/SHASUMS256.txt" -o "$RUNTIME/SHASUMS256.txt"
if ! awk -v file="$ARCHIVE" '$2 == file { found = 1 } END { exit !found }' "$RUNTIME/SHASUMS256.txt"; then
  echo "The ARMv6 archive is missing from $BASE_URL." >&2
  exit 1
fi
CHECKSUM="$(awk -v file="$ARCHIVE" '$2 == file { print $1 }' "$RUNTIME/SHASUMS256.txt")"
if [[ ! -f "$RUNTIME/$ARCHIVE" ]] || ! printf '%s  %s\n' "$CHECKSUM" "$RUNTIME/$ARCHIVE" | sha256sum --check --status; then
  curl --fail --silent --show-error --location "$BASE_URL/$ARCHIVE" -o "$RUNTIME/$ARCHIVE.tmp"
  printf '%s  %s\n' "$CHECKSUM" "$RUNTIME/$ARCHIVE.tmp" | sha256sum --check --status
  mv "$RUNTIME/$ARCHIVE.tmp" "$RUNTIME/$ARCHIVE"
fi
tar -xJf "$RUNTIME/$ARCHIVE" -C "$RUNTIME"
NODE_DIR="$RUNTIME/${ARCHIVE%.tar.xz}"

# This ARMv6 Node build uses GCC 12's libstdc++, while Buster has an older one.
# Keep the matching library private to Family Board; the wrapper loads it for
# Node only, so Chromium and the rest of the OS continue using system libraries.
LIB_DIR="$RUNTIME/lib"
LIB_FILE="$LIB_DIR/libstdc++.so.6.0.30"
LIB_SHA256=3e2215edeed04268a02edde9fde9657cb6a462452694c07292acb37c5da4972b
LIB_URL='https://raw.githubusercontent.com/rvagg/rpi-newer-crosstools/92391f65e888eb462ba84c032fa11b597963cdb6/x64-gcc-12.3.0-glibc-2.28/arm-rpi-linux-gnueabihf/arm-rpi-linux-gnueabihf/sysroot/lib/libstdc++.so.6.0.30'
mkdir -p "$LIB_DIR"
if [[ ! -f "$LIB_FILE" ]] || ! printf '%s  %s\n' "$LIB_SHA256" "$LIB_FILE" | sha256sum --check --status; then
  curl --fail --silent --show-error --location "$LIB_URL" -o "$LIB_FILE.tmp"
  printf '%s  %s\n' "$LIB_SHA256" "$LIB_FILE.tmp" | sha256sum --check --status
  mv "$LIB_FILE.tmp" "$LIB_FILE"
fi
ln -sfn libstdc++.so.6.0.30 "$LIB_DIR/libstdc++.so.6"
mv "$NODE_DIR/bin/node" "$NODE_DIR/bin/node.real"
cat > "$NODE_DIR/bin/node" <<'EOF'
#!/bin/sh
BIN_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
RUNTIME_DIR="$(cd "$BIN_DIR/../.." && pwd -P)"
export LD_LIBRARY_PATH="$RUNTIME_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$BIN_DIR/node.real" "$@"
EOF
chmod 755 "$NODE_DIR/bin/node"
ln -sfn "$NODE_DIR" "$RUNTIME/node"
export PATH="$RUNTIME/node/bin:$PATH"
node --version
cd "$APP_DIR"
npm ci --omit=dev --ignore-scripts --cache "$APP_DIR/.npm-cache" --no-audit --no-fund
sha256sum "$APP_DIR/package-lock.json" | awk '{print $1}' > "$RUNTIME/package-lock.sha256"
node scripts/board-url.ts >/dev/null
chmod +x "$APP_DIR/scripts/kiosk.sh" "$APP_DIR/scripts/start-pi.sh"

cat > "$RUNTIME/family-board.service" <<EOF
[Unit]
Description=Family Board local dashboard
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/scripts/start-pi.sh
Environment=NODE_ENV=production
Restart=always
RestartSec=5
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
sudo install -m 644 "$RUNTIME/family-board.service" /etc/systemd/system/family-board.service
sudo systemctl daemon-reload
sudo systemctl enable family-board.service
sudo systemctl restart family-board.service

# An LXDE user autostart file overrides the system one. Copy the system defaults
# if this is the first user entry, then add only our launcher.
AUTOSTART="$HOME/.config/lxsession/LXDE-pi/autostart"
mkdir -p "$(dirname "$AUTOSTART")"
if [[ ! -f "$AUTOSTART" ]]; then
  if [[ -f /etc/xdg/lxsession/LXDE-pi/autostart ]]; then
    cp /etc/xdg/lxsession/LXDE-pi/autostart "$AUTOSTART"
  else
    touch "$AUTOSTART"
  fi
fi
KIOSK_ENTRY="@$APP_DIR/scripts/kiosk.sh"
if ! grep -Fqx -- "$KIOSK_ENTRY" "$AUTOSTART"; then
  printf '\n# Family Board kiosk\n%s\n' "$KIOSK_ENTRY" >> "$AUTOSTART"
fi
sudo raspi-config nonint do_boot_behaviour B4
if ! sudo raspi-config nonint do_blanking 1; then
  echo 'Could not disable screen blanking automatically; change it in Raspberry Pi Configuration.' >&2
fi
echo 'Installed. Reboot the Pi when ready to enter the full-screen board.'
echo 'Logs: journalctl -u family-board -f'
