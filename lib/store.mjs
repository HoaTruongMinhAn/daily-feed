import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = process.env.DAILY_FEED_ROOT || fileURLToPath(new URL('..', import.meta.url));
export const dataFile = (name) => join(ROOT, 'data', name);
export const siteDir = join(ROOT, 'site');

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export function updateStatus(step, patch) {
  const path = dataFile('status.json');
  const status = readJson(path, {});
  status[step] = { ...patch, at: new Date().toISOString() };
  writeJson(path, status);
  return status;
}

export function todayIn(timezone, nowMs = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
}

export function daysAgo(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
