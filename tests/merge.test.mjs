import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDecision, mergeRun, applySightings, retainedItems, CATEGORIES } from '../lib/merge.mjs';
import { makeCandidate } from '../lib/candidate.mjs';

const cfg = { retentionDays: 14, droppedMemoryDays: 30 };
const cand = (n, hotness = 1) => ({ ...makeCandidate({ url: `https://a.com/${n}`, title: `T${n}`, source: 's', sourceName: 's', publishedAt: '2026-10-03T00:00:00Z', categoryHint: 'ai' }), hotness });
const keep = (c, extra = {}) => ({ id: c.id, keep: true, category: 'ai-tip', title: 'Clean title', titleVi: 'Tiêu đề sạch', summary: 'Tóm tắt ngắn.', summaryEn: 'Short summary.', tags: ['llm'], fit: 4, ...extra });

test('validateDecision accepts a good decision and rejects bad fields (review focus 4)', () => {
  const c = cand(1);
  const ids = new Set([c.id]);
  assert.deepEqual(validateDecision(keep(c), ids), []);
  assert.deepEqual(validateDecision({ id: c.id, keep: false }, ids), []);
  assert.ok(validateDecision(keep(c, { id: 'zzz' }), ids).includes('unknown id'));
  assert.ok(validateDecision(keep(c, { summary: 'x'.repeat(221) }), ids).includes('bad summary'));
  assert.ok(validateDecision(keep(c, { summaryEn: undefined }), ids).includes('bad summaryEn'));
  assert.ok(validateDecision(keep(c, { summaryEn: '   ' }), ids).includes('bad summaryEn'));
  assert.ok(validateDecision(keep(c, { summaryEn: 'x'.repeat(221) }), ids).includes('bad summaryEn'));
  assert.deepEqual(validateDecision({ id: c.id, keep: false }, ids), [], 'a drop needs no summaryEn');
  assert.ok(validateDecision(keep(c, { tags: 'llm' }), ids).includes('bad tags'));
  assert.ok(validateDecision(keep(c, { fit: 6 }), ids).includes('bad fit'));
  assert.ok(validateDecision(keep(c, { category: 'news' }), ids).includes('bad category'));
  assert.ok(validateDecision(keep(c, { title: 'x'.repeat(111) }), ids).includes('bad title'));
  assert.ok(validateDecision(keep(c, { titleVi: undefined }), ids).includes('bad titleVi'));
  assert.ok(validateDecision(keep(c, { titleVi: 'a\nb' }), ids).includes('bad titleVi'));
  assert.ok(validateDecision(keep(c, { titleVi: 'x'.repeat(141) }), ids).includes('bad titleVi'));
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
  assert.deepEqual(out.counts, { candidates: 4, kept: 1, dropped: 2, invalid: 1, sighted: 0 });
  assert.deepEqual(out.items.map((i) => i.id), [recentItem.id, a.id], 'old pruned, duplicate decision for a ignored');
  const kept = out.items[1];
  assert.equal(kept.rank, 0.8);
  assert.equal(kept.addedAt, '2026-10-04');
  assert.equal(kept.category, 'ai-tip');
  assert.equal(kept.titleVi, 'Tiêu đề sạch');
  assert.equal(kept.summaryEn, 'Short summary.');
  assert.equal(kept.sourceTitle, 'T1');
  assert.deepEqual(kept.sources, ['s']);
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

test('mergeRun treats an unparsable generatedAt as stale instead of throwing (review fix 1)', () => {
  const a = cand(1);
  const bad = { generatedAt: 'now', decisions: [keep(a)] };
  const out = mergeRun({ candidates: [a], curated: bad, items: [], dropped: [], today: '2026-10-04', cfg, timezone: 'UTC', log: () => {} });
  assert.equal(out.stale, true);
  assert.deepEqual(out.items, []);
  const arr = mergeRun({ candidates: [a], curated: [], items: [], dropped: [], today: '2026-10-04', cfg, timezone: 'UTC', log: () => {} });
  assert.equal(arr.stale, true);
});

const old = (n, extra = {}) => ({ ...cand(n, 1), category: 'it-general', title: `T${n}`, summary: 's', tags: [], fit: 4, rank: 0.8, addedAt: '2026-10-02', sources: undefined, ...extra });
const sightingsFile = (sightings, generatedAt = '2026-10-04T00:05:00Z') => ({ generatedAt, sightings });

test('applySightings adds new sources and links once and recomputes rank (review focus 2, 4)', () => {
  const a = old(1);
  const file = sightingsFile([
    { itemId: a.id, sourceName: 'Lobsters', link: 'https://lobste.rs/s/1' },
    { itemId: a.id, sourceName: 'Lobsters', link: 'https://lobste.rs/s/1' },
    { itemId: a.id, sourceName: 's', link: a.url },
    { itemId: 'gone', sourceName: 'X', link: 'https://x.com' },
    null, { itemId: a.id }, { itemId: a.id, sourceName: '  ' },
  ]);
  const out = applySightings([a], file, { today: '2026-10-04', timezone: 'UTC', cfg, log: () => {} });
  assert.equal(out.applied, 1);
  assert.deepEqual(out.items[0].sources, ['s', 'Lobsters']);
  assert.deepEqual(out.items[0].extraLinks, ['https://lobste.rs/s/1']);
  assert.equal(out.items[0].rank, 1, '1 * 1.25 * 4/5');
  assert.equal(out.items[0].addedAt, '2026-10-02', 'never moved to today');
});

test('applySightings ignores a stale or malformed file', () => {
  const a = old(1);
  const sight = [{ itemId: a.id, sourceName: 'Lobsters', link: 'https://lobste.rs/s/1' }];
  for (const f of [sightingsFile(sight, '2026-10-03T00:05:00Z'), sightingsFile(sight, 'nope'), { generatedAt: '2026-10-04T00:05:00Z' }, null]) {
    const out = applySightings([a], f, { today: '2026-10-04', timezone: 'UTC', cfg, log: () => {} });
    assert.equal(out.applied, 0);
    assert.equal(out.items[0], a);
  }
});

test('mergeRun applies sightings even when curation is missing or stale (review focus 3)', () => {
  const a = old(1);
  const sightings = sightingsFile([{ itemId: a.id, sourceName: 'Lobsters', link: 'https://lobste.rs/s/1' }]);
  for (const curated of [null, { generatedAt: '2026-10-03T00:10:00Z', decisions: [] }]) {
    const out = mergeRun({ candidates: [], curated, sightings, items: [a], dropped: [], today: '2026-10-04', cfg, timezone: 'UTC', log: () => {} });
    assert.equal(out.stale, true);
    assert.equal(out.counts.sighted, 1);
    assert.deepEqual(out.items[0].sources, ['s', 'Lobsters']);
  }
});

test('retainedItems keeps what mergeRun keeps, so fetch never matches against an item merge prunes', () => {
  const items = [old(1, { addedAt: '2026-09-19' }), old(2, { addedAt: '2026-09-20' }), old(3, { addedAt: '2026-10-04' })];
  assert.deepEqual(retainedItems(items, '2026-10-04', cfg).map((i) => i.addedAt), ['2026-09-20', '2026-10-04']);
  const out = mergeRun({ candidates: [], curated: { generatedAt: '2026-10-04T00:10:00Z', decisions: [] }, items, dropped: [], today: '2026-10-04', cfg, timezone: 'UTC', log: () => {} });
  assert.deepEqual(out.items.map((i) => i.id), retainedItems(items, '2026-10-04', cfg).map((i) => i.id));
});

test('validateDecision: hot-* needs eligibility and a short Vietnamese label; core categories must not carry one', () => {
  const c = cand('hot');
  const ids = new Set([c.id]);
  const hotIds = new Set([c.id]);
  const hot = keep(c, { category: 'hot-security', categoryLabelVi: 'Bảo mật' });
  assert.deepEqual(validateDecision(hot, ids, hotIds), []);
  assert.ok(validateDecision(hot, ids).includes('not hot-eligible'), 'default: nobody is eligible');
  assert.ok(validateDecision(keep(c, { category: 'hot-security' }), ids, hotIds).includes('bad categoryLabelVi'));
  for (const label of ['', '   ', 'x'.repeat(25), 'a\nb', 42]) {
    assert.ok(validateDecision(keep(c, { category: 'hot-x', categoryLabelVi: label }), ids, hotIds).includes('bad categoryLabelVi'), JSON.stringify(label));
  }
  assert.ok(validateDecision(keep(c, { category: 'hot-Bad', categoryLabelVi: 'x' }), ids, hotIds).includes('bad category'));
  assert.ok(validateDecision(keep(c, { category: 'ai-trend', categoryLabelVi: 'x' }), ids, hotIds).includes('unexpected categoryLabelVi'));
});

test('mergeRun keeps the hot label and strips internal candidate fields', () => {
  const c = { ...cand('h2'), signal: true, editorialHot: false, hotEligible: true };
  const curated = { generatedAt: '2026-10-04T01:00:00.000Z', decisions: [keep(c, { category: 'hot-launch', categoryLabelVi: ' Ra mắt ' })] };
  const out = mergeRun({ candidates: [c], curated, items: [], dropped: [], today: '2026-10-04', cfg, timezone: 'UTC' });
  assert.equal(out.counts.kept, 1);
  const [item] = out.items;
  assert.equal(item.category, 'hot-launch');
  assert.equal(item.categoryLabel, 'Ra mắt');
  for (const k of ['signal', 'editorialHot', 'hotEligible']) assert.equal(k in item, false, k);
});

test('mergeRun counts hot-* on an ineligible candidate as invalid', () => {
  const c = { ...cand('h3'), hotEligible: false };
  const curated = { generatedAt: '2026-10-04T01:00:00.000Z', decisions: [keep(c, { category: 'hot-launch', categoryLabelVi: 'Ra mắt' })] };
  const out = mergeRun({ candidates: [c], curated, items: [], dropped: [], today: '2026-10-04', cfg, timezone: 'UTC' });
  assert.deepEqual([out.counts.kept, out.counts.invalid], [0, 1]);
});

test('a null or empty categoryLabelVi on a core category counts as absent (final review I2)', () => {
  const c = cand('core-null');
  const ids = new Set([c.id]);
  assert.deepEqual(validateDecision(keep(c, { categoryLabelVi: null }), ids), []);
  assert.deepEqual(validateDecision(keep(c, { categoryLabelVi: '' }), ids), []);
  assert.ok(validateDecision(keep(c, { categoryLabelVi: 'x' }), ids).includes('unexpected categoryLabelVi'));
});

test('categoryLabelVi rejects any control character, not just newline', () => {
  const c = cand('ctrl');
  const ids = new Set([c.id]);
  for (const label of ['a\rb', 'a\tb', 'a\u0000b', 'a\u007fb']) {
    assert.ok(validateDecision(keep(c, { category: 'hot-x', categoryLabelVi: label }), ids, ids).includes('bad categoryLabelVi'), JSON.stringify(label));
  }
});
