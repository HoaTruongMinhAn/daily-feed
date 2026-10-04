#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { feedConfig as cfg } from '../config/feed.mjs';
import { dataFile, readJson, writeJson, updateStatus, todayIn } from '../lib/store.mjs';
import { mergeRun } from '../lib/merge.mjs';

export function main() {
  const today = todayIn(cfg.timezone);
  const { candidates = [] } = readJson(dataFile('candidates.json'), {});
  const curated = readJson(dataFile('curated.json'), null);
  const items = readJson(dataFile('items.json'), []);
  const dropped = readJson(dataFile('dropped.json'), []);

  if (!curated) {
    updateStatus('curate', { ok: false, message: 'curated.json missing or invalid JSON; items unchanged' });
    updateStatus('merge', { ok: true, message: 'skipped (no curation)', counts: { candidates: candidates.length, kept: 0, dropped: 0, invalid: 0 } });
    console.error('[merge] no curated.json; items unchanged');
    return;
  }

  const result = mergeRun({ candidates, curated, items, dropped, today, cfg, timezone: cfg.timezone, log: console.error });
  if (result.stale) {
    updateStatus('curate', { ok: false, message: 'curated.json is from a previous day; items unchanged' });
    updateStatus('merge', { ok: true, message: 'skipped (stale curation)', counts: result.counts });
    return;
  }

  writeJson(dataFile('items.json'), result.items);
  writeJson(dataFile('dropped.json'), result.dropped);
  updateStatus('curate', { ok: true, message: `kept ${result.counts.kept}, dropped ${result.counts.dropped}, invalid ${result.counts.invalid}` });
  updateStatus('merge', { ok: true, message: `${result.items.length} items retained`, counts: result.counts });
  console.error(`[merge] kept ${result.counts.kept}, dropped ${result.counts.dropped}, invalid ${result.counts.invalid}; ${result.items.length} items total`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
