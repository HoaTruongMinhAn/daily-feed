import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJson, writeJson, todayIn, daysAgo } from '../lib/store.mjs';

test('readJson falls back on missing or invalid files; writeJson creates dirs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'df-'));
  assert.deepEqual(readJson(join(dir, 'nope.json'), []), []);
  writeJson(join(dir, 'a/b.json'), { x: 1 });
  assert.deepEqual(readJson(join(dir, 'a/b.json'), null), { x: 1 });
  assert.equal(readFileSync(join(dir, 'a/b.json'), 'utf8').endsWith('\n'), true);
  writeJson(join(dir, 'bad.json'), 'x');
  assert.equal(readJson(join(dir, 'bad.json'), 'fb'), 'x');
});

test('todayIn respects the timezone; daysAgo subtracts calendar days', () => {
  const t = Date.parse('2026-10-03T22:00:00Z'); // 05:00 next day in Ho Chi Minh
  assert.equal(todayIn('Asia/Ho_Chi_Minh', t), '2026-10-04');
  assert.equal(todayIn('UTC', t), '2026-10-03');
  assert.equal(daysAgo('2026-10-04', 14), '2026-09-20');
  assert.equal(daysAgo('2026-03-01', 1), '2026-02-28');
});
