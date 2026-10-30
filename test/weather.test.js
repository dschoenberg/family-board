import test from 'node:test';
import assert from 'node:assert/strict';
import { getMoonIllumination } from 'suncalc';
import { formatSolarTime, moonPhaseName, moonPhaseIcon } from '../public/weather.js';

test('sunrise and sunset use their local clock times with AM/PM and handle missing values', () => {
  assert.equal(formatSolarTime('2026-10-30T07:48'), '7:48 AM');
  assert.equal(formatSolarTime('2026-10-30T18:05'), '6:05 PM');
  assert.equal(formatSolarTime('2026-11-01T00:00'), '12:00 AM');
  assert.equal(formatSolarTime(null), '—');
  assert.equal(formatSolarTime('invalid'), '—');
});
test('moon labels match known new and full moon dates and wrap the cycle', () => {
  assert.equal(moonPhaseName(getMoonIllumination(new Date('2024-04-08T18:21:00Z')).phase), 'New Moon');
  assert.equal(moonPhaseName(getMoonIllumination(new Date('2024-03-25T07:00:00Z')).phase), 'Full Moon');
  assert.equal(moonPhaseName(.25), 'First Quarter');
  assert.equal(moonPhaseName(.75), 'Last Quarter');
  assert.equal(moonPhaseName(.99), 'New Moon');
  assert.match(moonPhaseIcon(.25), /<svg/);
});
