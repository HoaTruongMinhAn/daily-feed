import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotness, isTooOld, ageHours, buzz, rankOf } from '../lib/score.mjs';

const now = Date.parse('2026-10-04T00:00:00Z');
const cfg = { recencyDecayHours: 36 };

test('hotness normalises by p90, caps at 2, and decays with age', () => {
  assert.equal(hotness({ engagement: 300, publishedAt: '2026-10-04T00:00:00Z', p90: 300 }, now, cfg), 1);
  assert.equal(hotness({ engagement: 3000, publishedAt: '2026-10-04T00:00:00Z', p90: 300 }, now, cfg), 2);
  const h36 = hotness({ engagement: 300, publishedAt: '2026-10-02T12:00:00Z', p90: 300 }, now, cfg);
  assert.ok(Math.abs(h36 - Math.exp(-1)) < 1e-3);
  assert.equal(hotness({ engagement: -5, publishedAt: '2026-10-04T00:00:00Z', p90: 300 }, now, cfg), 0);
  assert.equal(hotness({ engagement: 10, publishedAt: '2026-10-04T01:00:00Z', p90: 10 }, now, cfg), 1, 'future dates count as age 0');
});

test('isTooOld uses the cutoff and rejects unparsable dates', () => {
  assert.equal(isTooOld('2026-10-03T00:00:00Z', now, 72), false);
  assert.equal(isTooOld('2026-09-30T00:00:00Z', now, 72), true);
  assert.equal(isTooOld('garbage', now, 72), true);
  assert.equal(isTooOld(null, now, 72), true);
  assert.equal(ageHours('2026-10-03T00:00:00Z', now), 24);
});

test('buzz adds buzzPerSource per extra source, capped at buzzMaxExtra, with defaults', () => {
  const c = { buzzPerSource: 0.25, buzzMaxExtra: 3 };
  assert.equal(buzz(1, c), 1);
  assert.equal(buzz(2, c), 1.25);
  assert.equal(buzz(4, c), 1.75);
  assert.equal(buzz(9, c), 1.75, 'capped');
  assert.equal(buzz(0, c), 1, 'never below 1');
  assert.equal(buzz(3, {}), 1.5, 'defaults 0.25 / 3 when cfg lacks them');
});

test('rankOf = hotness * buzz * fit/5, reading old items without sources as one source (review focus 2)', () => {
  const c = { buzzPerSource: 0.25, buzzMaxExtra: 3 };
  assert.equal(rankOf({ hotness: 1, fit: 4, sourceName: 'HN' }, c), 0.8);
  assert.equal(rankOf({ hotness: 1, fit: 4, sourceName: 'HN', sources: ['HN', 'Lobsters'] }, c), 1);
  assert.equal(rankOf({ hotness: 0.5, fit: 3, sourceName: 'HN', sources: [] }, c), 0.3, 'empty sources = one source');
});
