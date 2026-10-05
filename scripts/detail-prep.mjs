#!/usr/bin/env node
// Picks the next batch of items that need a Vietnamese detail, fetches their
// article text (cached in data/articles/, never refetched) and the top-level
// comments of their discussion threads (cached in data/comments/), and writes
// one queue file per item to data/detail-queue/ for the daily-feed-detail
// skill. Prints the batch size to stdout; 0 means nothing left to do today.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedConfig as cfg } from '../config/feed.mjs';
import { ROOT, dataFile, readJson, writeJson, todayIn } from '../lib/store.mjs';
import { buildBatch, queueFile } from '../lib/detail.mjs';
import { fetchArticleText } from '../lib/article.mjs';
import { fetchComments } from '../lib/comments.mjs';
import { publicLookup } from '../lib/http.mjs';
import { redditCredentials } from '../lib/secrets.mjs';
import { makeRedditClient } from '../lib/reddit-client.mjs';

export const articlesDir = () => join(ROOT, 'data', 'articles');
export const queueDir = () => join(ROOT, 'data', 'detail-queue');
export const detailsDir = () => join(ROOT, 'data', 'details');
export const commentsDir = () => join(ROOT, 'data', 'comments');

// Comments for the item's threads, cached like article text: a file with an
// empty `comments` records "tried, nothing usable".
async function commentsFor(item, ctx, log) {
  const path = join(commentsDir(), `${item.id}.json`);
  if (existsSync(path)) return readJson(path, { comments: [] }).comments ?? [];
  let result = { fetchedAt: new Date().toISOString(), threads: [], comments: [] };
  try {
    result = await fetchComments(item, { ...ctx, log });
  } catch (err) {
    log(`[detail-prep] comments for ${item.id}: ${err?.message ?? err}`);
  }
  writeJson(path, result);
  return result.comments;
}

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
  mkdirSync(commentsDir(), { recursive: true });

  const known = new Set(items.map((i) => i.id));
  for (const f of readdirSync(articlesDir())) if (!known.has(f.replace(/\.txt$/, ''))) rmSync(join(articlesDir(), f));
  for (const f of readdirSync(commentsDir())) if (!known.has(f.replace(/\.json$/, ''))) rmSync(join(commentsDir(), f));

  // Comments first: in backfill they decide whether a detailed item is worth
  // re-queuing. Article text is fetched only for what is actually queued.
  const backfill = process.env.DAILY_FEED_BACKFILL === '1';
  const redditClient = makeRedditClient({ creds: redditCredentials(), lookup: cfg.redditResolvers?.length ? publicLookup(cfg.redditResolvers) : undefined });
  const ctx = { redditClient, cfg };
  const { batch, comments, items: marked } = await buildBatch(items, today, cfg, { backfill, commentsFor: (it) => commentsFor(it, ctx, log) });
  const texts = [];
  for (let i = 0; i < batch.length; i += 4) {
    texts.push(...await Promise.all(batch.slice(i, i + 4).map((it) => articleText(it, log))));
  }
  batch.forEach((it, i) => writeFileSync(join(queueDir(), `${it.id}.md`), queueFile(it, texts[i], comments[i])));
  writeJson(join(queueDir(), 'index.json'), {
    generatedAt: new Date().toISOString(),
    items: batch.map((it) => ({ id: it.id, input: `data/detail-queue/${it.id}.md`, output: `data/details/${it.id}.txt` })),
  });

  if (marked !== items) writeJson(dataFile('items.json'), marked);
  log(`[detail-prep] queued ${batch.length}${backfill ? ' (backfill)' : ''} (${texts.filter(Boolean).length} with article text, ${comments.filter((c) => c.length).length} with comments)`);
  return batch.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((n) => console.log(n)).catch((err) => { console.error('[detail-prep] failed:', err); console.log(0); });
}
