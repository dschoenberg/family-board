import { fetchImageUrls } from '@marcus5914/google-photos-album-image-url-fetch';
import { loadConfig } from '../server/config.ts';
import { getCalendar, calendarDays } from '../server/calendar.ts';
import { limitedBody } from '../server/io.ts';

const config = loadConfig();
const checks = config.calendar.calendars.map(async cal => {
  try {
    const { parsed } = await getCalendar(cal);
    const days = calendarDays(config, new Map([[cal.id, parsed]]));
    const unique = new Set(days.flatMap(d => d.events.map(e => e.id)));
    console.log(`${cal.name}: feed OK; ${unique.size} events in the displayed period; color ${cal.color}`);
  } catch { console.error(`${cal.name}: feed check failed (URL and event details omitted)`); process.exitCode = 1; }
});
checks.push((async () => {
  try {
    const photos = await fetchImageUrls(config.photos.albumUrl, AbortSignal.timeout(90000));
    const first = photos?.find(p => !p.isVideo);
    if (!first) throw new Error('No photos');
    const response = await fetch(`${first.url}=w1000-h1600`, { signal: AbortSignal.timeout(30000) });
    if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error('Not an image');
    const image = await limitedBody(response, 12 * 1024 * 1024);
    console.log(`Photos: ${photos!.filter(p => !p.isVideo).length} photos found; sample image downloaded (${Math.round(image.length / 1024)} KB)`);
  } catch { console.error('Photos: shared album check failed (link omitted)'); process.exitCode = 1; }
})());
await Promise.all(checks);
