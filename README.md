# Family Board

A local dashboard for a Raspberry Pi and monitor: photo slideshow, clock/date, weather, and a family calendar. The server and all private data stay on the device.

## Run on your computer

Use **Node.js 24 LTS, version 24.11 or newer**, or **Node.js 22.18 or newer**. With nvm: `nvm install 24 && nvm use 24`.

```sh
npm ci
# For a new checkout only: cp config.example.yml config.yml
npm start
```

Open **http://localhost:3000**. There is no frontend build step. Supported Node 22 and 24 releases run the server's TypeScript directly. `npm run dev` restarts the server after server code edits; refresh the browser after frontend edits.

Keep calendar feeds and photo album links in a private `config.yml`. That file, `data/`, and local photos are ignored by Git. Copy your private config to the Pi separately from the public repository. No cloud hosting is needed. The Pi's automatic update only sees commits pushed to GitHub.

## Configure

Edit `config.yml`, then restart the server. On the Pi: `sudo systemctl restart family-board`.

Each entry under `calendar.calendars` has a unique `id`, a display `name`, a six-digit hex `color`, and an `icalUrl`. Add further entries in the same format. In Google Calendar, get **Settings → your calendar → Integrate calendar → Secret address in iCal format**. Ordinary calendar page URLs do not work. An empty link disables that calendar's data and shows its configuration status.

Event locations are hidden by default. Set `calendar.showLocation: true` in `config.yml` if you want them shown beneath event titles and in hover text.

The example config uses **America/Chicago**, a Sunday-start calendar, up to three weeks, and a 38% photo panel. All-day end dates are exclusive; recurring events, exclusions, moved/canceled occurrences, overnight events, and daylight-saving changes are handled by the calendar reader. Calendar weeks grow to fit their events and titles, including locations when enabled, within the available screen height. The board shows three weeks when they fit, otherwise two or one. If even one week is too tall, scroll the calendar area with a mouse, touchpad, touchscreen, or keyboard.

Set `weather.latitude` and `weather.longitude` in your private config to enable current conditions, wind, sunrise and sunset, and a four-day forecast from Open-Meteo. The current moon phase and illuminated percentage are calculated locally with SunCalc. Degrees Fahrenheit and mph are the defaults. Both coordinates must be set together. No API key is needed for this personal-use forecast endpoint.

