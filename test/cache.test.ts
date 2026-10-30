import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { root, validateConfig } from '../server/config.ts';
import { Sources } from '../server/sources.ts';
import { PhotoStore } from '../server/photos.ts';

test('calendar data survives a restart and a failed refresh; source secrets stay out of the board response', async () => {
  await mkdir(join(root, 'data', 'tests'), { recursive: true });
  const folder = await mkdtemp(join(root, 'data', 'tests', 'calendar-'));
  const originalFetch = globalThis.fetch;
  try {
    const c = validateConfig(parse(await readFile(join(root, 'config.example.yml'), 'utf8')));
    c.calendar.calendars = [{ id: 'test', name: 'Test', color: '#123456', icalUrl: 'https://calendar.google.com/calendar/ical/private-test-secret/basic.ics' }];
    c.photos.provider = 'local'; c.photos.fallbackDirectory = folder;
    globalThis.fetch = async () => new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:cached\r\nDTSTART;VALUE=DATE:20261029\r\nDTEND;VALUE=DATE:20261030\r\nSUMMARY:Cached event\r\nEND:VEVENT\r\nEND:VCALENDAR');
    const first = new Sources(c, folder);
    await first.init(); await first.refreshCalendar(c.calendar.calendars[0]);
    assert.equal(first.statuses.get('test')?.state, 'ok');
    globalThis.fetch = async () => { throw new Error('Offline'); };
    const restarted = new Sources(c, folder);
    await restarted.init(); await restarted.refreshCalendar(c.calendar.calendars[0]);
    assert.equal(restarted.statuses.get('test')?.state, 'stale');
    assert.equal(restarted.feeds.get('test')?.cached?.type, 'VEVENT');
    const publicData = JSON.stringify(await restarted.board());
    assert.equal(publicData.includes('private-test-secret'), false);
    assert.equal(publicData.includes('icalUrl'), false);
  } finally { globalThis.fetch = originalFetch; await rm(folder, { recursive: true, force: true }); }
});
test('photo cache enforces the file count limit', async () => {
  await mkdir(join(root, 'data', 'tests'), { recursive: true });
  const folder = await mkdtemp(join(root, 'data', 'tests', 'photos-'));
  try {
    const c = validateConfig(parse(await readFile(join(root, 'config.example.yml'), 'utf8')));
    c.photos.maxCachedPhotos = 2;
    const photos = new PhotoStore(c, folder); await photos.init();
    for (let i = 0; i < 4; i++) { await writeFile(join(photos.directory, `${i}.image`), 'test'); await writeFile(join(photos.directory, `${i}.image.json`), '{}'); }
    await photos.prune();
    assert.equal((await readdir(photos.directory)).filter(f => f.endsWith('.image')).length, 2);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
test('saved album dates reach the display without exposing photo URLs', async () => {
  await mkdir(join(root, 'data', 'tests'), { recursive: true });
  const folder = await mkdtemp(join(root, 'data', 'tests', 'photo-dates-'));
  try {
    const c = validateConfig(parse(await readFile(join(root, 'config.example.yml'), 'utf8')));
    const photos = new PhotoStore(c, folder);
    await mkdir(photos.directory, { recursive: true });
    await writeFile(join(photos.directory, 'manifest.json'), JSON.stringify({
      source: photos.sourceKey(), updatedAt: new Date().toISOString(),
      photos: [{ id: 'abc', url: 'https://lh3.googleusercontent.com/private-photo-url', date: 1735603200000 }]
    }));
    await photos.init();
    const displayed = await photos.availablePhotos();
    assert.deepEqual(displayed, [{ id: 'abc', src: '/photos/abc', date: 1735603200000 }]);
    assert.equal(JSON.stringify(displayed).includes('private-photo-url'), false);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
