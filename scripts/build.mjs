#!/usr/bin/env node
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedConfig as cfg } from '../config/feed.mjs';
import { sources } from '../config/sources.mjs';
import { dataFile, readJson, updateStatus, siteDir, todayIn, daysAgo } from '../lib/store.mjs';
import { renderPage } from '../lib/render.mjs';

export function main() {
  const items = readJson(dataFile('items.json'), []);
  const status = readJson(dataFile('status.json'), {});
  if (!items.length) {
    updateStatus('build', { ok: false, message: 'no items to render' });
    console.error('[build] items.json is empty; refusing to publish a blank site');
    process.exit(1);
  }

  const today = todayIn(cfg.timezone);
  const generatedAt = new Date().toISOString();
  const sourceNames = [...new Set(sources.filter((s) => !s.disabled).map((s) => s.name))];
  const byRank = (a, b) => b.rank - a.rank;

  const feedSince = daysAgo(today, cfg.feedDays - 1);
  const recent = items.filter((i) => i.addedAt >= feedSince).sort(byRank);
  const hotNow = recent.slice(0, cfg.hotNowCount);
  const hotIds = new Set(hotNow.map((i) => i.id));
  const feed = recent.filter((i) => !hotIds.has(i.id));
  const archiveDates = [...new Set(items.map((i) => i.addedAt))].sort().reverse();

  const archiveDir = join(siteDir, 'archive');
  mkdirSync(archiveDir, { recursive: true });
  for (const f of readdirSync(archiveDir)) rmSync(join(archiveDir, f));

  writeFileSync(join(siteDir, 'index.html'), renderPage({
    title: cfg.siteTitle, heading: cfg.siteTitle, items: feed, hotNow, archiveDates, status, sourceNames, generatedAt, basePath: '', isArchive: false,
  }));
  for (const date of archiveDates) {
    writeFileSync(join(archiveDir, `${date}.html`), renderPage({
      title: `${cfg.siteTitle} · ${date}`, heading: `${cfg.siteTitle} · ${date}`,
      items: items.filter((i) => i.addedAt === date).sort(byRank), hotNow: [], archiveDates, status: {}, sourceNames, generatedAt, basePath: '../', isArchive: true,
    }));
  }
  writeFileSync(join(siteDir, 'feed.json'), JSON.stringify({ generatedAt, items: [...items].sort(byRank) }, null, 2) + '\n');

  updateStatus('build', { ok: true, message: `${feed.length + hotNow.length} items on index, ${archiveDates.length} archive pages` });
  console.error(`[build] index: ${hotNow.length} hot + ${feed.length} feed; archive pages: ${archiveDates.length}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
