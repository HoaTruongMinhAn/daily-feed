#!/usr/bin/env node
// Offline stand-in for the Claude curation step, for previews and tests.
// Keeps the hottest 30 candidates, maps the category hint to a category,
// and uses the excerpt (or title) as the "summary".
import { fileURLToPath } from 'node:url';
import { dataFile, readJson, writeJson } from '../lib/store.mjs';

const CATEGORY_FOR_HINT = { ai: 'ai-trend', testing: 'test-automation', it: 'it-general', humor: 'humor' };

export function stubCurate(candidates, nowIso = new Date().toISOString()) {
  const sorted = [...candidates].sort((a, b) => b.hotness - a.hotness);
  const decisions = sorted.map((c, i) => (i < 30
    ? {
      id: c.id,
      keep: true,
      category: CATEGORY_FOR_HINT[c.categoryHint] ?? 'it-general',
      title: c.title.slice(0, 110),
      titleVi: `[stub] ${c.title.slice(0, 120)}`,
      summary: `[stub] ${(c.excerpt || c.title).slice(0, 200)}`,
      tags: [c.categoryHint],
      fit: 3,
    }
    : { id: c.id, keep: false }));
  return { generatedAt: nowIso, decisions };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { candidates = [] } = readJson(dataFile('candidates.json'), {});
  writeJson(dataFile('curated.json'), stubCurate(candidates));
  console.error(`[stub-curate] wrote decisions for ${candidates.length} candidates`);
}
