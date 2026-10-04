#!/usr/bin/env node
// Offline stand-in for the daily-feed-detail skill, for previews and tests.
// Writes "[stub] <title>" plus the start of the queued file as the detail.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, readJson } from '../lib/store.mjs';
import { queueDir } from './detail-prep.mjs';

export function stubDetail(queueText) {
  const title = (queueText.match(/^title: (.*)$/m)?.[1] ?? 'untitled').slice(0, 120);
  const body = queueText.split('----- ARTICLE TEXT')[1]?.split('\n').slice(1).join('\n') ?? '';
  const detail = `[stub] ${body.slice(0, 1200).trim()}`.padEnd(220, '.');
  return `[stub] ${title}\n\n${detail}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { items = [] } = readJson(join(queueDir(), 'index.json'), {});
  for (const q of items) writeFileSync(join(ROOT, q.output), stubDetail(readFileSync(join(ROOT, q.input), 'utf8')));
  console.error(`[stub-detail] wrote ${items.length} details`);
}
