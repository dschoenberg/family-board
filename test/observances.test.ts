import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { loadObservances, dailyObservance } from '../server/observances.ts';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { root, validateConfig } from '../server/config.ts';
import { join } from 'node:path';

const data = loadObservances('./observances.yml');

test('every calendar date has two distinct local choices', () => {
  assert.equal(Object.keys(data.days).length, 366);
  for (const choices of Object.values(data.days)) {
    assert.equal(choices.length, 2);
    assert.notEqual(choices[0], choices[1]);
  }
});

test('the board alternates choices by year and by leap-day occurrence', () => {
  assert.equal(dailyObservance(data, DateTime.fromISO('2026-11-09'))?.name, 'Go to an Art Museum Day');
  assert.equal(dailyObservance(data, DateTime.fromISO('2027-11-09'))?.name, 'Chaos Never Dies Day');
  assert.equal(dailyObservance(data, DateTime.fromISO('2028-11-09'))?.name, 'Go to an Art Museum Day');
  assert.notEqual(dailyObservance(data, DateTime.fromISO('2028-02-29'))?.name, dailyObservance(data, DateTime.fromISO('2032-02-29'))?.name);
});

test('daily observances can be disabled in the private board config', () => {
  const config = parse(readFileSync(join(root, 'config.example.yml'), 'utf8'));
  validateConfig(config);
  config.dailyObservance.enabled = false;
  validateConfig(config);
  delete config.dailyObservance;
  validateConfig(config);
});
