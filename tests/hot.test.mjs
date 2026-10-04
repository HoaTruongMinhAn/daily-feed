import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHotCategory, markHot, hotCategoriesFrom } from '../lib/hot.mjs';

test('isHotCategory: hot- prefix, 1-3 lowercase words, at most 24 chars', () => {
  for (const ok of ['hot-security', 'hot-launch', 'hot-cloud-outage', 'hot-a-b-c', 'hot-chips2']) assert.ok(isHotCategory(ok), ok);
  for (const bad of ['hot-', 'hot', 'hot-Security', 'hot-a-b-c-d', 'hot-' + 'x'.repeat(21), 'it-general', 'hot-sec urity', 'hot_x', null, 42]) assert.ok(!isHotCategory(bad), String(bad));
});

const c = (id, hotness, extra = {}) => ({ id, hotness, signal: true, sourceName: id, sources: [id], ...extra });

test('markHot: top 25% of measured candidates, any 2+ source story, any editorialHot story', () => {
  const out = markHot([
    c('a', 1.8), c('b', 1.2), c('c', 0.5), c('d', 0.4), c('e', 0.3), c('f', 0.2), c('g', 0.1), c('h', 0.05),
    c('multi', 0.01, { sources: ['HN', 'Lobsters'] }),
    c('tm', 1, { signal: false, editorialHot: true }),
  ]);
  const hot = out.filter((x) => x.hotEligible).map((x) => x.id);
  assert.deepEqual(hot, ['a', 'b', 'c', 'multi', 'tm'], '9 measured → top ceil(2.25)=3: a, b, c');
});

test('markHot: RSS-only candidates never qualify through the percentile (review focus 4)', () => {
  const out = markHot([c('r1', 1, { signal: false }), c('r2', 1, { signal: false }), c('r3', 0.9, { signal: false })]);
  assert.deepEqual(out.map((x) => x.hotEligible), [false, false, false]);
  assert.equal(markHot([c('z', 0)])[0].hotEligible, false, 'zero hotness never qualifies');
});

test('hotCategoriesFrom lists hot-* slugs with the latest label, most used first', () => {
  const items = [
    { category: 'hot-security', categoryLabel: 'Bảo mật' },
    { category: 'hot-launch', categoryLabel: 'Ra mắt' },
    { category: 'hot-security', categoryLabel: 'An ninh mạng' },
    { category: 'ai-trend' },
    { category: 'hot-bad slug', categoryLabel: 'x' },
  ];
  assert.deepEqual(hotCategoriesFrom(items), [
    { slug: 'hot-security', label: 'An ninh mạng', count: 2 },
    { slug: 'hot-launch', label: 'Ra mắt', count: 1 },
  ]);
});
