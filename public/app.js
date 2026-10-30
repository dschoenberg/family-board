import { weatherIcon, weatherDescription, sunriseIcon, sunsetIcon, formatSolarTime, moonPhaseName, moonPhaseIcon } from './weather.js';
import { visibleWeekCount } from './calendar-fit.js';

const $ = id => document.getElementById(id);
let board, lastCalendar = '', lastWeather = '', lastPhotos = '', photoQueue = [], photoIndex = 0, photoTimer, activePhoto = 0, showingPhotoId = '', photoBusy = false;
let calendarFitFrame;
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function updateClock() {
  if (!board) return;
  const now = new Date();
  const options = { timeZone: board.display.timezone };
  const parts = new Intl.DateTimeFormat('en-US', { ...options, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(now);
  const part = name => parts.find(p => p.type === name)?.value ?? '';
  $('time').textContent = `${part('hour')}:${part('minute')}`;
}
function renderCalendar() {
  const calendar = board.calendar;
  const forecasts = new Map((board.weather.data?.days ?? []).map(day => [day.date, day]));
  document.documentElement.style.setProperty('--weeks', calendar.weeks);
  $('legend').innerHTML = '<span class="legend-label">Legend</span>' + calendar.calendars.map(c => `<span class="legend-item"><i class="legend-dot" style="--color:${escape(c.color)}"></i>${escape(c.name)}</span>`).join('');
  $('calendar').innerHTML = calendar.days.map(day => {
    const forecast = forecasts.get(day.date);
    const condition = forecast ? weatherDescription(forecast.code) : '';
    const forecastLabel = forecast ? `${condition}, high ${Math.round(forecast.high)} degrees, low ${Math.round(forecast.low)} degrees` : '';
    return `<article class="day ${day.today ? 'today' : ''} ${day.past ? 'past' : ''}" aria-label="${escape(day.weekday + ', ' + day.month + ' ' + day.number)}${day.today ? ', today' : ''}${forecast ? ', ' + escape(forecastLabel) : ''}">
    <div class="day-date"><div class="day-heading"><span class="day-weekday" aria-hidden="true">${escape(day.weekday[0])}</span><span class="day-number">${escape(day.number === 1 ? day.month : day.number)}</span></div>${forecast ? `<div class="day-forecast" title="${escape(forecastLabel)}">${weatherIcon(forecast.code)}<span class="day-temperatures"><b>H ${Math.round(forecast.high)}°</b><span>L ${Math.round(forecast.low)}°</span></span></div>` : ''}</div>
    <div class="events">${day.events.map(event => `<div class="event ${event.allDay ? 'all-day' : ''}" style="--color:${escape(event.color)}" title="${escape([event.time, event.title, event.location, event.calendars?.map(c => c.name).join(' + ')].filter(Boolean).join(' · '))}">
      <div class="event-title">${event.allDay && (event.calendars?.length ?? 1) === 1 ? '' : (event.calendars ?? [{color:event.color}]).map(c => `<i class="event-dot" style="--color:${escape(c.color)}"></i>`).join('')}${event.time ? escape(event.time) + ' ' : ''}${escape(event.title)}</div>
      ${event.totalDays > 1 ? `<div class="event-days">Day ${event.day}/${event.totalDays}</div>` : ''}
      ${event.location ? `<div class="event-location">${escape(event.location)}</div>` : ''}
    </div>`).join('')}</div></article>`;
  }).join('');
  scheduleCalendarFit();
}
function scheduleCalendarFit() {
  cancelAnimationFrame(calendarFitFrame);
  calendarFitFrame = requestAnimationFrame(fitCalendar);
}
function fitCalendar() {
  const container = $('calendar');
  const days = [...container.querySelectorAll('.day')];
  if (!days.length || !container.clientHeight) return;
  // Show every day while measuring, including weeks hidden by a previous fit.
  days.forEach(day => { day.hidden = false; });
  container.style.gridTemplateRows = `repeat(${board.calendar.weeks}, minmax(0, 1fr))`;
  const weekHeights = [];
  for (let week = 0; week < board.calendar.weeks; week++) {
    const heights = days.slice(week * 7, week * 7 + 7).map(day => {
      const date = day.querySelector('.day-date');
      const dateHeight = date.getBoundingClientRect().height + parseFloat(getComputedStyle(date).marginBottom);
      const eventHeight = [...day.querySelectorAll('.event')].reduce((sum, event) => sum + event.getBoundingClientRect().height + parseFloat(getComputedStyle(event).marginBottom), 0);
      return Math.ceil(dateHeight + eventHeight);
    });
    weekHeights.push(Math.max(0, ...heights));
  }
  const gap = parseFloat(getComputedStyle(container).rowGap) || 0;
  const visibleWeeks = visibleWeekCount(weekHeights, container.clientHeight, gap);
  // A single unusually busy week can still be taller than the screen; allow scrolling in that case.
  container.style.gridTemplateRows = weekHeights.slice(0, visibleWeeks).map(height => `minmax(${height}px, 1fr)`).join(' ');
  days.forEach((day, i) => { day.hidden = i >= visibleWeeks * 7; });
  container.setAttribute('aria-label', `Calendar events, showing ${visibleWeeks} ${visibleWeeks === 1 ? 'week' : 'weeks'}; scroll if needed`);
}
function renderWeather() {
  const weather = board.weather.data;
  if (!weather) {
    $('weather').innerHTML = '<div class="weather-unconfigured"><span class="label">Weather</span>' + (board.status.weather.state === 'unconfigured' ? 'Location not set yet' : 'Temporarily unavailable') + '</div>';
    return;
  }
  const current = weather.current;
  const today = weather.days.find(d => d.date === board.date);
  const moon = board.weather.moon;
  const moonName = moon && Number.isFinite(moon.phase) ? moonPhaseName(moon.phase) : '';
  $('weather').innerHTML = `<div class="current-weather" aria-label="${Math.round(current.temperature)} degrees, ${weatherDescription(current.code)}"><span class="current-temperature">${Math.round(current.temperature)}°</span><span class="current-condition">${weatherIcon(current.code, current.isDay)}</span></div>
    <div class="astro-details">
      <div class="solar-times"><span aria-label="Sunrise ${formatSolarTime(today?.sunrise)}">${sunriseIcon}<span>Rise ${formatSolarTime(today?.sunrise)}</span></span><span aria-label="Sunset ${formatSolarTime(today?.sunset)}">${sunsetIcon}<span>Set ${formatSolarTime(today?.sunset)}</span></span></div>
      ${moonName ? `<div class="moon-phase" aria-label="Moon phase: ${moonName}, ${Math.round(moon.fraction * 100)} percent illuminated">${moonPhaseIcon(moon.phase)}<span>${moonName} · ${Math.round(moon.fraction * 100)}%</span></div>` : ''}
    </div>`;
}
function shuffle(items) { const list = [...items]; for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; }
function resetPhotos() {
  photoQueue = board.photos.shuffle ? shuffle(board.photos.items) : [...board.photos.items];
  photoIndex = 0;
  document.querySelectorAll('.photo-stage img').forEach(img => { img.style.objectFit = board.photos.fit; });
  clearInterval(photoTimer);
  if (!photoQueue.length) { $('photo-message').textContent = 'Photos are on their way'; return; }
  if (!showingPhotoId) void nextPhoto();
  photoTimer = setInterval(nextPhoto, board.photos.changeEverySeconds * 1000);
}
async function nextPhoto() {
  if (photoBusy || !photoQueue.length) return;
  photoBusy = true;
  try {
    // Keep the previous image visible if the next source fails.
    for (let attempt = 0; attempt < Math.min(3, photoQueue.length); attempt++) {
      const item = photoQueue[photoIndex++ % photoQueue.length];
      if (item.id === showingPhotoId && photoQueue.length > 1) continue;
      const target = $(activePhoto === 0 ? 'photo-b' : 'photo-a');
      target.src = item.src;
      try { await target.decode(); } catch { continue; }
      $(activePhoto === 0 ? 'photo-a' : 'photo-b').classList.remove('active');
      target.classList.add('active');
      activePhoto = 1 - activePhoto;
      showingPhotoId = item.id;
      $('photo-date').textContent = Number.isFinite(item.date) && item.date > 0
        ? new Intl.DateTimeFormat('en-US', { timeZone: board.display.timezone, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(item.date))
        : '';
      $('photo-message').classList.add('hidden');
      const next = photoQueue[photoIndex % photoQueue.length];
      if (next && next.id !== item.id) { const preload = new Image(); preload.src = next.src; }
      return;
    }
    if (!showingPhotoId) $('photo-message').textContent = 'Waiting for photos';
  } finally { photoBusy = false; }
}
function renderStatuses() {
  const problems = board.calendar.calendars.map(cal => {
    const s = board.status.calendars[cal.id];
    return s && s.state !== 'ok' ? `${cal.name}: ${s.message}${s.updatedAt ? ' (last updated ' + new Intl.DateTimeFormat('en-US', { timeZone: board.display.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(s.updatedAt)) + ')' : ''}` : '';
  }).filter(Boolean);
  if (['stale', 'error'].includes(board.status.weather.state)) problems.push(board.status.weather.message);
  $('source-status').textContent = problems.join(' · ');
  $('source-status').title = problems.join('\n');
  $('photo-status').textContent = ['stale', 'error'].includes(board.status.photos.state) ? board.status.photos.message : '';
}
async function refresh() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch('/api/board', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error();
    const next = await response.json();
    board = next;
    $('guest-wifi').hidden = !board.guestWifi?.enabled;
    if (board.guestWifi?.enabled && !$('wifi-qr').getAttribute('src')) $('wifi-qr').src = '/guest-wifi.svg';
    document.documentElement.style.setProperty('--photo-width', `${board.display.photoPanelPercent}%`);
    const calendarKey = JSON.stringify([board.calendar, board.weather.data?.days]);
    if (calendarKey !== lastCalendar) { renderCalendar(); lastCalendar = calendarKey; }
    const weatherKey = JSON.stringify([board.weather, board.status.weather, board.date]);
    if (weatherKey !== lastWeather) { renderWeather(); lastWeather = weatherKey; }
    const photoKey = JSON.stringify(board.photos);
    if (photoKey !== lastPhotos) { resetPhotos(); lastPhotos = photoKey; }
    renderStatuses(); updateClock();
    $('connection').textContent = '';
  } catch { $('connection').textContent = 'Reconnecting…'; }
  finally { clearTimeout(timeout); }
  setTimeout(refresh, board?.status.photos.state === 'loading' || Object.values(board?.status.calendars ?? {}).some(s => s.state === 'loading') ? 3000 : 30000);
}
let mouseTimer;
window.addEventListener('mousemove', () => { document.body.classList.add('mouse-active'); clearTimeout(mouseTimer); mouseTimer = setTimeout(() => document.body.classList.remove('mouse-active'), 2000); });
window.addEventListener('resize', scheduleCalendarFit);
setInterval(updateClock, 1000);
void refresh();
