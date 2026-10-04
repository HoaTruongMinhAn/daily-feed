import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect, selectByQuota } from '../lib/collect.mjs';
import { feedConfig } from '../config/feed.mjs';
import { makeCandidate } from '../lib/candidate.mjs';

const now = Date.parse('2026-10-04T00:00:00Z');
const cfg = { maxCandidates: 120, perSourceCap: 2, maxAgeHours: 72, recencyDecayHours: 36 };
const mk = (url, title, publishedAt = '2026-10-03T20:00:00Z', engagement = 100) =>
  makeCandidate({ url, title, source: 's', sourceName: 's', publishedAt, engagement, categoryHint: 'it' });

test('collect scores, filters old, caps per source, skips known, and records failures', async () => {
  const adapters = {
    good: async () => [mk('https://a.com/1', 'one'), mk('https://a.com/2', 'two', '2026-10-03T20:00:00Z', 50), mk('https://a.com/3', 'three', '2026-10-03T20:00:00Z', 10), mk('https://a.com/old', 'old', '2026-09-01T00:00:00Z')],
    bad: async () => { throw new Error('nope'); },
  };
  const sources = [
    { id: 'g', family: 'good', p90: 100, categoryHint: 'it' },
    { id: 'b', family: 'bad', p90: 100, categoryHint: 'it' },
  ];
  const known = new Set([mk('https://a.com/2', 'two').id]);
  const { candidates, failed } = await collect({ sources, adapters, http: {}, now, cfg, knownIds: known, log: () => {} });
  assert.deepEqual(failed, [{ id: 'b', error: 'nope' }]);
  assert.deepEqual(candidates.map((c) => c.title), ['one'], 'cap 2 keeps one+two, known drops two, old dropped');
  assert.ok(candidates[0].hotness > 0 && candidates[0].hotness < 1);
});

test('collect honours per-source maxAgeHours override', async () => {
  const adapters = { f: async () => [mk('https://a.com/w', 'weekly', '2026-09-30T00:00:00Z')] };
  const r1 = await collect({ sources: [{ id: 'f', family: 'f', p90: 1, categoryHint: 'it' }], adapters, http: {}, now, cfg, knownIds: new Set(), log: () => {} });
  const r2 = await collect({ sources: [{ id: 'f', family: 'f', p90: 1, categoryHint: 'it', maxAgeHours: 168 }], adapters, http: {}, now, cfg, knownIds: new Set(), log: () => {} });
  assert.equal(r1.candidates.length, 0);
  assert.equal(r2.candidates.length, 1);
});

test('collect skips sources marked disabled without calling their adapter or counting them as failed', async () => {
  let called = 0;
  const adapters = { f: async () => { called++; return [mk('https://a.com/d', 'x')]; } };
  const sources = [{ id: 'off', family: 'f', p90: 1, categoryHint: 'it', disabled: 'blocked on this network' }];
  const { candidates, failed } = await collect({ sources, adapters, http: {}, now, cfg, knownIds: new Set(), log: () => {} });
  assert.equal(called, 0);
  assert.deepEqual(candidates, []);
  assert.deepEqual(failed, []);
});

test('collect reports how many sources were consulted so callers can detect total failure (review fix 3)', async () => {
  const adapters = { bad: async () => { throw new Error('down'); } };
  const sources = [
    { id: 'a', family: 'bad', p90: 1, categoryHint: 'it' },
    { id: 'b', family: 'bad', p90: 1, categoryHint: 'it' },
    { id: 'off', family: 'bad', p90: 1, categoryHint: 'it', disabled: 'x' },
  ];
  const out = await collect({ sources, adapters, http: {}, now, cfg, knownIds: new Set(), log: () => {} });
  assert.equal(out.consulted, 2);
  assert.equal(out.failed.length, 2);
  assert.equal(out.failed.length === out.consulted, true);
});

test('collect turns stories already in items into sightings; dropped ids are still discarded', async () => {
  const kept = mk('https://a.com/kept', 'Kept story about Playwright traces');
  const adapters = { f: async () => [mk('https://a.com/kept', 'Kept story about Playwright traces'), mk('https://a.com/dropped', 'dropped one'), mk('https://a.com/new', 'brand new')] };
  const items = [{ ...kept, sourceName: 'HN' }];
  const knownIds = new Set([kept.id, mk('https://a.com/dropped', 'x').id]);
  const out = await collect({ sources: [{ id: 'f', family: 'f', p90: 100, categoryHint: 'it' }], adapters, http: {}, now, cfg: { ...cfg, perSourceCap: 10 }, knownIds, knownItems: items, log: () => {} });
  assert.deepEqual(out.candidates.map((c) => c.title), ['brand new']);
  assert.deepEqual(out.sightings, [{ itemId: kept.id, sourceName: 's', link: 'https://a.com/kept' }]);
});

