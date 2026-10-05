#!/usr/bin/env node
// Offline stand-in for the daily-feed-detail skill, for previews and tests.
// Writes "[stub] <title>" plus the start of the queued file as the Vietnamese
// detail and again as the English detail; with a DISCUSSION block, the first
// two comments become a stub discussion on both sides.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, readJson } from '../lib/store.mjs';
import { queueDir } from './detail-prep.mjs';

// One queue DISCUSSION line: `[Source] @author (N pts): text` (see discussionBlock).
const BLOCK_LINE = /^\[(.+?)\] (@\S+)(?: \(\d+ pts\))?: (.*)$/;

export function stubDetail(queueText) {
  const title = (queueText.match(/^title: (.*)$/m)?.[1] ?? 'untitled').slice(0, 120);
  const body = queueText.split('----- ARTICLE TEXT')[1]?.split('----- END ARTICLE TEXT')[0].split('\n').slice(1).join('\n') ?? '';
  const detail = `[stub] ${body.slice(0, 1200).trim()}`.padEnd(220, '.');
  const detailEn = `[stub en] ${body.slice(0, 1200).trim()}`.padEnd(220, '.');
  let out = `[stub] ${title}\n\n${detail}\n\n===== EN =====\n\n${detailEn}\n`;
  const block = queueText.split('----- DISCUSSION')[1]?.split('----- END DISCUSSION')[0] ?? '';
  const quotes = block.split('\n').map((l) => BLOCK_LINE.exec(l.trim())).filter(Boolean).slice(0, 2);
  if (quotes.length === 2) {
    const line = (prefix) => quotes.map(([, source, author, text]) => `- "${prefix}${text.slice(0, 200)}" — ${author}, ${source}`).join('\n');
    out += `\n===== DISCUSSION VI =====\n\n[stub] Hai luồng ý kiến trái chiều quanh bài này.\n${line('[stub] ')}\n`;
    out += `\n===== DISCUSSION EN =====\n\n[stub en] Two opposing takes on this item.\n${line('')}\n`;
  }
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { items = [] } = readJson(join(queueDir(), 'index.json'), {});
  for (const q of items) writeFileSync(join(ROOT, q.output), stubDetail(readFileSync(join(ROOT, q.input), 'utf8')));
  console.error(`[stub-detail] wrote ${items.length} details`);
}
