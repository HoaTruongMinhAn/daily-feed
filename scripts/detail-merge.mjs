#!/usr/bin/env node
// Reads the per-item files the daily-feed-detail skill wrote to
// data/details/, validates them, and attaches titleVi + detail to items.
// Only ids that were queued are read; anything else in the folder is ignored.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedConfig as cfg } from '../config/feed.mjs';
import { dataFile, readJson, writeJson, updateStatus, todayIn } from '../lib/store.mjs';
import { parseDetail } from '../lib/detail.mjs';
import { queueDir, detailsDir } from './detail-prep.mjs';

export function main({ log = console.error } = {}) {
  const today = todayIn(cfg.timezone);
  const queued = readJson(join(queueDir(), 'index.json'), { items: [] }).items ?? [];
  const items = readJson(dataFile('items.json'), []);
  const byId = new Map(items.map((i) => [i.id, i]));
  let ok = 0; let missing = 0; let invalid = 0;

  for (const { id } of queued) {
    const item = byId.get(id);
    const path = join(detailsDir(), `${id}.txt`);
    if (!item) continue;
    if (!existsSync(path)) { missing++; continue; }
    const parsed = parseDetail(readFileSync(path, 'utf8'));
    if (parsed.errors.length) { invalid++; log(`[detail-merge] invalid detail for ${id}: ${parsed.errors.join(', ')}`); continue; }
    byId.set(id, { ...item, titleVi: parsed.titleVi, detail: parsed.detail });
    ok++;
  }

  writeJson(dataFile('items.json'), items.map((i) => byId.get(i.id)));
  for (const dir of [queueDir(), detailsDir()]) rmSync(dir, { recursive: true, force: true });

  const prev = readJson(dataFile('status.json'), {}).detail;
  const sum = prev?.day === today ? prev.counts : { written: 0, missing: 0, invalid: 0 };
  const counts = { written: sum.written + ok, missing: sum.missing + missing, invalid: sum.invalid + invalid };
  updateStatus('detail', { ok: true, day: today, message: `${counts.written} details written today`, counts });
  log(`[detail-merge] batch: ${ok} written, ${missing} missing, ${invalid} invalid`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (err) {
    updateStatus('detail', { ok: false, message: `detail-merge threw: ${err?.message ?? err}` });
    console.error('[detail-merge] unexpected error, items unchanged:', err);
  }
}
