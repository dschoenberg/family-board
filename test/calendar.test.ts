import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { DateTime } from 'luxon';
import { root, validateConfig } from '../server/config.ts';
import { parseCalendar, calendarDays } from '../server/calendar.ts';

const config = validateConfig(parse(readFileSync(`${root}/config.example.yml`, 'utf8')));
const now = DateTime.fromISO('2026-10-29T12:00:00', { zone: 'America/Chicago' });
const calendar = (...events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join('\r\n')}\r\nEND:VCALENDAR`;
const event = (uid: string, lines: string) => `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261001T120000Z\r\n${lines.replaceAll('\n', '\r\n')}\r\nEND:VEVENT`;
const daysFor = (ics: string) => calendarDays(config, new Map([['primary', parseCalendar(ics)]]), now);

test('all-day dates stay on their named days and DTEND is exclusive', () => {
  const days = daysFor(calendar(event('multi-day-event', 'DTSTART;VALUE=DATE:20261031\nDTEND;VALUE=DATE:20261103\nSUMMARY:Multi-day Event')));
  assert.deepEqual(days.filter(d => d.events.length).map(d => d.date), ['2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(days.flatMap(d => d.events.map(e => [e.day, e.totalDays, e.allDay])), [[1,3,true],[2,3,true],[3,3,true]]);
});
test('weekly local times survive the daylight-saving transition', () => {
  const days = daysFor(calendar(event('weekly-event', 'DTSTART;TZID=America/Chicago:20261026T184500\nDTEND;TZID=America/Chicago:20261026T194500\nRRULE:FREQ=WEEKLY;COUNT=3\nSUMMARY:Weekly Event')));
  const events = days.flatMap(d => d.events);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(e => e.time), ['6:45p','6:45p','6:45p']);
  assert.match(events[0].start, /-05:00$/);
  assert.match(events[1].start, /-06:00$/);
});
test('EXDATE, a moved occurrence, and a canceled occurrence are honored', () => {
  const days = daysFor(calendar(
    event('weekly', 'DTSTART;TZID=America/Chicago:20261026T090000\nDTEND;TZID=America/Chicago:20261026T100000\nRRULE:FREQ=WEEKLY;COUNT=3\nEXDATE;TZID=America/Chicago:20261026T090000\nSUMMARY:Weekly'),
    event('weekly', 'RECURRENCE-ID;TZID=America/Chicago:20261102T090000\nDTSTART;TZID=America/Chicago:20261103T110000\nDTEND;TZID=America/Chicago:20261103T120000\nSUMMARY:Moved'),
    event('weekly', 'RECURRENCE-ID;TZID=America/Chicago:20261109T090000\nDTSTART;TZID=America/Chicago:20261109T090000\nDTEND;TZID=America/Chicago:20261109T100000\nSTATUS:CANCELLED\nSUMMARY:Canceled'),
  ));
  assert.deepEqual(days.filter(d => d.events.length).map(d => [d.date, d.events[0].title, d.events[0].time]), [['2026-11-03', 'Moved', '11a']]);
});
test('overnight events appear on both days but a midnight end adds no extra day', () => {
  const days = daysFor(calendar(event('night', 'DTSTART:20261030T040000Z\nDTEND:20261031T050000Z\nSUMMARY:Overnight')));
  assert.deepEqual(days.filter(d => d.events.length).map(d => d.date), ['2026-10-29','2026-10-30']);
});
test('calendar names, colors and duplicate IDs are validated without revealing links', () => {
  const c = structuredClone(config);
  c.calendar.calendars[1].id = 'primary';
  assert.throws(() => validateConfig(c), /unique/);
  c.calendar.calendars[1].id = 'secondary';
  c.calendar.calendars[0].icalUrl = 'https://example.com/secret-token';
  assert.throws(() => validateConfig(c), error => error instanceof Error && !error.message.includes('secret-token'));
});
test('Monday-start configuration uses the correct seven-day window', () => {
  const c = structuredClone(config);
  c.calendar.weekStartsOn = 'monday'; c.calendar.weeks = 1;
  const days = calendarDays(c, new Map(), now);
  assert.equal(days[0].date, '2026-10-26');
  assert.equal(days.at(-1)?.date, '2026-11-01');
});

test('shared invitations appear once with both calendar memberships, even with different titles', () => {
  const showingLocations = structuredClone(config);
  showingLocations.calendar.showLocation = true;
  const primary = parseCalendar(calendar(event('shared-invite', 'DTSTART:20261029T170000Z\nDTEND:20261029T180000Z\nSUMMARY:Lunch')));
  const secondary = parseCalendar(calendar(event('shared-invite', 'DTSTART:20261029T170000Z\nDTEND:20261029T180000Z\nSUMMARY:Lunch with friends\nLOCATION:Cafe')));
  const events = calendarDays(showingLocations, new Map([['primary', primary], ['secondary', secondary]]), now).flatMap(d => d.events);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].calendars, config.calendar.calendars.map(({id,name,color}) => ({id,name,color})));
  assert.equal(events[0].title, 'Lunch');
  assert.equal(events[0].location, 'Cafe');
});

test('locations are hidden by default and can be enabled explicitly', () => {
  const feed = parseCalendar(calendar(event('location-test', 'DTSTART:20261029T170000Z\nDTEND:20261029T180000Z\nSUMMARY:Meeting\nLOCATION:Example Place')));
  const withoutOption = structuredClone(config);
  delete (withoutOption.calendar as Partial<typeof withoutOption.calendar>).showLocation;
  validateConfig(withoutOption);
  assert.equal(withoutOption.calendar.showLocation, false);
  assert.equal(calendarDays(withoutOption, new Map([['primary', feed]]), now).flatMap(d => d.events)[0].location, '');
  withoutOption.calendar.showLocation = true;
  assert.equal(calendarDays(withoutOption, new Map([['primary', feed]]), now).flatMap(d => d.events)[0].location, 'Example Place');
});

test('unrelated invitations with the same title and time remain separate', () => {
  const lines = 'DTSTART:20261029T170000Z\nDTEND:20261029T180000Z\nSUMMARY:Lunch';
  const primary = parseCalendar(calendar(event('first-invite', lines)));
  const secondary = parseCalendar(calendar(event('second-invite', lines)));
  const events = calendarDays(config, new Map([['primary', primary], ['secondary', secondary]]), now).flatMap(d => d.events);
  assert.equal(events.length, 2);
  assert.ok(events.every(e => e.calendars.length === 1));
});

test('deduplication preserves each recurring occurrence and each day of shared multiday events', () => {
  const feed = parseCalendar(calendar(
    event('weekly', 'DTSTART;TZID=America/Chicago:20261026T184500\nDTEND;TZID=America/Chicago:20261026T194500\nRRULE:FREQ=WEEKLY;COUNT=3\nSUMMARY:Weekly Event'),
    event('multi-day-event', 'DTSTART;VALUE=DATE:20261031\nDTEND;VALUE=DATE:20261103\nSUMMARY:Multi-day Event'),
  ));
  const events = calendarDays(config, new Map([['primary', feed], ['secondary', feed]]), now).flatMap(d => d.events);
  assert.equal(events.filter(e => e.title === 'Weekly Event').length, 3);
  assert.deepEqual(events.filter(e => e.title === 'Multi-day Event').map(e => e.day), [1,2,3]);
  assert.ok(events.every(e => e.calendars.length === 2));
});
