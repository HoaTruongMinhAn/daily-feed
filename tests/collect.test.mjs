import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect } from '../lib/collect.mjs';
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