const h = (title, categoryHint, hotness) => ({ id: title, title, categoryHint, hotness });

test('selectByQuota fills each topic hottest-first, refills spare slots, never exceeds max', () => {
  const cands = [
    h('ai1', 'ai', 0.9), h('ai2', 'ai', 0.8), h('ai3', 'ai', 0.7), h('ai4', 'ai', 0.6),
    h('t1', 'testing', 0.2),
    h('hu1', 'humor', 0.1),
  ];
  const out = selectByQuota(cands, { ai: 2, testing: 2, humor: 1 }, 5);
  assert.deepEqual(out.map((c) => c.title), ['ai1', 'ai2', 'ai3', 't1', 'hu1'], 'testing used 1 of 2 slots; the spare went to ai3');
  assert.equal(selectByQuota(cands, { ai: 2, testing: 2, humor: 1 }, 3).length, 3);
});

test('selectByQuota counts a hint with no quota as it (review focus 3)', () => {
  const cands = [h('x', 'typo', 0.9), h('i', 'it', 0.5), h('a', 'ai', 0.4)];
  const out = selectByQuota(cands, { it: 1, ai: 1 }, 2);
  assert.deepEqual(out.map((c) => c.title), ['x', 'a'], '"typo" took the it slot, so "i" waits for a spare that never comes');
});

test('collect applies candidateQuota and a source-level perSourceCap', async () => {
  // Titles must differ in word tokens (digits are dropped by titleTokens), or dedup merges them.
  const many = (prefix, n, hint) => Array.from({ length: n }, (_, i) => makeCandidate({ url: `https://a.com/${prefix}${i}`, title: `${prefix} ${'w'.repeat(i + 2)} story`, source: 's', sourceName: prefix, publishedAt: '2026-10-03T20:00:00Z', engagement: 100 - i, categoryHint: hint }));
  const adapters = { f: async (s) => many(s.id, 10, s.categoryHint) };
  const sources = [
    { id: 'aa', family: 'f', p90: 100, categoryHint: 'ai', perSourceCap: 3 },
    { id: 'tt', family: 'f', p90: 100, categoryHint: 'testing' },
  ];
  const out = await collect({ sources, adapters, http: {}, now, cfg: { ...cfg, perSourceCap: 10, maxCandidates: 6, candidateQuota: { ai: 3, testing: 3 } }, knownIds: new Set(), log: () => {} });
  assert.equal(out.candidates.length, 6);
  assert.equal(out.candidates.filter((c) => c.categoryHint === 'ai').length, 3);
});

test('feed config quotas sum to maxCandidates and cover every hint', () => {
  const q = feedConfig.candidateQuota;
  assert.equal(Object.values(q).reduce((a, b) => a + b, 0), feedConfig.maxCandidates);
  assert.deepEqual(Object.keys(q).sort(), ['ai', 'hot', 'humor', 'it', 'testing']);
  assert.equal(feedConfig.detailMaxPerDay, feedConfig.maxCandidates);
});

test('collect marks signal/editorialHot per source family and sets hotEligible', async () => {
  const adapters = {
    rss: async () => [mk('https://t.com/1', 'Editorial pick of the day')],
    hn: async () => [mk('https://h.com/1', 'Measured story with points')],
  };
  const sources = [
    { id: 'tm', family: 'rss', p90: 1, categoryHint: 'hot', editorialHot: true },
    { id: 'h', family: 'hn', p90: 100, categoryHint: 'it' },
  ];
  const { candidates } = await collect({ sources, adapters, http: {}, now, cfg: { ...cfg, perSourceCap: 5 }, knownIds: new Set(), log: () => {} });
  const tm = candidates.find((x) => x.url === 'https://t.com/1');
  const hn = candidates.find((x) => x.url === 'https://h.com/1');
  assert.deepEqual([tm.signal, tm.editorialHot, tm.hotEligible], [false, true, true]);
  assert.deepEqual([hn.signal, hn.editorialHot, hn.hotEligible], [true, false, true], 'only measured candidate → top 25%');
});
