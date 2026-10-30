#!/usr/bin/env bash
set -euo pipefail
umask 077
APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "$(uname -s)" != Linux || "$(uname -m)" != aarch64 ]]; then
  echo 'Run this installer on 64-bit Raspberry Pi OS (ARM64), as your normal desktop user.' >&2
  exit 1
fi
if [[ "$EUID" -eq 0 ]]; then echo 'Run as your normal desktop user; the script uses sudo when needed.' >&2; exit 1; fi
if [[ "$APP_DIR" == *'"'* || "$APP_DIR" == *'%'* || "$APP_DIR" == *'\'* || "$APP_DIR" == *$'\n'* ]]; then
  echo 'Use a project directory without quote, percent, backslash, or newline characters.' >&2; exit 1
fi
if [[ ! -f "$APP_DIR/config.yml" ]]; then
  cp "$APP_DIR/config.example.yml" "$APP_DIR/config.yml"
  echo 'Created config.yml. Fill in your calendar and photo links, then rerun this script.'
  exit 0
fi
if ! command -v raspi-config >/dev/null; then echo 'This installer targets Raspberry Pi OS with a desktop.' >&2; exit 1; fi
echo 'Installing Family Board, its boot service, and full-screen Chromium autostart.'
echo 'Desktop auto-login will be enabled and screen blanking disabled for this display.'
sudo apt-get update
sudo apt-get install -y chromium curl ca-certificates xz-utils util-linux
mkdir -p "$APP_DIR/.runtime" "$APP_DIR/data"
chmod 600 "$APP_DIR/config.yml"
chmod 700 "$APP_DIR/data"

# Use the official Node 24 LTS ARM64 distribution, verified against its checksum.
RUNTIME="$APP_DIR/.runtime"
curl --fail --silent --show-error --location https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$RUNTIME/SHASUMS256.txt"
ARCHIVE="$(awk '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-arm64\.tar\.xz$/ { print $2; exit }' "$RUNTIME/SHASUMS256.txt")"
if [[ -z "$ARCHIVE" ]]; then echo 'Could not determine the Node 24 ARM64 release.' >&2; exit 1; fi
curl --fail --silent --show-error --location "https://nodejs.org/dist/latest-v24.x/$ARCHIVE" -o "$RUNTIME/$ARCHIVE"
CHECKSUM="$(awk -v file="$ARCHIVE" '$2 == file { print $1 }' "$RUNTIME/SHASUMS256.txt")"
( cd "$RUNTIME"; printf '%s  %s\n' "$CHECKSUM" "$ARCHIVE" | sha256sum --check --status )
tar -xJf "$RUNTIME/$ARCHIVE" -C "$RUNTIME"
ln -sfn "$RUNTIME/${ARCHIVE%.tar.xz}" "$RUNTIME/node"
export PATH="$RUNTIME/node/bin:$PATH"
cd "$APP_DIR"
npm ci --omit=dev --ignore-scripts --cache "$APP_DIR/.npm-cache" --no-audit --no-fund
node scripts/board-url.ts >/dev/null
chmod +x "$APP_DIR/scripts/kiosk.sh"

cat > "$RUNTIME/family-board.service" <<EOF
[Unit]
Description=Family Board local dashboard
After=network.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory="$APP_DIR"
ExecStart="$RUNTIME/node/bin/node" "$APP_DIR/server/index.ts"
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

if command -v labwc >/dev/null; then
  mkdir -p "$HOME/.config/labwc"
  AUTOSTART="$HOME/.config/labwc/autostart"
  if [[ ! -f "$AUTOSTART" && -f /etc/xdg/labwc/autostart ]]; then cp /etc/xdg/labwc/autostart "$AUTOSTART"; fi
  touch "$AUTOSTART"
  # The marked line is owned by this installer; preserve all other desktop startup entries.
  sed -i '/# family-board-kiosk$/d' "$AUTOSTART"
  printf '\n%q & # family-board-kiosk\n' "$APP_DIR/scripts/kiosk.sh" >> "$AUTOSTART"
else
  mkdir -p "$HOME/.config/autostart"
  cat > "$HOME/.config/autostart/family-board.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Family Board
Exec="$APP_DIR/scripts/kiosk.sh"
Terminal=false
X-GNOME-Autostart-enabled=true
EOF
fi
sudo raspi-config nonint do_boot_behaviour B4
sudo raspi-config nonint do_blanking 1
echo 'Installed. Reboot the Pi when ready to enter the full-screen board.'
echo 'Logs: journalctl -u family-board -f'
echo 'Restart after config changes: sudo systemctl restart family-board'
