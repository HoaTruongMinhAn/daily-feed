import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectHome } from '../lib/home.mjs';

const it = (id, addedAt, rank) => ({ id, addedAt, rank });

test('selectHome: hot now from the last hotNowDays, feed from the last homeDays without hot items', () => {
  const items = [
    it('a', '2026-10-04', 0.5), it('b', '2026-10-04', 0.9), it('c', '2026-10-03', 0.95),
    it('f', '2026-10-02', 5), it('d', '2026-09-28', 2), it('e', '2026-09-27', 3),
  ];
  const { hotNow, feed } = selectHome(items, '2026-10-04', { hotNowDays: 2, homeDays: 7, hotNowCount: 2 });
  assert.deepEqual(hotNow.map((i) => i.id), ['c', 'b'], 'f ranks higher but is 3 days old');
  assert.deepEqual(feed.map((i) => i.id), ['f', 'd', 'a'], 'd is exactly 7 days back (included), e is 8 (excluded)');
});
