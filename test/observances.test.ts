import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { loadObservances, dailyObservance } from '../server/observances.ts';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { root, validateConfig } from '../server/config.ts';
import { join } from 'node:path';

const data = loadObservances('./observances.yml');

test('every calendar date has a choice and rotating choices are distinct', () => {
  assert.equal(Object.keys(data.days).length, 366);
  for (const choices of Object.values(data.days)) {
    assert.ok(choices.length >= 1);
    assert.equal(new Set(choices).size, choices.length);
  }
});

test('May 20 always celebrates barnacles', () => {
  assert.deepEqual(data.days['05-20'], ['Barnacle Appreciation Day']);
  for (const year of [2026, 2027, 2028, 2032]) {
    assert.equal(dailyObservance(data, DateTime.fromISO(`${year}-05-20`))?.name, 'Barnacle Appreciation Day');
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
