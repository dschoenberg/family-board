import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DateTime } from 'luxon';
import { parse } from 'yaml';
import { root } from './config.ts';

export type ObservanceFile = { yearBase: number; sources?: string[]; days: Record<string, string[]> };

export function loadObservances(file: string): ObservanceFile {
  const path = resolve(root, file);
  const value = parse(readFileSync(path, 'utf8')) as ObservanceFile;
  if (!value || !value.days || typeof value.days !== 'object') throw new Error('Invalid daily observances file');
  if (!Number.isInteger(value.yearBase)) throw new Error('Invalid daily observances yearBase');
  for (const [date, choices] of Object.entries(value.days)) {
    const validDate = /^\d{2}-\d{2}$/.test(date) && DateTime.fromISO(`2024-${date}`).isValid;
    if (!validDate || !Array.isArray(choices) || choices.length < 2 || choices.some(name => typeof name !== 'string' || !name.trim())) {
      throw new Error(`Invalid daily observance entry: ${date}`);
    }
  }
  if (Object.keys(value.days).length !== 366) throw new Error('Daily observances file must cover all 366 dates');
  return value;
}

export function dailyObservance(data: ObservanceFile, date: DateTime) {
  const key = date.toFormat('MM-dd');
  const choices = data.days[key] ?? [];
  if (!choices.length) return null;
  const leapYearsThrough = (year: number) => Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400);
  const yearOffset = key === '02-29'
    ? leapYearsThrough(date.year - 1) - leapYearsThrough(data.yearBase - 1)
    : date.year - data.yearBase;
  const index = ((yearOffset % choices.length) + choices.length) % choices.length;
  return { name: choices[index], date: date.toISODate() };
}