Weather data: [Open-Meteo](https://open-meteo.com/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The board formats the supplied data for display.

### Guest Wi-Fi QR code

The lower-right calendar area can display a QR code that lets guests join your Wi-Fi. In the private `config.yml`, set `guestWifi.ssid` and `guestWifi.password`; use `security: WPA` for WPA2/WPA3 Personal or `security: nopass` for an open network. Set `hidden: true` only if the SSID is hidden. Leave `ssid` empty to hide the QR code. Restart the server after changing these settings. The QR code is generated locally and includes the Wi-Fi password in scannable form; anyone who can see it can join the guest network. The password is not included in `/api/board` or committed to Git.

Shared calendar invitations appear once per day when their iCalendar UID and occurrence start match across configured calendars. The event displays a colored dot for each calendar it belongs to, and the hover text lists those calendar names. Distinct invitations with the same title stay separate. When copies have different details, the first calendar in configuration order supplies the displayed title and primary color; a later copy can fill a missing location.

### Photos

`photos.albumUrl` is a Google Photos **share link**. The reader accesses the album's shared web page directly; it does not use a third-party relay. It supports pagination through large albums. This is an unofficial integration and may need repair if Google changes its shared-page format. It requires the album to remain accessible through the link.

The board shuffles the full photo list, changes photos every 60 seconds, and refreshes the album list every 30 minutes. Images are downloaded on demand at display size, with the next image preloaded. Videos are omitted. `fit: contain` scales each photo to show the full image while preserving its aspect ratio; unused space in the panel remains dark. Set `fit: cover` if you prefer the panel filled with cropping.

A small caption shows each Google album photo's date when the shared album supplies one. Google exposes this as an image update timestamp, so it may differ from the original capture date if the photo was edited. Local images and older cached album manifests may have no date; the caption remains hidden until dated album metadata is available.

The disk image cache is limited to **150 photos / 400 MiB** by default, evicting the least recently used files. It is a display cache, not a backup. On a network failure, the display retains the current photo and uses downloaded photos after restarting. Full offline slideshow coverage grows as photos are viewed. A refresh has a 120-second timeout by default. Set `photos.refreshTimeoutSeconds` in the private config to change it; existing configs without the setting use 120 seconds.

For a fully local slideshow, set `photos.provider: local` and add JPG, PNG, WebP, or GIF files to `photos/`. That directory is also the fallback when no Google album photos are available. Files are read directly, so their original storage is outside the remote-image cache limit. Individual local images must be under 20 MiB.

### Privacy and cache

Only the rendered calendar details, calendar names/colors, weather, and local photo paths are returned to the browser. Feed URLs, album URLs, configuration, raw ICS feeds, and the remote photo manifest are not served. The server binds to loopback only and does not enable CORS. No analytics, external fonts, or external scripts are loaded.

Cached event data and photos are stored privately under `data/`. Failed refreshes keep the last successful response and show a small status message. A successful refresh replaces old feed data. Cache files are not encrypted; use appropriate device/storage access controls for a shared computer. Old source caches can remain after removing a calendar, so stop the server and remove `data/` if you want to clear all cached private data.

## Install on Raspberry Pi 4/5

Target: **64-bit Raspberry Pi OS with a desktop**, HDMI monitor, network access, and a normal user with sudo access. The installer is intended for Pi 4/5; confirm the actual model and screen resolution before deployment. Run these commands on the Pi, not on your Mac.

1. Install Git and clone the public repository:

   ```sh
   sudo apt-get update
   sudo apt-get install -y git
   git clone https://github.com/dschoenberg/family-board.git ~/family-board
   cd ~/family-board
   ```

2. Create the private config. Copy your existing `config.yml` to `~/family-board/config.yml` through a private transfer, or start from the example and fill in your calendar, photo, weather, and guest Wi-Fi settings. Never add `config.yml` to Git.

   ```sh
   test -e config.yml || cp config.example.yml config.yml
   chmod 600 config.yml
   nano config.yml
   ```

3. Install Node, Chromium, packages, and the boot service by running the installer. **You do not need to install Node separately**: this script downloads the official Node 24 ARM64 archive, checks its SHA-256 checksum, and installs it under `.runtime/node` without replacing the system's Node. It also installs Chromium through `apt`.

   ```sh
   bash scripts/setup-pi.sh
   .runtime/node/bin/node --version
   sudo reboot
   ```

The installer enables the `family-board` systemd service, adds the kiosk launcher to desktop startup, enables desktop auto-login, and disables screen blanking. It preserves unrelated labwc startup entries and can be rerun. Keep the checkout in the same directory after installation; rerun the installer if you move it or update the service definition.

At each boot, systemd waits for network startup, then `scripts/start-pi.sh` attempts a **fast-forward-only** Git pull. It retries briefly if Wi-Fi or DNS is not ready yet. If the network remains unavailable or tracked files have local edits, the board starts from the existing checkout. When `package-lock.json` has changed, the script runs `npm ci` with the local npm cache before starting the server. A failed package installation stops the service so systemd can retry; the private config and cached data are not reset. The kiosk waits for the local server before opening Chromium and restarts Chromium if it exits. Chromium uses its normal browser sandbox and a separate profile under `data/chromium`.

If a photo album refresh fails, the board keeps downloaded photos visible and retries after 2 minutes, then 5, 15, and 30 minutes on continued failure (capped by the configured refresh interval). A successful refresh restores the normal interval. The service log reports refresh duration and photo count without logging album or image URLs.

Configure monitor orientation/resolution in Raspberry Pi OS. The board uses the available screen dimensions. Landscape most closely matches the reference; a narrow browser window stacks the photo panel above the calendar for previewing on smaller screens.

```sh
# Logs / status
journalctl -u family-board -b -f
systemctl status family-board

# Pull any new commit, install changed packages, and restart after config changes
sudo systemctl restart family-board

# Confirm the installed Node version
.runtime/node/bin/node --version
```

To temporarily leave kiosk mode, stop the launcher process (`pkill -f '[s]cripts/kiosk.sh'`) and close Chromium. To disable boot startup, disable the service (`sudo systemctl disable --now family-board`) and remove its marked entry from `~/.config/labwc/autostart`, or remove `~/.config/autostart/family-board.desktop` on an X11 desktop. Existing desktop settings can be restored through Raspberry Pi Configuration.

## Install on an original Pi Zero W

Use `scripts/setup-pi-zero.sh` on a **32-bit ARMv6 Pi Zero or Zero W with Raspberry Pi OS Desktop and Chromium already installed**. This is a separate installer; the Pi 4/5 installer above keeps its 64-bit Node 24 setup. The Zero installer reuses your existing Chromium, installs a pinned community-built Node 22 ARMv6 binary under `.runtime/node` after checking its published SHA-256 checksum, and adds the kiosk launcher to the LXDE user autostart file. On Buster, it also installs the matching GCC 12 C++ runtime under `.runtime/lib` with a pinned checksum. A local Node launcher loads this private library without changing the system libraries or Chromium. ARMv6 Node builds are [unofficial and minimally tested](https://unofficial-builds.nodejs.org/); verify the board on the actual device.

On Buster, use the ARMv6-compatible Chromium 92 package. Chromium 74 cannot parse the board's JavaScript. Check with `chromium-browser --version`; if needed, run `sudo apt update` and `sudo apt install --only-upgrade chromium-browser chromium-browser-l10n rpi-chromium-mods`. The page uses a browser-compatible request timeout and allows up to 60 seconds for the first board response on this slower device.

On the Zero W, clone the repository and create the private config as in steps 1–2 above. Check that `curl`, `git`, `tar`, `xz`, `sha256sum`, `flock`, and `timeout` are installed. Then run:

```sh
cd ~/family-board
bash scripts/setup-pi-zero.sh
.runtime/node/bin/node --version
systemctl status family-board
curl -fsS http://localhost:3000/health
sudo reboot
```

The script enables desktop auto-login and attempts to disable screen blanking. It preserves existing LXDE autostart lines and adds the Family Board launcher once. The Pi Zero service waits 120 seconds before attempting its Git pull and starting the server, giving Wi-Fi and DNS time to settle; the kiosk opens after the server responds. Rerun `bash scripts/setup-pi-zero.sh` after updating the installer to apply service changes. After reboot, check `journalctl -u family-board -b -n 80` if the board does not appear. With only 512 MB of RAM and a single-core CPU, startup and photo changes may be slow; test the server and kiosk together before treating the installation as complete. To disable the kiosk later, comment out the `@.../scripts/kiosk.sh` line in `~/.config/lxsession/LXDE-pi/autostart` and run `sudo systemctl disable --now family-board` to stop the server at boot.

## Verification

```sh
npm run check          # TypeScript checks (development dependencies required)
npm test               # Calendar behavior and offline cache tests
npm run check:sources  # Live feed/album checks; reports counts, not private contents
```

The source check downloads one sample photo and reads each configured feed. Tests cover all-day boundaries, daylight-saving recurrence, moved and canceled events, overnight events, week starts, config validation, calendar cache recovery, and photo cache eviction. The app has been previewed locally at 1920×1080. Pi boot, kiosk restart, and long-running hardware behavior still need verification on the actual device.
