#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { sources } from '../config/sources.mjs';
import { feedConfig as cfg } from '../config/feed.mjs';
import { adapters } from '../lib/sources/index.mjs';
import { fetchJson, fetchText, publicLookup } from '../lib/http.mjs';
import { redditCredentials } from '../lib/secrets.mjs';
import { makeRedditClient } from '../lib/reddit-client.mjs';
import { collect } from '../lib/collect.mjs';
import { dataFile, readJson, writeJson, updateStatus, todayIn } from '../lib/store.mjs';
import { retainedItems } from '../lib/merge.mjs';
import { hotCategoriesFrom } from '../lib/hot.mjs';

export async function main() {
  const now = Date.now();
  const items = readJson(dataFile('items.json'), []);
  const dropped = readJson(dataFile('dropped.json'), []);
  const knownIds = new Set([...items.map((i) => i.id), ...dropped.map((d) => d.id)]);

  const retained = retainedItems(items, todayIn(cfg.timezone, now), cfg);
  const redditClient = makeRedditClient({
    creds: redditCredentials(),
    lookup: cfg.redditResolvers?.length ? publicLookup(cfg.redditResolvers) : undefined,
  });
  console.error(`[fetch] reddit: ${redditClient.mode}`);

  const { candidates, sightings, failed, consulted } = await collect({ sources, adapters, http: { fetchJson, fetchText, redditClient }, now, cfg, knownIds, knownItems: retained });

  if (consulted === 0 || failed.length === consulted) {
    updateStatus('fetch', { ok: false, message: 'every source failed', failedSources: failed, candidates: 0 });
    console.error('[fetch] every source failed; aborting');
    process.exit(1);
  }

  writeJson(dataFile('candidates.json'), { generatedAt: new Date(now).toISOString(), hotCategories: hotCategoriesFrom(retained), candidates });
  writeJson(dataFile('sightings.json'), { generatedAt: new Date(now).toISOString(), sightings });
  updateStatus('fetch', { ok: true, message: `${candidates.length} candidates, ${sightings.length} sightings from ${consulted - failed.length}/${consulted} sources`, failedSources: failed, candidates: candidates.length });
  console.error(`[fetch] wrote ${candidates.length} candidates, ${sightings.length} sightings (${failed.length} sources failed)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
