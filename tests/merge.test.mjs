import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDecision, mergeRun, CATEGORIES } from '../lib/merge.mjs';
import { makeCandidate } from '../lib/candidate.mjs';

const cfg = { retentionDays: 14, droppedMemoryDays: 30 };
const cand = (n, hotness = 1) => ({ ...makeCandidate({ url: `https://a.com/${n}`, title: `T${n}`, source: 's', sourceName: 's', publishedAt: '2026-10-03T00:00:00Z', categoryHint: 'ai' }), hotness });
const keep = (c, extra = {}) => ({ id: c.id, keep: true, category: 'ai-tip', title: 'Clean title', summary: 'Tóm tắt ngắn.', tags: ['llm'], fit: 4, ...extra });

test('validateDecision accepts a good decision and rejects bad fields (review focus 4)', () => {
  const c = cand(1);
  const ids = new Set([c.id]);
  assert.deepEqual(validateDecision(keep(c), ids), []);
  assert.deepEqual(validateDecision({ id: c.id, keep: false }, ids), []);
  assert.ok(validateDecision(keep(c, { id: 'zzz' }), ids).includes('unknown id'));
  assert.ok(validateDecision(keep(c, { summary: 'x'.repeat(221) }), ids).includes('bad summary'));
  assert.ok(validateDecision(keep(c, { tags: 'llm' }), ids).includes('bad tags'));
  assert.ok(validateDecision(keep(c, { fit: 6 }), ids).includes('bad fit'));
  assert.ok(validateDecision(keep(c, { category: 'news' }), ids).includes('bad category'));
  assert.ok(validateDecision(keep(c, { title: 'x'.repeat(111) }), ids).includes('bad title'));
  assert.ok(validateDecision({ id: c.id }, ids).includes('keep must be boolean'));
  assert.ok(validateDecision(null, ids).length > 0);
  assert.equal(CATEGORIES.length, 10);
});

test('mergeRun keeps valid, drops invalid and keep:false, ranks, prunes', () => {
  const [a, b, c, d] = [cand(1, 1), cand(2, 0.5), cand(3, 0.5), cand(4, 0.2)];
  const curated = { generatedAt: '2026-10-04T00:10:00Z', decisions: [keep(a), { id: b.id, keep: false }, keep(c, { fit: 'high' }), { id: a.id, keep: false }] };
  const oldItem = { ...cand(99), category: 'it-general', title: 'old', summary: 's', tags: [], fit: 3, rank: 0.1, addedAt: '2026-09-19' };
  const recentItem = { ...oldItem, ...cand(98), addedAt: '2026-09-21' };
  const oldDrop = { id: 'x', droppedAt: '2026-09-03' };
  const recentDrop = { id: 'y', droppedAt: '2026-09-05' };
  const out = mergeRun({ candidates: [a, b, c, d], curated, items: [oldItem, recentItem], dropped: [oldDrop, recentDrop], today: '2026-10-04', cfg, log: () => {} });
  assert.deepEqual(out.counts, { candidates: 4, kept: 1, dropped: 2, invalid: 1 });
  assert.deepEqual(out.items.map((i) => i.id), [recentItem.id, a.id], 'old pruned, duplicate decision for a ignored');
  const kept = out.items[1];
  assert.equal(kept.rank, 0.8);
  assert.equal(kept.addedAt, '2026-10-04');
  assert.equal(kept.category, 'ai-tip');
  assert.deepEqual(out.dropped.map((x) => x.id).sort(), [b.id, c.id, 'y'].sort());
  assert.equal(out.items.some((i) => i.id === d.id), false, 'unmentioned candidate neither kept nor dropped');
});

test('mergeRun ignores a stale curated file (review focus 3)', () => {
  const a = cand(1);
  const stale = { generatedAt: '2026-10-03T00:10:00Z', decisions: [keep(a)] };
  const out = mergeRun({ candidates: [a], curated: stale, items: [], dropped: [], today: '2026-10-04', cfg, timezone: 'UTC', log: () => {} });
  assert.equal(out.stale, true);
  assert.deepEqual(out.items, []);
});
