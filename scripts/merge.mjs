#!/usr/bin/env node
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { feedConfig as cfg } from '../config/feed.mjs';
import { dataFile, readJson, writeJson, updateStatus, todayIn } from '../lib/store.mjs';
import { mergeRun } from '../lib/merge.mjs';

export function main() {
  const today = todayIn(cfg.timezone);
  const { candidates = [] } = readJson(dataFile('candidates.json'), {});
  const curated = readJson(dataFile('curated.json'), null);
  const sightings = readJson(dataFile('sightings.json'), null);
  const items = readJson(dataFile('items.json'), []);
  const dropped = readJson(dataFile('dropped.json'), []);

  const result = mergeRun({ candidates, curated, sightings, items, dropped, today, cfg, timezone: cfg.timezone, log: console.error });
  rmSync(dataFile('sightings.json'), { force: true });
  if (result.stale) {
    if (result.counts.sighted) writeJson(dataFile('items.json'), result.items);
    const why = curated ? 'curated.json is from a previous day, undated or malformed' : 'curated.json missing or invalid JSON';
    updateStatus('curate', { ok: false, message: `${why}; no new items` });
    updateStatus('merge', { ok: true, message: `skipped curation; ${result.counts.sighted} items re-sighted`, counts: result.counts });
    console.error(`[merge] ${why}; ${result.counts.sighted} items re-sighted`);
    return;
  }

  writeJson(dataFile('items.json'), result.items);
  writeJson(dataFile('dropped.json'), result.dropped);
  updateStatus('curate', { ok: true, message: `kept ${result.counts.kept}, dropped ${result.counts.dropped}, invalid ${result.counts.invalid}` });
  updateStatus('merge', { ok: true, message: `${result.items.length} items retained, ${result.counts.sighted} re-sighted`, counts: result.counts });
  console.error(`[merge] kept ${result.counts.kept}, dropped ${result.counts.dropped}, invalid ${result.counts.invalid}, re-sighted ${result.counts.sighted}; ${result.items.length} items total`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (err) {
    // Curation output is untrusted; never let it abort the day's build.
    updateStatus('curate', { ok: false, message: `merge threw: ${err?.message ?? err}; items unchanged` });
    console.error('[merge] unexpected error, items unchanged:', err);
  }
}
