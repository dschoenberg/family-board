import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { DateTime } from 'luxon';

export type CalendarConfig = { id: string; name: string; color: string; icalUrl: string };
export type Config = {
  server: { host: string; port: number };
  display: { timezone: string; photoPanelPercent: number; showSeconds: boolean };
  photos: { provider: 'google-shared-album' | 'local'; albumUrl: string; changeEverySeconds: number; refreshEveryMinutes: number; shuffle: boolean; fit: 'cover' | 'contain'; fallbackDirectory: string; maxCachedPhotos: number; maxCacheMegabytes: number };
  calendar: { weeks: number; weekStartsOn: 'sunday' | 'monday'; refreshEveryMinutes: number; showLocation: boolean; calendars: CalendarConfig[] };
  guestWifi?: { ssid: string; password: string; security: 'WPA' | 'nopass'; hidden: boolean };
  weather: { latitude: number | null; longitude: number | null; temperatureUnit: 'fahrenheit' | 'celsius'; windSpeedUnit: 'mph' | 'kmh'; forecastDays: number; refreshEveryMinutes: number };
};

export const root = resolve(import.meta.dirname, '..');
export function validateConfig(value: unknown): Config {
  const c = value as Config;
  function need(ok: unknown, field: string): asserts ok { if (!ok) throw new Error(`Invalid or missing config field: ${field}`); }
  const range = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  need(c && typeof c === 'object', 'root');
  need(['127.0.0.1', 'localhost', '::1'].includes(c.server?.host), 'server.host (loopback only)');
  need(Number.isInteger(c.server?.port) && range(c.server.port, 1024, 65535), 'server.port');
  need(typeof c.display?.timezone === 'string' && DateTime.now().setZone(c.display.timezone).isValid, 'display.timezone');
  need(range(c.display.photoPanelPercent, 20, 60), 'display.photoPanelPercent');
  need(typeof c.display.showSeconds === 'boolean', 'display.showSeconds');
  need(['google-shared-album', 'local'].includes(c.photos?.provider), 'photos.provider');
  need(typeof c.photos.albumUrl === 'string', 'photos.albumUrl');
  if (c.photos.albumUrl) {
    let valid = false;
    try { const u = new URL(c.photos.albumUrl); valid = u.protocol === 'https:' && ['photos.app.goo.gl', 'photos.google.com'].includes(u.hostname); } catch {}
    need(valid, 'photos.albumUrl');
  }
  need(range(c.photos.changeEverySeconds, 5, 86400), 'photos.changeEverySeconds');
  need(range(c.photos.refreshEveryMinutes, 1, 1440), 'photos.refreshEveryMinutes');
  need(typeof c.photos.shuffle === 'boolean' && ['cover', 'contain'].includes(c.photos.fit), 'photos.shuffle / fit');
  need(typeof c.photos.fallbackDirectory === 'string', 'photos.fallbackDirectory');
  need(Number.isInteger(c.photos.maxCachedPhotos) && range(c.photos.maxCachedPhotos, 2, 5000), 'photos.maxCachedPhotos');
  need(range(c.photos.maxCacheMegabytes, 10, 10000), 'photos.maxCacheMegabytes');
  need(Number.isInteger(c.calendar?.weeks) && range(c.calendar.weeks, 1, 6), 'calendar.weeks');
  need(['sunday', 'monday'].includes(c.calendar.weekStartsOn), 'calendar.weekStartsOn');
  need(range(c.calendar.refreshEveryMinutes, 1, 1440), 'calendar.refreshEveryMinutes');
  if (c.calendar.showLocation === undefined) c.calendar.showLocation = false;
  need(typeof c.calendar.showLocation === 'boolean', 'calendar.showLocation');
  need(Array.isArray(c.calendar.calendars), 'calendar.calendars');
  const ids = new Set<string>();
  for (const [index, cal] of c.calendar.calendars.entries()) {
    const field = `calendar.calendars[${index}]`;
    need(cal && /^[a-z0-9_-]+$/i.test(cal.id) && !ids.has(cal.id), `${field}.id (unique)`);
    ids.add(cal.id);
    need(typeof cal.name === 'string' && cal.name.trim(), `${field}.name`);
    need(/^#[0-9a-f]{6}$/i.test(cal.color), `${field}.color`);
    need(typeof cal.icalUrl === 'string', `${field}.icalUrl`);
    if (cal.icalUrl) {
      let valid = false;
      try { const u = new URL(cal.icalUrl); valid = u.protocol === 'https:' && u.hostname === 'calendar.google.com' && u.pathname.endsWith('.ics'); } catch {}
      need(valid, `${field}.icalUrl (Google HTTPS iCal feed)`);
    }
  }
  if (c.guestWifi !== undefined) {
    const wifi = c.guestWifi;
    need(wifi && typeof wifi.ssid === 'string' && Buffer.byteLength(wifi.ssid, 'utf8') <= 32, 'guestWifi.ssid');
    need(typeof wifi.password === 'string' && wifi.password.length <= 128, 'guestWifi.password');
    need(['WPA', 'nopass'].includes(wifi.security), 'guestWifi.security');
    need(typeof wifi.hidden === 'boolean', 'guestWifi.hidden');
    if (wifi.ssid && wifi.security === 'WPA') need(wifi.password.length >= 8, 'guestWifi.password');
  }
  const w = c.weather;
  need(w && (w.latitude === null && w.longitude === null || range(w.latitude, -90, 90) && range(w.longitude, -180, 180)), 'weather.latitude / longitude');
  need(['fahrenheit', 'celsius'].includes(w.temperatureUnit), 'weather.temperatureUnit');
  need(['mph', 'kmh'].includes(w.windSpeedUnit), 'weather.windSpeedUnit');
  need(Number.isInteger(w.forecastDays) && range(w.forecastDays, 1, 7), 'weather.forecastDays');
  need(range(w.refreshEveryMinutes, 1, 1440), 'weather.refreshEveryMinutes');
  return c;
}

export function loadConfig(): Config {
  const path = process.env.BOARD_CONFIG ? resolve(process.env.BOARD_CONFIG) : resolve(root, 'config.yml');
  let contents: string;
  try { contents = readFileSync(path, 'utf8'); } catch { throw new Error('Create config.yml from config.example.yml before starting.'); }
  let value: unknown;
  try { value = parse(contents); } catch { throw new Error('config.yml is not valid YAML. Check indentation and quotes.'); }
  return validateConfig(value);
}
