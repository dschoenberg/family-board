import { join } from 'node:path';
import { DateTime } from 'luxon';
import { getMoonIllumination } from 'suncalc';
import type { CalendarResponse } from 'node-ical';
import { root } from './config.ts';
import type { Config, CalendarConfig } from './config.ts';
import { atomicWrite, hash, limitedBody, readJson } from './io.ts';
import { getCalendar, parseCalendar, calendarDays } from './calendar.ts';
import { PhotoStore } from './photos.ts';

type Status = { state: string; updatedAt: string | null; message: string };
type Weather = {
  current: { temperature: number; code: number; windSpeed: number; windDirection: number; isDay: boolean };
  days: { date: string; code: number; high: number; low: number; sunrise: string; sunset: string }[];
};
export class Sources {
  config: Config;
  dataDirectory: string;
  photos: PhotoStore;
  feeds = new Map<string, CalendarResponse>();
  statuses = new Map<string, Status>();
  weather: Weather | null = null;
  weatherStatus: Status = { state: 'unconfigured', updatedAt: null, message: 'Set your weather location in config.yml' };
  timers = new Set<ReturnType<typeof setTimeout>>();
  stopped = false;
  constructor(config: Config, dataDirectory = join(root, 'data')) { this.config = config; this.dataDirectory = dataDirectory; this.photos = new PhotoStore(config, dataDirectory); }
  feedPath(cal: CalendarConfig) { return join(this.dataDirectory, `calendar-${hash(cal.icalUrl)}.json`); }
  weatherPath() { return join(this.dataDirectory, `weather-${hash(JSON.stringify(this.config.weather))}.json`); }
  async init() {
    await this.photos.init();
    for (const cal of this.config.calendar.calendars) {
      const saved = await readJson<{ text: string; updatedAt: string }>(this.feedPath(cal));
      this.statuses.set(cal.id, { state: cal.icalUrl ? 'loading' : 'unconfigured', updatedAt: null, message: cal.icalUrl ? 'Loading calendar' : 'Add an iCal feed in config.yml' });
      if (saved) {
        try { this.feeds.set(cal.id, parseCalendar(saved.text)); this.statuses.set(cal.id, { state: 'cached', updatedAt: saved.updatedAt, message: 'Using saved calendar' }); } catch {}
      }
    }
    const savedWeather = await readJson<{ data: Weather; updatedAt: string }>(this.weatherPath());
    if (savedWeather && this.config.weather.latitude !== null) {
      this.weather = savedWeather.data;
      this.weatherStatus = { state: 'cached', updatedAt: savedWeather.updatedAt, message: 'Using saved weather' };
    }
  }
  start() {
    const schedule = (fn: () => Promise<void>, minutes: number, nextDelay?: () => number) => {
      const run = async () => {
        try { await fn(); } catch { console.error('Background source refresh failed; retained previous data.'); }
        if (!this.stopped) {
          const timer = setTimeout(() => { this.timers.delete(timer); void run(); }, (nextDelay?.() ?? minutes) * 60000);
          this.timers.add(timer);
        }
      };
      void run();
    };
    for (const cal of this.config.calendar.calendars) schedule(() => this.refreshCalendar(cal), this.config.calendar.refreshEveryMinutes);
    let photoFailures = 0;
    schedule(() => this.photos.refresh(), this.config.photos.refreshEveryMinutes, () => {
      if (this.photos.status.state === 'ok') { photoFailures = 0; return this.config.photos.refreshEveryMinutes; }
      photoFailures++;
      const backoff = [2, 5, 15, 30][Math.min(photoFailures - 1, 3)];
      return Math.min(backoff, this.config.photos.refreshEveryMinutes);
    });
    if (this.config.weather.latitude !== null) schedule(() => this.refreshWeather(), this.config.weather.refreshEveryMinutes);
  }
  stop() { this.stopped = true; this.timers.forEach(clearTimeout); }
  async refreshCalendar(cal: CalendarConfig) {
    if (!cal.icalUrl) return;
    try {
      const { text, parsed } = await getCalendar(cal);
      // Validate recurrence expansion before replacing the last working feed.
      calendarDays(this.config, new Map([[cal.id, parsed]]));
      const updatedAt = new Date().toISOString();
      await atomicWrite(this.feedPath(cal), JSON.stringify({ text, updatedAt }));
      this.feeds.set(cal.id, parsed);
      this.statuses.set(cal.id, { state: 'ok', updatedAt, message: '' });
      console.log(`Calendar ${cal.id}: updated`);
    } catch {
      const old = this.statuses.get(cal.id)!;
      this.statuses.set(cal.id, { ...old, state: this.feeds.has(cal.id) ? 'stale' : 'error', message: this.feeds.has(cal.id) ? 'Refresh unavailable · using saved events' : 'Calendar unavailable · check its iCal link' });
      console.error(`Calendar ${cal.id}: refresh failed; private details omitted`);
    }
  }
  async refreshWeather() {
    const w = this.config.weather;
    if (w.latitude === null || w.longitude === null) return;
    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.search = new URLSearchParams({ latitude: String(w.latitude), longitude: String(w.longitude), timezone: this.config.display.timezone, temperature_unit: w.temperatureUnit, wind_speed_unit: w.windSpeedUnit,
        current: 'temperature_2m,is_day,weather_code,wind_speed_10m,wind_direction_10m', daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset', forecast_days: String(w.forecastDays) }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const result = JSON.parse((await limitedBody(response, 1024 * 1024)).toString());
      if (!Number.isFinite(result.current?.temperature_2m) || !Array.isArray(result.daily?.time)) throw new Error('Invalid weather');
      const data: Weather = {
        current: { temperature: result.current.temperature_2m, code: result.current.weather_code, windSpeed: result.current.wind_speed_10m, windDirection: result.current.wind_direction_10m, isDay: result.current.is_day === 1 },
        days: result.daily.time.map((date: string, i: number) => ({ date, code: result.daily.weather_code[i], high: result.daily.temperature_2m_max[i], low: result.daily.temperature_2m_min[i], sunrise: result.daily.sunrise[i], sunset: result.daily.sunset[i] })),
      };
      const updatedAt = new Date().toISOString();
      await atomicWrite(this.weatherPath(), JSON.stringify({ data, updatedAt }));
      this.weather = data;
      this.weatherStatus = { state: 'ok', updatedAt, message: '' };
    } catch { this.weatherStatus = { ...this.weatherStatus, state: this.weather ? 'stale' : 'error', message: this.weather ? 'Weather refresh unavailable · using saved forecast' : 'Weather temporarily unavailable' }; }
  }
  async board() {
    return {
      display: this.config.display,
      calendar: { weeks: this.config.calendar.weeks, weekStartsOn: this.config.calendar.weekStartsOn, calendars: this.config.calendar.calendars.map(({ id, name, color }) => ({ id, name, color })), days: calendarDays(this.config, this.feeds) },
      photos: { items: await this.photos.availablePhotos(), changeEverySeconds: this.config.photos.changeEverySeconds, shuffle: this.config.photos.shuffle, fit: this.config.photos.fit },
      weather: { data: this.weather, temperatureUnit: this.config.weather.temperatureUnit, windSpeedUnit: this.config.weather.windSpeedUnit, moon: getMoonIllumination(new Date()) },
      guestWifi: { enabled: Boolean(this.config.guestWifi?.ssid) },
      status: { calendars: Object.fromEntries(this.statuses), photos: this.photos.status, weather: this.weatherStatus },
      date: DateTime.now().setZone(this.config.display.timezone).toISODate(),
    };
  }
}
