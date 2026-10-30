const wrap = paths => `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const cloud = '<path d="M17 45a11 11 0 1 1 0-22 15 15 0 0 1 29 4 9 9 0 1 1 2 18Z"/>';
const sun = '<circle cx="32" cy="28" r="11"/><path d="M32 7V3m0 50v-4M11 28H7m50 0h-4M17 13l-3-3m36 36-3-3M17 43l-3 3m36-36-3 3"/>';
export const windIcon = wrap('<path d="M8 22h33c12 0 12-16 3-16-5 0-7 3-7 6M8 32h43c10 0 10 15 1 15-5 0-6-3-6-5M8 42h18c10 0 10 15 1 15-5 0-6-3-6-5"/>');
export const sunsetIcon = wrap('<path d="M5 46h54M10 54h44M18 40a14 14 0 1 1 28 0M32 10V4M9 29l-5-3m51 3 5-3M14 15l-4-4m40 4 4-4M32 20v17m-6-6 6 6 6-6"/>');
export const sunriseIcon = wrap('<path d="M5 46h54M10 54h44M18 40a14 14 0 1 1 28 0M32 10V4M9 29l-5-3m51 3 5-3M14 15l-4-4m40 4 4-4M32 37V20m-6 6 6-6 6 6"/>');
export function formatSolarTime(value) {
  const match = typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/);
  if (!match) return '—';
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 23 || minute > 59) return '—';
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}
export function moonPhaseName(phase) {
  const names = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
  return names[Math.floor(((phase % 1 + 1) % 1) * 8 + 0.5) % 8];
}
export function moonPhaseIcon(phase) {
  const p = (phase % 1 + 1) % 1;
  const waxing = p <= .5;
  const terminator = 12 + (waxing ? 1 : -1) * 10 * Math.cos(2 * Math.PI * p);
  const control = (2 * terminator - 12).toFixed(2);
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M12 2 A10 10 0 0 ${waxing ? 1 : 0} 12 22 Q${control} 12 12 2Z" fill="currentColor"/></svg>`;
}
export function weatherIcon(code, isDay = true) {
  if (code === 0) return wrap(isDay ? sun : '<path d="M45 45A24 24 0 0 1 22 7a24 24 0 1 0 31 31 24 24 0 0 1-8 7Z"/>');
  if (code <= 2) return wrap('<circle cx="21" cy="19" r="10"/><path d="M21 3v-2M5 19H2M8 6 5 3M34 6l3-3"/>' + cloud);
  if (code === 3) return wrap(cloud);
  if (code < 50) return wrap(cloud + '<path d="M8 52h46M15 59h34"/>');
  if (code >= 95) return wrap(cloud + '<path d="m33 38-8 13h9l-7 12"/>');
  if ([71, 73, 75, 77, 85, 86].includes(code)) return wrap(cloud + '<path d="M19 51v8m-4-4h8m18-4v8m-4-4h8M30 49v8m-4-4h8"/>');
  return wrap(cloud + '<path d="m19 51-3 7m15-7-3 7m15-7-3 7"/>');
}
export function weatherDescription(code) {
  if (code === 0) return 'Clear'; if (code <= 2) return 'Partly cloudy'; if (code === 3) return 'Cloudy'; if (code < 50) return 'Fog'; if (code >= 95) return 'Thunderstorms'; if ([71,73,75,77,85,86].includes(code)) return 'Snow'; return 'Rain';
}
