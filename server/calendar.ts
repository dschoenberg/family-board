import ical from 'node-ical';
import type { CalendarResponse, ParameterValue } from 'node-ical';
import { DateTime } from 'luxon';
import type { Config, CalendarConfig } from './config.ts';

export function parseCalendar(text: string) {
  if (!text.includes('BEGIN:VCALENDAR') || !text.includes('END:VCALENDAR')) throw new Error('Invalid calendar feed');
  return ical.sync.parseICS(text);
}
const plain = (value?: ParameterValue) => typeof value === 'string' ? value : value?.val ?? '';
export type DisplayEvent = { id: string; calendarId: string; calendars: { id: string; name: string; color: string }[]; title: string; location: string; color: string; allDay: boolean; time: string; start: string; day: number; totalDays: number };
export function calendarWindow(config: Config, now: DateTime = DateTime.now()) {
  const today = now.setZone(config.display.timezone).startOf('day');
  const offset = config.calendar.weekStartsOn === 'sunday' ? today.weekday % 7 : today.weekday - 1;
  const from = today.minus({ days: offset });
  const to = from.plus({ weeks: config.calendar.weeks });
  return { today, from, to };
}
export function calendarDays(config: Config, feeds: Map<string, CalendarResponse>, now: DateTime = DateTime.now()) {
  const { today, from, to } = calendarWindow(config, now);
  const days = Array.from({ length: config.calendar.weeks * 7 }, (_, i) => {
    const d = from.plus({ days: i });
    return { date: d.toISODate()!, number: d.day, month: d.toFormat('LLL'), weekday: d.toFormat('cccc'), today: d.hasSame(today, 'day'), past: d < today, events: [] as DisplayEvent[] };
  });
  for (const cal of config.calendar.calendars) {
    const feed = feeds.get(cal.id);
    if (!feed) continue;
    for (const component of Object.values(feed)) {
      if (component?.type !== 'VEVENT' || component.status === 'CANCELLED' || !component.start) continue;
      // Include extra boundary days: floating all-day dates must not shift with the board timezone.
      const instances = ical.expandRecurringEvent(component, { from: from.minus({ days: 1 }).toJSDate(), to: to.plus({ days: 1 }).toJSDate(), expandOngoing: true });
      for (const instance of instances) {
        if (instance.event.status === 'CANCELLED') continue;
        const zone = config.display.timezone;
        const sourceZone = instance.start.tz || component.start.tz || 'UTC';
        const start = instance.isFullDay
          ? DateTime.fromISO(DateTime.fromJSDate(instance.start, { zone: sourceZone }).toISODate()!, { zone })
          : DateTime.fromJSDate(instance.start, { zone });
        let end = instance.isFullDay
          ? DateTime.fromISO(DateTime.fromJSDate(instance.end, { zone: instance.end.tz || sourceZone }).toISODate()!, { zone })
          : DateTime.fromJSDate(instance.end, { zone });
        if (end <= start) end = instance.isFullDay ? start.plus({ days: 1 }) : start.plus({ milliseconds: 1 });
        const lastDay = end.minus({ milliseconds: 1 }).startOf('day');
        const totalDays = Math.round(lastDay.diff(start.startOf('day'), 'days').days) + 1;
        for (const day of days) {
          const d = DateTime.fromISO(day.date, { zone });
          if (start >= d.plus({ days: 1 }) || end <= d) continue;
          // Google preserves the iCalendar UID across attendees' copies of an invite.
          // The start distinguishes occurrences of a recurring invitation. Never match by title.
          const id = JSON.stringify([component.uid || [cal.id, plain(instance.summary)], start.toMillis(), instance.isFullDay]);
          const membership = { id: cal.id, name: cal.name, color: cal.color };
          const existing = day.events.find(event => event.id === id);
          if (existing) {
            if (!existing.calendars.some(member => member.id === cal.id)) existing.calendars.push(membership);
            if (!existing.location && config.calendar.showLocation) existing.location = plain(instance.event.location);
            continue;
          }
          day.events.push({
            id, calendars: [membership],
            calendarId: cal.id, title: plain(instance.summary) || '(Untitled)',
            location: config.calendar.showLocation ? plain(instance.event.location) : '',
            color: cal.color, allDay: instance.isFullDay,
            time: instance.isFullDay ? '' : start < d ? '↳' : start.toFormat(start.minute === 0 ? 'ha' : 'h:mma').toLowerCase().replace('am', 'a').replace('pm', 'p'),
            start: start.toISO()!, day: Math.round(d.diff(start.startOf('day'), 'days').days) + 1, totalDays,
          });
        }
      }
    }
  }
  for (const day of days) day.events.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  return days;
}

export async function getCalendar(cal: CalendarConfig) {
  const { limitedBody } = await import('./io.ts');
  const response = await fetch(cal.icalUrl, { signal: AbortSignal.timeout(30000), redirect: 'error' });
  const text = (await limitedBody(response, 25 * 1024 * 1024)).toString('utf8');
  const parsed = parseCalendar(text);
  return { text, parsed };
}
