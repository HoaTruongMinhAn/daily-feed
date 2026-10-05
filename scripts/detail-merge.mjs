#!/usr/bin/env node
// Reads the per-item files the daily-feed-detail skill wrote to
// data/details/, validates them, and attaches titleVi + detail + detailEn
// (and discussion + discussionEn when valid) to items.
// Only ids that were queued are read; anything else in the folder is ignored.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedConfig as cfg } from '../config/feed.mjs';
import { dataFile, readJson, writeJson, updateStatus, todayIn } from '../lib/store.mjs';
import { parseDetail, sourceTextFor } from '../lib/detail.mjs';
import { commentsText } from '../lib/comments.mjs';
import { queueDir, detailsDir, articlesDir, commentsDir } from './detail-prep.mjs';

export function main({ log = console.error } = {}) {
  const today = todayIn(cfg.timezone);
  const queued = readJson(join(queueDir(), 'index.json'), { items: [] }).items ?? [];
  const items = readJson(dataFile('items.json'), []);
  const byId = new Map(items.map((i) => [i.id, i]));
  let ok = 0; let missing = 0; let invalid = 0; let ungrounded = 0; let discussed = 0;

  for (const { id } of queued) {
    const item = byId.get(id);
    const path = join(detailsDir(), `${id}.txt`);
    if (!item) continue;
    if (!existsSync(path)) { missing++; continue; }
    const articlePath = join(articlesDir(), `${id}.txt`);
    const article = existsSync(articlePath) ? readFileSync(articlePath, 'utf8') : '';
    const commentsPath = join(commentsDir(), `${id}.json`);
    const cached = existsSync(commentsPath) ? readJson(commentsPath, { comments: [] }).comments ?? [] : [];
    const parsed = parseDetail(readFileSync(path, 'utf8'), sourceTextFor(item, article), cached.length ? commentsText(cached) : null);
    if (parsed.errors.length) {
      invalid++;
      if (parsed.errors.some((e) => e.startsWith('ungrounded'))) ungrounded++;
      log(`[detail-merge] invalid detail for ${id}: ${parsed.errors.join(', ')}`);
      continue;
    }
    for (const w of parsed.warnings) log(`[detail-merge] discussion dropped for ${id}: ${w}`);
    if (parsed.ungrounded.length) log(`[detail-merge] note ${id}: unsupported ${parsed.ungrounded.join(', ')}`);
    const next = { ...item, titleVi: parsed.titleVi, detail: parsed.detail, detailEn: parsed.detailEn };
    if (parsed.discussion) { next.discussion = parsed.discussion; next.discussionEn = parsed.discussionEn; discussed++; }
    byId.set(id, next);
    ok++;
  }

  writeJson(dataFile('items.json'), items.map((i) => byId.get(i.id)));
  for (const dir of [queueDir(), detailsDir()]) rmSync(dir, { recursive: true, force: true });

  const prev = readJson(dataFile('status.json'), {}).detail;
  const sum = prev?.day === today ? { ungrounded: 0, discussed: 0, ...prev.counts } : { written: 0, missing: 0, invalid: 0, ungrounded: 0, discussed: 0 };
  const counts = { written: sum.written + ok, missing: sum.missing + missing, invalid: sum.invalid + invalid, ungrounded: sum.ungrounded + ungrounded, discussed: sum.discussed + discussed };
  updateStatus('detail', { ok: true, day: today, message: `${counts.written} details written today`, counts });
  log(`[detail-merge] batch: ${ok} written (${discussed} with discussion), ${missing} missing, ${invalid} invalid (${ungrounded} ungrounded)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (err) {
    updateStatus('detail', { ok: false, message: `detail-merge threw: ${err?.message ?? err}` });
    console.error('[detail-merge] unexpected error, items unchanged:', err);
  }
}
