import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../scripts/daily-feed-run.sh', import.meta.url));
const sh = readFileSync(path, 'utf8');
const skill = readFileSync(new URL('../skills/daily-feed-curate/SKILL.md', import.meta.url), 'utf8');

test('runner is valid bash', () => {
  execFileSync('bash', ['-n', path]);
});

test('--backfill is a manual detail-only flag that tells detail-prep to cover every item', () => {
  assert.match(sh, /--backfill\) BACKFILL=1 ;;/);
  assert.ok(sh.includes('[ "$BACKFILL" = 0 ] || [ "$DETAIL_ONLY" = 1 ] || { echo "--backfill needs --detail-only" >&2; exit 2; }'));
  assert.ok(sh.includes('export DAILY_FEED_BACKFILL="$BACKFILL"'));
  assert.ok(sh.includes('MAX_BATCHES=$([ "$BACKFILL" = 1 ] && echo 60 || echo 20)'));
  assert.ok(sh.includes('for _ in $(seq 1 "$MAX_BATCHES"); do'));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['feed:backfill'], 'bash scripts/daily-feed-run.sh --now --detail-only --backfill');
});

test('runner pins model, effort and fallback per claude step, overridable by env', () => {
  assert.ok(sh.includes('CURATE_MODEL="${DAILY_FEED_CURATE_MODEL:-claude-sonnet-5-5}"'));
  assert.ok(sh.includes('CURATE_EFFORT="${DAILY_FEED_CURATE_EFFORT:-medium}"'));
  assert.ok(sh.includes('DETAIL_MODEL="${DAILY_FEED_DETAIL_MODEL:-claude-sonnet-5-5}"'));
  assert.ok(sh.includes('DETAIL_EFFORT="${DAILY_FEED_DETAIL_EFFORT:-low}"'));
  assert.ok(sh.includes('FALLBACK_MODEL="${DAILY_FEED_FALLBACK_MODEL:-claude-haiku-4-5-20251001}"'));
  const block = (name) => sh.slice(sh.indexOf(`claude -p "/${name}"`), sh.indexOf('--max-turns', sh.indexOf(`claude -p "/${name}"`)));
  assert.match(block('daily-feed-curate'), /--model "\$CURATE_MODEL" --effort "\$CURATE_EFFORT" --fallback-model "\$FALLBACK_MODEL"/);
  assert.match(block('daily-feed-detail'), /--model "\$DETAIL_MODEL" --effort "\$DETAIL_EFFORT" --fallback-model "\$FALLBACK_MODEL"/);
});

test('curate skill documents the hot-* schema the validator enforces', () => {
  for (const s of ['hot-<slug>', 'categoryLabelVi', 'hotEligible', 'hotCategories', '24', 'Runs on']) assert.ok(skill.includes(s), s);
});

test('neither claude step may read local secrets or search the repo (final review I1)', () => {
  for (const name of ['daily-feed-curate', 'daily-feed-detail']) {
    const start = sh.indexOf(`claude -p "/${name}"`);
    const block = sh.slice(start, sh.indexOf('--max-turns', start));
    assert.ok(block.includes('"Read(./config/**)"'), `${name} must deny Read(./config/**)`);
    assert.ok(block.includes('"Grep"') && block.includes('"Glob"'), `${name} must deny Grep and Glob`);
  }
});

test('scheduled run marks the day done only after success, and retries a bounded number of times', () => {
  const mark = sh.indexOf('printf \'%s\' "$TODAY" > "$STATE"');
  assert.ok(mark > sh.indexOf('git push -q origin main'), 'success marker must come after the push');
  assert.ok(sh.includes('MAX_ATTEMPTS="${DAILY_FEED_MAX_ATTEMPTS:-4}"'));
  assert.match(sh, /curate step failed[^\n]*\n\s*FAILED=1/);
  assert.match(sh, /push failed[^\n]*\n\s*FAILED=1/);
  assert.match(sh, /if \[ "\$FAILED" = 0 \]; then\s*\n\s*printf '%s' "\$TODAY" > "\$STATE"/);
});
