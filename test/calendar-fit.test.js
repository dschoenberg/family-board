import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWeekCount } from '../public/calendar-fit.js';

test('shows the greatest number of complete weeks that fit, including gaps', () => {
  assert.equal(visibleWeekCount([200, 250, 300], 770, 10), 3);
  assert.equal(visibleWeekCount([200, 250, 300], 769, 10), 2);
  assert.equal(visibleWeekCount([200, 250, 300], 459, 10), 1);
  assert.equal(visibleWeekCount([200, 250, 300], 100, 10), 1);
});
