import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubCurate } from '../scripts/stub-curate.mjs';
import { makeCandidate } from '../lib/candidate.mjs';
import { validateDecision } from '../lib/merge.mjs';

test('stubCurate produces schema-valid decisions for every candidate', () => {
  const cands = ['ai', 'testing', 'it', 'humor'].map((hint, i) =>
    ({ ...makeCandidate({ url: `https://a.com/${i}`, title: `Title ${i}`, excerpt: 'x'.repeat(500), source: 's', sourceName: 's', publishedAt: '2026-10-03T00:00:00Z', categoryHint: hint }), hotness: 1 - i * 0.1 }));
  const out = stubCurate(cands, '2026-10-04T00:00:00.000Z');
  assert.equal(out.generatedAt, '2026-10-04T00:00:00.000Z');
  assert.equal(out.decisions.length, 4);
  const ids = new Set(cands.map((c) => c.id));
  for (const d of out.decisions) assert.deepEqual(validateDecision(d, ids), []);
  assert.deepEqual(out.decisions.map((d) => d.category), ['ai-trend', 'test-automation', 'it-general', 'humor']);
});
