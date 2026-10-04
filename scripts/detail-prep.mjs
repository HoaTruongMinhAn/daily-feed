#!/usr/bin/env node
// Picks the next batch of items that need a Vietnamese detail, fetches their
// article text (cached in data/articles/, never refetched), and writes one
// queue file per item to data/detail-queue/ for the daily-feed-detail skill.
// Prints the batch size to stdout; 0 means nothing left to do today.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedConfig as cfg } from '../config/feed.mjs';
import { ROOT, dataFile, readJson, writeJson, todayIn } from '../lib/store.mjs';
import { selectForDetail, queueFile } from '../lib/detail.mjs';
import { fetchArticleText } from '../lib/article.mjs';

export const articlesDir = () => join(ROOT, 'data', 'articles');
export const queueDir = () => join(ROOT, 'data', 'detail-queue');
export const detailsDir = () => join(ROOT, 'data', 'details');

async function articleText(item, log) {
  const path = join(articlesDir(), `${item.id}.txt`);
  if (existsSync(path)) return readFileSync(path, 'utf8');
  let text = '';
  try {
    text = (await fetchArticleText(item.url, { maxChars: cfg.articleMaxChars })) ?? '';
  } catch (err) {
    log(`[detail-prep] ${item.url}: ${err?.message ?? err}`);
  }
  writeFileSync(path, text);   // an empty file records "tried, nothing usable"
  return text;
}

export async function main({ log = console.error } = {}) {
  const today = todayIn(cfg.timezone);
  const items = readJson(dataFile('items.json'), []);
  for (const dir of [queueDir(), detailsDir()]) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); }
  mkdirSync(articlesDir(), { recursive: true });

  const known = new Set(items.map((i) => i.id));
  for (const f of readdirSync(articlesDir())) if (!known.has(f.replace(/\.txt$/, ''))) rmSync(join(articlesDir(), f));

  const batch = selectForDetail(items, today, cfg);
  const texts = [];
  for (let i = 0; i < batch.length; i += 4) {
    texts.push(...await Promise.all(batch.slice(i, i + 4).map((it) => articleText(it, log))));
  }
  batch.forEach((it, i) => writeFileSync(join(queueDir(), `${it.id}.md`), queueFile(it, texts[i])));
  writeJson(join(queueDir(), 'index.json'), {
    generatedAt: new Date().toISOString(),
    items: batch.map((it) => ({ id: it.id, input: `data/detail-queue/${it.id}.md`, output: `data/details/${it.id}.txt` })),
  });

  const ids = new Set(batch.map((b) => b.id));
  if (ids.size) writeJson(dataFile('items.json'), items.map((i) => (ids.has(i.id) ? { ...i, detailTriedAt: today } : i)));
  log(`[detail-prep] queued ${batch.length} (${texts.filter(Boolean).length} with article text)`);
  return batch.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((n) => console.log(n)).catch((err) => { console.error('[detail-prep] failed:', err); console.log(0); });
}
