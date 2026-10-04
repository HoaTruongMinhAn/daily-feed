#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { sources } from '../config/sources.mjs';
import { feedConfig as cfg } from '../config/feed.mjs';
import { adapters } from '../lib/sources/index.mjs';
import { fetchJson, fetchText } from '../lib/http.mjs';
import { collect } from '../lib/collect.mjs';
import { dataFile, readJson, writeJson, updateStatus } from '../lib/store.mjs';

export async function main() {
  const now = Date.now();
  const items = readJson(dataFile('items.json'), []);
  const dropped = readJson(dataFile('dropped.json'), []);
  const knownIds = new Set([...items.map((i) => i.id), ...dropped.map((d) => d.id)]);

  const { candidates, failed, consulted } = await collect({ sources, adapters, http: { fetchJson, fetchText }, now, cfg, knownIds });

  if (consulted === 0 || failed.length === consulted) {
    updateStatus('fetch', { ok: false, message: 'every source failed', failedSources: failed, candidates: 0 });
    console.error('[fetch] every source failed; aborting');
    process.exit(1);
  }

  writeJson(dataFile('candidates.json'), { generatedAt: new Date(now).toISOString(), candidates });
  updateStatus('fetch', { ok: true, message: `${candidates.length} candidates from ${consulted - failed.length}/${consulted} sources`, failedSources: failed, candidates: candidates.length });
  console.error(`[fetch] wrote ${candidates.length} candidates (${failed.length} sources failed)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
