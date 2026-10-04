# Writing Rules, Grounding Check, and Source Buzz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vietnamese text leads with the answer and invents nothing (rules + a scripted check), and stories seen by several independent sources rank higher without being re-sent to Claude.

**Architecture:** Pure helpers in `lib/` (`buzz`/`rankOf` in score, `sourcesOf` in candidate, `splitSightings` in dedup, `applySightings` in merge, `ungroundedTokens` in detail), wired by the existing scripts. Fetch writes a new hand-off file `data/sightings.json`; merge (the only writer of `items.json` in the main pipeline) applies it. Skills only get prompt text.

**Tech Stack:** Node 22 ESM `.mjs`, `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-10-04-grounding-and-buzz-design.md`

## Global Constraints

- No runtime npm dependencies; Node 22 built-ins only.
- `npm test` never touches the network.
- Never `git add`/`git commit`/`git push` from an interactive session (CLAUDE.md hard rule). Tasks end with "leave changes in the working tree", not a commit.
- All fetched and curated text is untrusted: escape when rendering, validate before merging.
- `buzzPerSource: 0.25`, `buzzMaxExtra: 3`, `DETAIL_UNGROUNDED_MAX = 1`, title-match Jaccard threshold `0.8`.
- Decision schema (`SKILL.md` ↔ `validateDecision`) is unchanged.
- Re-seen items keep their original `addedAt`.

## Review Focus

1. Short titles (1–2 meaningful tokens, e.g. comics) falsely matching an existing item and swallowing a new candidate → title matching against items requires ≥ 3 tokens on the candidate (Task 2 test).
2. Items and candidates written before this change have no `sources`/`sourceTitle` → everything reads through `sourcesOf`, rank of a single-source item is unchanged (Tasks 1, 4, 6 tests).
3. Curation fails or is stale on a day with sightings → sightings still applied and `items.json` written (Task 4 test).
4. The same source sighted twice, or a sighting repeating the item's own url/discussion link → no double count, rank unchanged, malformed entries ignored (Task 4 test).
5. Vietnamese number separators, sentence-start Vietnamese syllables, hyphenated lowercase words, and an empty article cache must not reject a faithful detail (Task 5 test).

---

### Task 1: Rank helpers and the `sources` field

**Files:**
- Modify: `lib/score.mjs`
- Modify: `lib/candidate.mjs`
- Modify: `config/feed.mjs`
- Test: `tests/score.test.mjs`, `tests/dedup.test.mjs` (makeCandidate test), `tests/smoke.test.mjs`

**Interfaces:**
- Produces: `buzz(n: number, cfg) → number`; `rankOf(item: {hotness, fit, sources?, sourceName}, cfg) → number` (4 decimals); `sourcesOf(x) → string[]`; candidates carry `sources: [sourceName]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/score.test.mjs` (extend the import to `import { hotness, isTooOld, ageHours, buzz, rankOf } from '../lib/score.mjs';`):

```js
test('buzz adds buzzPerSource per extra source, capped at buzzMaxExtra, with defaults', () => {
  const c = { buzzPerSource: 0.25, buzzMaxExtra: 3 };
  assert.equal(buzz(1, c), 1);
  assert.equal(buzz(2, c), 1.25);
  assert.equal(buzz(4, c), 1.75);
  assert.equal(buzz(9, c), 1.75, 'capped');
  assert.equal(buzz(0, c), 1, 'never below 1');
  assert.equal(buzz(3, {}), 1.5, 'defaults 0.25 / 3 when cfg lacks them');
});

test('rankOf = hotness * buzz * fit/5, reading old items without sources as one source (review focus 2)', () => {
  const c = { buzzPerSource: 0.25, buzzMaxExtra: 3 };
  assert.equal(rankOf({ hotness: 1, fit: 4, sourceName: 'HN' }, c), 0.8);
  assert.equal(rankOf({ hotness: 1, fit: 4, sourceName: 'HN', sources: ['HN', 'Lobsters'] }, c), 1);
  assert.equal(rankOf({ hotness: 0.5, fit: 3, sourceName: 'HN', sources: [] }, c), 0.3, 'empty sources = one source');
});
```

In `tests/dedup.test.mjs` add to the `makeCandidate fills defaults` test:

```js
  assert.deepEqual(c.sources, ['HN']);
```

and add after it:

```js
test('sourcesOf falls back to [sourceName] for records without sources', () => {
  assert.deepEqual(sourcesOf({ sourceName: 'HN' }), ['HN']);
  assert.deepEqual(sourcesOf({ sourceName: 'HN', sources: [] }), ['HN']);
  assert.deepEqual(sourcesOf({ sourceName: 'HN', sources: ['HN', 'dev.to'] }), ['HN', 'dev.to']);
});
```

with `import { makeCandidate, sourcesOf } from '../lib/candidate.mjs';`.

In `tests/smoke.test.mjs` add:

```js
  assert.equal(feedConfig.buzzPerSource, 0.25);
  assert.equal(feedConfig.buzzMaxExtra, 3);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/score.test.mjs tests/dedup.test.mjs tests/smoke.test.mjs`
Expected: FAIL (`buzz` / `sourcesOf` not exported, config values undefined).

- [ ] **Step 3: Implement**

`lib/candidate.mjs`: in the returned object add `sources: [sourceName],` after `sourceName,`, and append:

```js
// Distinct source names that carried this story; records written before
// `sources` existed count as their single sourceName.
export function sourcesOf(x) {
  return Array.isArray(x?.sources) && x.sources.length ? x.sources : [x?.sourceName];
}
```

`lib/score.mjs`: add at the top `import { sourcesOf } from './candidate.mjs';` and append:

```js
// Independent-source boost: each extra source adds buzzPerSource, up to
// buzzMaxExtra extra sources.
export function buzz(n, { buzzPerSource = 0.25, buzzMaxExtra = 3 } = {}) {
  return 1 + buzzPerSource * Math.min(Math.max(n - 1, 0), buzzMaxExtra);
}

export function rankOf(item, cfg) {
  return Number((item.hotness * buzz(sourcesOf(item).length, cfg) * (item.fit / 5)).toFixed(4));
}
```

`config/feed.mjs`: after `recencyDecayHours` add:

```js
  buzzPerSource: 0.25,     // rank boost per extra independent source
  buzzMaxExtra: 3,         // at most this many extra sources count (max x1.75)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Leave changes in the working tree** (no commit).

---

### Task 2: Dedup unions sources; `splitSightings`

**Files:**
- Modify: `lib/dedup.mjs`
- Test: `tests/dedup.test.mjs`

**Interfaces:**
- Consumes: `sourcesOf` (Task 1).
- Produces: `splitSightings(candidates, items, threshold = 0.8) → { candidates, sightings: Array<{itemId, sourceName, link}> }`.

- [ ] **Step 1: Write the failing tests**

In the existing `dedupeCandidates merges same id …` test, the four candidates share `sourceName: 'HN'`. Add a new test instead:

```js
test('dedupeCandidates unions distinct source names of merged candidates', () => {
  const base = { publishedAt: '2026-10-03T00:00:00Z', categoryHint: 'ai' };
  const a = { ...makeCandidate({ ...base, url: 'https://a.com/p', title: 'Claude ships agent SDK v2', source: 'hn', sourceName: 'Hacker News' }), hotness: 0.9 };
  const b = { ...makeCandidate({ ...base, url: 'https://a.com/p', title: 'Claude ships agent SDK v2', source: 'hn', sourceName: 'Hacker News' }), hotness: 0.5 };
  const c = { ...makeCandidate({ ...base, url: 'https://b.com/p', title: 'Claude ships agent SDK v2 (blog)', source: 'rss', sourceName: 'Lobsters' }), hotness: 0.1 };
  const [out] = dedupeCandidates([a, b, c]);
  assert.deepEqual(out.sources, ['Hacker News', 'Lobsters']);
});

test('splitSightings turns known ids and title matches into sightings (review focus 1)', () => {
  const base = { publishedAt: '2026-10-03T00:00:00Z', categoryHint: 'ai', source: 'rss' };
  const item = { id: idFor('https://a.com/p'), url: 'https://a.com/p', title: 'Clean: Claude ships agent SDK v2', sourceTitle: 'Claude ships the agent SDK v2', sourceName: 'Hacker News' };
  const comic = { id: idFor('https://xkcd.com/1'), url: 'https://xkcd.com/1', title: 'Compiling', sourceName: 'xkcd' };
  const sameId = makeCandidate({ ...base, url: 'https://www.a.com/p/', title: 'whatever', sourceName: 'Lobsters', discussionUrl: 'https://lobste.rs/s/1' });
  const sameTitle = makeCandidate({ ...base, url: 'https://news.site/x', title: 'Claude ships the agent SDK v2', sourceName: 'dev.to' });
  const shortTitle = makeCandidate({ ...base, url: 'https://other.com/c', title: 'Compiling', sourceName: 'Other' });
  const fresh = makeCandidate({ ...base, url: 'https://c.com/new', title: 'Totally new story about databases', sourceName: 'dev.to' });
  const out = splitSightings([sameId, sameTitle, shortTitle, fresh], [item, comic]);
  assert.deepEqual(out.candidates.map((c) => c.url), ['https://other.com/c', 'https://c.com/new'], 'short titles never title-match');
  assert.deepEqual(out.sightings, [
    { itemId: item.id, sourceName: 'Lobsters', link: 'https://lobste.rs/s/1' },
    { itemId: item.id, sourceName: 'dev.to', link: 'https://news.site/x' },
  ]);
  assert.deepEqual(splitSightings([fresh], []).candidates, [fresh]);
});
```

Extend the import: `import { canonicalUrl, idFor, jaccard, titleTokens, dedupeCandidates, filterKnown, splitSightings } from '../lib/dedup.mjs';`

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/dedup.test.mjs`
Expected: FAIL (`splitSightings` not exported; `sources` not unioned).

- [ ] **Step 3: Implement** in `lib/dedup.mjs`

Add `import { sourcesOf } from './candidate.mjs';` at the top (candidate.mjs already imports from dedup.mjs; the cycle is safe because both sides only use hoisted functions at call time). In `absorb`, after `target.extraLinks = [...links];` add:

```js
  target.sources = [...new Set([...sourcesOf(target), ...sourcesOf(other)])];
```

Append:

```js
// A fresh candidate that is a story we already kept (same id, or a title
// close to the item's cleaned or original title) becomes a sighting for
// merge to record, instead of going to Claude again. Titles with fewer than
// three meaningful tokens never title-match: too easy to collide.
export function splitSightings(candidates, items, threshold = 0.8) {
  const ids = new Set(items.map((i) => i.id));
  const titled = items.map((i) => ({ id: i.id, sets: [i.title, i.sourceTitle].filter(Boolean).map(titleTokens) }));
  const rest = [];
  const sightings = [];
  for (const c of candidates) {
    let itemId = ids.has(c.id) ? c.id : null;
    if (!itemId) {
      const t = titleTokens(c.title);
      if (t.size >= 3) itemId = titled.find((k) => k.sets.some((s) => jaccard(s, t) >= threshold))?.id ?? null;
    }
    if (itemId) sightings.push({ itemId, sourceName: c.sourceName, link: c.discussionUrl ?? c.url });
    else rest.push(c);
  }
  return { candidates: rest, sightings };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Leave changes in the working tree.**

---

### Task 3: Collect and fetch produce `data/sightings.json`

**Files:**
- Modify: `lib/collect.mjs`
- Modify: `scripts/fetch.mjs`
- Test: `tests/collect.test.mjs`

**Interfaces:**
- Consumes: `splitSightings` (Task 2).
- Produces: `collect({..., knownItems = []})` returns `{ candidates, sightings, failed, consulted }`; `data/sightings.json` = `{ generatedAt: ISO, sightings }`.

- [ ] **Step 1: Write the failing test** (append to `tests/collect.test.mjs`)

```js
test('collect turns stories already in items into sightings; dropped ids are still discarded', async () => {
  const kept = mk('https://a.com/kept', 'Kept story about Playwright traces');
  const adapters = { f: async () => [mk('https://a.com/kept', 'Kept story about Playwright traces'), mk('https://a.com/dropped', 'dropped one'), mk('https://a.com/new', 'brand new')] };
  const items = [{ ...kept, sourceName: 'HN' }];
  const knownIds = new Set([kept.id, mk('https://a.com/dropped', 'x').id]);
  const out = await collect({ sources: [{ id: 'f', family: 'f', p90: 100, categoryHint: 'it' }], adapters, http: {}, now, cfg: { ...cfg, perSourceCap: 10 }, knownIds, knownItems: items, log: () => {} });
  assert.deepEqual(out.candidates.map((c) => c.title), ['brand new']);
  assert.deepEqual(out.sightings, [{ itemId: kept.id, sourceName: 's', link: 'https://a.com/kept' }]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/collect.test.mjs`
Expected: FAIL (`out.sightings` undefined).

- [ ] **Step 3: Implement**

`lib/collect.mjs`: import `splitSightings` alongside the other dedup imports; signature `export async function collect({ sources, adapters, http, now, cfg, knownIds, knownItems = [], log = console.error })`; replace the `const candidates = …` line with:

```js
  const { candidates: unseen, sightings } = splitSightings(all, knownItems);
  const candidates = dedupeCandidates(filterKnown(unseen, knownIds)).slice(0, cfg.maxCandidates);
```

and return `{ candidates, sightings, failed, consulted }`.

`scripts/fetch.mjs`: pass `knownItems: items` to `collect`, destructure `sightings`, and after writing `candidates.json` add:

```js
  writeJson(dataFile('sightings.json'), { generatedAt: new Date(now).toISOString(), sightings });
```

Change the status message to `` `${candidates.length} candidates, ${sightings.length} sightings from ${consulted - failed.length}/${consulted} sources` `` and the final log to include `${sightings.length} sightings`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Leave changes in the working tree.**

---

### Task 4: Merge applies sightings and stores `sources`/`sourceTitle`

**Files:**
- Modify: `lib/merge.mjs`
- Modify: `scripts/merge.mjs`
- Test: `tests/merge.test.mjs`

**Interfaces:**
- Consumes: `rankOf` (Task 1), `sourcesOf` (Task 1), `todayIn` (`lib/store.mjs`).
- Produces: `applySightings(items, sightingsFile, { today, timezone, cfg, log }) → { items, applied }`; `mergeRun({..., sightings = null})` always applies sightings first, and `counts` gains `sighted`.

- [ ] **Step 1: Write the failing tests**

In the existing `mergeRun keeps valid…` test change the expected counts to `{ candidates: 4, kept: 1, dropped: 2, invalid: 1, sighted: 0 }`, and add:

```js
  assert.equal(kept.sourceTitle, 'T1');
  assert.deepEqual(kept.sources, ['s']);
```

Append (extend the import with `applySightings`):

```js
const old = (n, extra = {}) => ({ ...cand(n, 1), category: 'it-general', title: `T${n}`, summary: 's', tags: [], fit: 4, rank: 0.8, addedAt: '2026-10-02', sources: undefined, ...extra });
const sightingsFile = (sightings, generatedAt = '2026-10-04T00:05:00Z') => ({ generatedAt, sightings });

test('applySightings adds new sources and links once and recomputes rank (review focus 2, 4)', () => {
  const a = old(1);
  const file = sightingsFile([
    { itemId: a.id, sourceName: 'Lobsters', link: 'https://lobste.rs/s/1' },
    { itemId: a.id, sourceName: 'Lobsters', link: 'https://lobste.rs/s/1' },
    { itemId: a.id, sourceName: 's', link: a.url },
    { itemId: 'gone', sourceName: 'X', link: 'https://x.com' },
    null, { itemId: a.id }, { itemId: a.id, sourceName: '  ' },
  ]);
  const out = applySightings([a], file, { today: '2026-10-04', timezone: 'UTC', cfg, log: () => {} });
  assert.equal(out.applied, 1);
  assert.deepEqual(out.items[0].sources, ['s', 'Lobsters']);
  assert.deepEqual(out.items[0].extraLinks, ['https://lobste.rs/s/1']);
  assert.equal(out.items[0].rank, 1, '1 * 1.25 * 4/5');
  assert.equal(out.items[0].addedAt, '2026-10-02', 'never moved to today');
});

test('applySightings ignores a stale or malformed file', () => {
  const a = old(1);
  const sight = [{ itemId: a.id, sourceName: 'Lobsters', link: 'https://lobste.rs/s/1' }];
  for (const f of [sightingsFile(sight, '2026-10-03T00:05:00Z'), sightingsFile(sight, 'nope'), { generatedAt: '2026-10-04T00:05:00Z' }, null]) {
    const out = applySightings([a], f, { today: '2026-10-04', timezone: 'UTC', cfg, log: () => {} });
    assert.equal(out.applied, 0);
    assert.equal(out.items[0], a);
  }
});

test('mergeRun applies sightings even when curation is missing or stale (review focus 3)', () => {
  const a = old(1);
  const sightings = sightingsFile([{ itemId: a.id, sourceName: 'Lobsters', link: 'https://lobste.rs/s/1' }]);
  for (const curated of [null, { generatedAt: '2026-10-03T00:10:00Z', decisions: [] }]) {
    const out = mergeRun({ candidates: [], curated, sightings, items: [a], dropped: [], today: '2026-10-04', cfg, timezone: 'UTC', log: () => {} });
    assert.equal(out.stale, true);
    assert.equal(out.counts.sighted, 1);
    assert.deepEqual(out.items[0].sources, ['s', 'Lobsters']);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/merge.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/merge.mjs`**

Imports: add `import { rankOf } from './score.mjs';` and `import { sourcesOf } from './candidate.mjs';`.

Add before `mergeRun`:

```js
// Records new independent sources for stories already kept (see
// splitSightings). Only today's file counts; items keep their addedAt.
export function applySightings(items, file, { today, timezone = 'UTC', cfg, log = () => {} }) {
  const t = Date.parse(file?.generatedAt);
  if (!Array.isArray(file?.sightings) || !Number.isFinite(t) || todayIn(timezone, t) !== today) {
    if (file) log('[merge] sightings.json is stale or malformed; ignoring');
    return { items, applied: 0 };
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const changed = new Set();
  for (const s of file.sightings) {
    const item = byId.get(s?.itemId);
    const name = typeof s?.sourceName === 'string' ? s.sourceName.trim() : '';
    if (!item || !name) continue;
    const sources = sourcesOf(item);
    const links = item.extraLinks ?? [];
    const link = typeof s.link === 'string' && s.link !== item.url && s.link !== item.discussionUrl && !links.includes(s.link) ? s.link : null;
    const newSource = !sources.includes(name);
    if (!newSource && !link) continue;
    const next = { ...item, sources: newSource ? [...sources, name] : sources, extraLinks: link ? [...links, link] : links };
    next.rank = rankOf(next, cfg);
    byId.set(item.id, next);
    changed.add(item.id);
  }
  return { items: items.map((i) => byId.get(i.id)), applied: changed.size };
}
```

In `mergeRun`: add `sightings = null` to the parameters, and make the first lines:

```js
  const seen = applySightings(items, sightings, { today, timezone, cfg, log });
  items = seen.items;
```

(`items` is a destructured parameter, so reassigning is fine.) In the stale return use `counts: { candidates: candidates.length, kept: 0, dropped: 0, invalid: 0, sighted: seen.applied }` and keep `items` (now the sighted list). In the kept-item object replace the `rank:` line with:

```js
      sourceTitle: c.title,
      sources: sourcesOf(c),
      rank: rankOf({ ...c, fit: d.fit }, cfg),
```

and add `sighted: seen.applied` to the final `counts`.

- [ ] **Step 4: Update `scripts/merge.mjs`**

```js
#!/usr/bin/env node
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { feedConfig as cfg } from '../config/feed.mjs';
import { dataFile, readJson, writeJson, updateStatus, todayIn } from '../lib/store.mjs';
import { mergeRun } from '../lib/merge.mjs';

export function main() {
  const today = todayIn(cfg.timezone);
  const { candidates = [] } = readJson(dataFile('candidates.json'), {});
  const curated = readJson(dataFile('curated.json'), null);
  const sightings = readJson(dataFile('sightings.json'), null);
  const items = readJson(dataFile('items.json'), []);
  const dropped = readJson(dataFile('dropped.json'), []);

  const result = mergeRun({ candidates, curated, sightings, items, dropped, today, cfg, timezone: cfg.timezone, log: console.error });
  rmSync(dataFile('sightings.json'), { force: true });
  if (result.stale) {
    if (result.counts.sighted) writeJson(dataFile('items.json'), result.items);
    const why = curated ? 'curated.json is from a previous day, undated or malformed' : 'curated.json missing or invalid JSON';
    updateStatus('curate', { ok: false, message: `${why}; no new items` });
    updateStatus('merge', { ok: true, message: `skipped curation; ${result.counts.sighted} items re-sighted`, counts: result.counts });
    console.error(`[merge] ${why}; ${result.counts.sighted} items re-sighted`);
    return;
  }

  writeJson(dataFile('items.json'), result.items);
  writeJson(dataFile('dropped.json'), result.dropped);
  updateStatus('curate', { ok: true, message: `kept ${result.counts.kept}, dropped ${result.counts.dropped}, invalid ${result.counts.invalid}` });
  updateStatus('merge', { ok: true, message: `${result.items.length} items retained, ${result.counts.sighted} re-sighted`, counts: result.counts });
  console.error(`[merge] kept ${result.counts.kept}, dropped ${result.counts.dropped}, invalid ${result.counts.invalid}, re-sighted ${result.counts.sighted}; ${result.items.length} items total`);
}
```

Keep the existing `if (process.argv[1] …)` block unchanged.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 6: Leave changes in the working tree.**

---

### Task 5: Grounding check for details

**Files:**
- Modify: `lib/detail.mjs`
- Modify: `scripts/detail-merge.mjs`
- Test: `tests/detail.test.mjs`

**Interfaces:**
- Produces: `ungroundedTokens(text, sourceText) → string[]`; `sourceTextFor(item, articleText = '') → string`; `parseDetail(raw, sourceText = null)` → on success also returns `ungrounded: string[]`; constants `DETAIL_UNGROUNDED_MAX = 1`, `PLAIN_TERMS`.

- [ ] **Step 1: Write the failing tests** (extend import with `ungroundedTokens, sourceTextFor`)

```js
const SRC = 'Playwright 1.48 adds trace viewer v2 to the CLI. It is 37.5% faster on 10,000 tests. See CLAUDE.md and the README on github.com.';

test('ungroundedTokens finds names and numbers missing from the source (review focus 5)', () => {
  assert.deepEqual(ungroundedTokens('Trung Quốc và Anh dùng Playwright 1.48, nhanh hơn 37,5% trên 10.000 test; xem `CLAUDE.md`, README, API, hard-code, github.com.', SRC), []);
  assert.deepEqual(ungroundedTokens('Kết quả: Cypress 13.2 và Kubernetes, 4.200 test, tăng 12,7%.', SRC), ['Cypress', 'Kubernetes', '132', '4200', '127']);
  assert.deepEqual(ungroundedTokens('Năm 2026, Vitest nhanh. Vitest rất tốt.', SRC), ['Vitest', '2026']);
  assert.deepEqual(ungroundedTokens('', SRC), []);
  assert.deepEqual(ungroundedTokens(null, null), []);
});

test('parseDetail rejects two or more ungrounded tokens and reports one', () => {
  const body = 'Playwright 1.48 thêm trace viewer v2 vào CLI. '.repeat(6);
  const ok = parseDetail(`Playwright 1.48 có gì mới\n\n${body}`, SRC);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.ungrounded, []);
  const one = parseDetail(`Playwright 1.48 có gì mới\n\n${body} Kubernetes.`, SRC);
  assert.deepEqual(one.errors, []);
  assert.deepEqual(one.ungrounded, ['Kubernetes']);
  const two = parseDetail(`Playwright 1.48 có gì mới\n\n${body} Kubernetes và Cypress.`, SRC);
  assert.deepEqual(two.errors, ['ungrounded: Kubernetes | Cypress']);
  assert.deepEqual(parseDetail(`Tiêu đề\n\n${body} Kubernetes và Cypress.`).errors, [], 'no sourceText: no check');
});

test('sourceTextFor joins article, titles, excerpt, summary, source and url; empty article still checks against the rest', () => {
  const item = it('a', { title: 'Playwright 1.48 ships', sourceTitle: 'Playwright v1.48 is out', excerpt: 'trace viewer', summary: 'Tóm tắt.' });
  const text = sourceTextFor(item, '');
  for (const part of ['Playwright 1.48 ships', 'Playwright v1.48 is out', 'trace viewer', 'HN', 'https://a.com/a']) assert.ok(text.includes(part));
  assert.deepEqual(ungroundedTokens('Playwright 1.48', text), []);
  assert.deepEqual(parseDetail(stubDetail(queueFile(item, 'short')), sourceTextFor(item, 'short')).errors, [], 'stub output passes the check');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/detail.test.mjs`
Expected: FAIL (exports missing).

- [ ] **Step 3: Implement in `lib/detail.mjs`**

Add after the existing constants:

```js
export const DETAIL_UNGROUNDED_MAX = 1;

// Lowercase terms common enough that naming them is never an invented fact.
export const PLAIN_TERMS = new Set(('ai api apis llm llms ci cd qa ui ux sql url urls http https json yaml it ok pr prs '
  + 'gpu gpus cpu sdk cli mcp rag ide db ml os iot usd eur vnd readme macos linux windows ios android github gitlab '
  + 'ipo ceo cto saas mr html css js ts sla slo devops mlops e2e b2b b2c faq').split(' '));

const digitsOnly = (s) => s.replace(/(\d)[.,](?=\d)/g, '$1');

// Names and numbers in `text` that the source does not contain. A name is an
// ASCII token with a capital after its first letter, a digit, or a
// capitalised word of 6+ letters (so Vietnamese syllables like "Trung" and
// lowercase words like "hard-code" never count). Numbers are decimals or
// 3+ digits, compared with "." and "," removed (78,1 = 78.1; 10.000 = 10,000).
export function ungroundedTokens(text, sourceText) {
  const t = String(text ?? '');
  const src = String(sourceText ?? '');
  const srcLower = src.toLowerCase();
  const srcDigits = digitsOnly(src);
  const out = new Set();
  for (const raw of t.replace(/[`*]/g, ' ').split(/\s+/)) {
    for (const piece of raw.split('/')) {
      const w = piece.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
      if (!w || !/^[\x21-\x7e]+$/.test(w) || !/[A-Za-z]/.test(w)) continue;
      const isName = /[A-Z]/.test(w.slice(1)) || /\d/.test(w) || /^[A-Z][a-z]{5,}$/.test(w);
      if (isName && !PLAIN_TERMS.has(w.toLowerCase()) && !srcLower.includes(w.toLowerCase())) out.add(w);
    }
  }
  for (const m of t.matchAll(/\d+(?:[.,]\d+)+|\d{3,}/g)) {
    const n = m[0].replace(/[.,]/g, '');
    if (!srcDigits.includes(n)) out.add(n);
  }
  return [...out];
}

export function sourceTextFor(item, articleText = '') {
  return [articleText, item.title, item.sourceTitle, item.excerpt, item.summary, item.sourceName, item.url].filter(Boolean).join('\n');
}
```

Note: a name with digits (e.g. `GPT-5.5`) is checked as a name; its digits also go through the number check, which matches when the name does.

Replace `parseDetail`:

```js
export function parseDetail(raw, sourceText = null) {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  const nl = text.indexOf('\n');
  if (nl < 0) return { errors: ['no body'] };
  const titleVi = text.slice(0, nl).trim();
  const detail = text.slice(nl + 1).replace(/\n{3,}/g, '\n\n').trim();
  const errors = [];
  if (!titleVi || titleVi.length > TITLE_VI_MAX) errors.push('bad titleVi');
  if (detail.length < DETAIL_MIN || detail.length > DETAIL_MAX) errors.push(`bad detail length ${detail.length}`);
  const ungrounded = sourceText === null ? [] : ungroundedTokens(`${titleVi}\n${detail}`, sourceText);
  if (ungrounded.length > DETAIL_UNGROUNDED_MAX) errors.push(`ungrounded: ${ungrounded.slice(0, 8).join(' | ')}`);
  return errors.length ? { errors } : { titleVi, detail, ungrounded, errors };
}
```

Update the comment above it: "…then the detail body. With `sourceText`, names and numbers are checked against it (see ungroundedTokens)."

- [ ] **Step 4: Wire `scripts/detail-merge.mjs`**

Import `sourceTextFor` with `parseDetail`, and `articlesDir` with `queueDir, detailsDir`. Add `let ungrounded = 0;` beside the counters. Replace the parse lines with:

```js
    const articlePath = join(articlesDir(), `${id}.txt`);
    const article = existsSync(articlePath) ? readFileSync(articlePath, 'utf8') : '';
    const parsed = parseDetail(readFileSync(path, 'utf8'), sourceTextFor(item, article));
    if (parsed.errors.length) {
      invalid++;
      if (parsed.errors.some((e) => e.startsWith('ungrounded'))) ungrounded++;
      log(`[detail-merge] invalid detail for ${id}: ${parsed.errors.join(', ')}`);
      continue;
    }
    if (parsed.ungrounded.length) log(`[detail-merge] note ${id}: unsupported ${parsed.ungrounded.join(', ')}`);
```

Counts: `const sum = prev?.day === today ? { ungrounded: 0, ...prev.counts } : { written: 0, missing: 0, invalid: 0, ungrounded: 0 };` and `counts` adds `ungrounded: sum.ungrounded + ungrounded`. Batch log adds `${ungrounded} ungrounded`.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 6: Measure on real data (read-only)**

Run:

```bash
node -e '
import("./lib/detail.mjs").then(({ ungroundedTokens, sourceTextFor, DETAIL_UNGROUNDED_MAX }) => {
  const fs = require("fs");
  const items = JSON.parse(fs.readFileSync("data/items.json", "utf8")).filter((i) => i.detail);
  let flagged = 0, rejected = 0;
  for (const i of items) {
    const p = `data/articles/${i.id}.txt`;
    const miss = ungroundedTokens(`${i.titleVi}\n${i.detail}`, sourceTextFor(i, fs.existsSync(p) ? fs.readFileSync(p, "utf8") : ""));
    if (miss.length) { flagged++; console.log(miss.length > DETAIL_UNGROUNDED_MAX ? "REJECT" : "note  ", i.title.slice(0, 50), miss.join(" | ")); }
    if (miss.length > DETAIL_UNGROUNDED_MAX) rejected++;
  }
  console.log({ details: items.length, flagged, rejected });
});'
```

Expected: about 10–15% flagged, fewer rejected; report the list to the owner. Existing details are not re-validated (the check runs only at detail-merge).

- [ ] **Step 7: Leave changes in the working tree.**

---

### Task 6: Render multiple sources

**Files:**
- Modify: `lib/render.mjs`
- Modify: `site/assets/style.css`
- Test: `tests/render.test.mjs`

**Interfaces:**
- Consumes: `sourcesOf` (Task 1).

- [ ] **Step 1: Write the failing test** (append)

```js
test('renderCard lists several sources escaped, single source unchanged (review focus 2)', () => {
  const multi = renderCard({ ...item, sources: ['Hacker News', 'Lobsters', '<b>x</b>'] });
  assert.ok(multi.includes('Hacker News · Lobsters · &lt;b&gt;x&lt;/b&gt;'));
  assert.ok(multi.includes('<span class="card__buzz">3 nguồn</span>'));
  const single = renderCard(item);
  assert.ok(single.includes('<span class="card__src">Hacker News</span>'));
  assert.ok(!single.includes('card__buzz'));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/render.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

`lib/render.mjs`: add `import { sourcesOf } from './candidate.mjs';` at the top. In `renderCard`, before `return`, add:

```js
  const srcs = sourcesOf(item);
  const srcLine = srcs.length > 1
    ? `<span class="card__src">${escapeHtml(srcs.join(' · '))}</span> <span class="card__buzz">${srcs.length} nguồn</span>`
    : `<span class="card__src">${escapeHtml(item.sourceName)}</span>`;
```

and replace `<span class="card__src">${escapeHtml(item.sourceName)}</span>` in the template with `${srcLine}`.

`site/assets/style.css`: after the `.card__fit` rule add:

```css
.card__buzz { padding: 1px 6px; border-radius: 999px; border: 1px solid var(--accent); color: var(--accent); font-size: 11px; }
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Leave changes in the working tree.**

---

### Task 7: Writing rules in both skills; docs

**Files:**
- Modify: `skills/daily-feed-curate/SKILL.md` (replace the "Title and summary" section)
- Modify: `skills/daily-feed-detail/SKILL.md` (add a section before "Done", adjust "Detail")
- Modify: `CLAUDE.md` (architecture steps 1 and 3), `README.md` (pipeline list)

- [ ] **Step 1: Curate skill.** Replace the `## Title and summary` section with:

```markdown
## Title and summary

- Title: English, cleaned. Keep the original meaning; remove site prefixes, ALL CAPS, emoji, trailing "| SiteName". If the original is only a version or a teaser ("v2.1.159", "Day 1", "Big news"), add the subject from `sourceName`, the URL, or the excerpt ("Playwright v1.48 released"); never invent a model, product, or version.
- Keep the article type: a How / Why / Guide / Analysis / Review / Benchmark title stays that type in both languages. Only use "released / launches / ra mắt / phát hành / công bố" when the original says so.
- Vietnamese title (`titleVi`): natural Vietnamese rendering of the cleaned title, one line. Keep product, tool, library and company names, and established English terms (LLM, API, prompt, test case, CI), in English. Not a word-for-word translation; no clickbait.
- Tags: lowercase, 1-3, prefer tool/topic names.

## Writing rules (summary)

- **Answer first.** The first sentence says who did what and what changed or resulted, e.g. "Playwright 1.48 thêm trace viewer mới, mở nhanh hơn với test lớn." Never open with "Bài viết nói về…", "Tác giả cho rằng…", "Theo bài viết…". The optional second sentence gives the one most useful fact or why it matters to the owner.
- **Only what the input says.** Every product, company, feature, number, and version in `titleVi` and `summary` must appear in the candidate's title, excerpt, source name, or URL. Do not add what you know about similar products. If the input is thin, write a shorter summary.
- Keep relative times as written; never add a year the input does not state.
- Do not strengthen claims: "đang thử nghiệm" is not "đã áp dụng", "một số nghiên cứu" is not "nghiên cứu cho thấy". Keep "đầu tiên / duy nhất / hoàn toàn" only when the input says so. Do not expand an acronym the input does not expand.
- Natural Vietnamese, concrete, no markdown, no quotes around the whole text.
```

- [ ] **Step 2: Detail skill.** In `## Detail`, replace the bullet that starts "Concrete and faithful to the source." with:

```markdown
- Open with one answer sentence: who did what and what changed or resulted. No "Bài viết nói về…", "Tác giả cho rằng…" openers, no background first.
```

and add before `## Done`:

```markdown
## Writing rules (detail and title)

- **Only what the queued text says.** Every product, company, feature, number, version, and quote must appear in the queue file (title, summary, excerpt, or article text). Do not fill gaps from what you know about similar tools. If a point is unclear in the source, keep its key words as written instead of interpreting.
- **Thin source, short detail.** If the article text is unavailable or short, write only what the title, summary, and excerpt support and say briefly that the details are in the original. Never pad with general knowledge.
- **No upgrades.** Keep relative times as written and never add a year the source does not state. "đang thử nghiệm" is not "đã áp dụng"; keep "đầu tiên / duy nhất / hoàn toàn / độc lập" only when the source says so. Do not expand acronyms the source does not expand.
- **Title keeps the article type.** A How / Why / Guide / Review / Benchmark title is never turned into "ra mắt / phát hành / công bố". If the item title is only a version or teaser, name the subject from the source name or text.
- **Checked by script.** After you finish, a script compares names (words with inner capitals or digits, long capitalised English words) and numbers (decimals, 3+ digits) in your title and detail against the queue file. A detail with two or more that are not in the source is discarded.
```

- [ ] **Step 3: Docs.** In `CLAUDE.md` architecture step 1, after "drop ids already in `items.json`/`dropped.json`", change to: "turn stories already in `items.json` (same id, or title Jaccard ≥ 0.8 with 3+ tokens) into sightings written to `data/sightings.json`, drop ids in `dropped.json`," and note that dedup unions `sources`. In step 3 add: "applies today's `sightings.json` first (new sources and links on kept items, even when curation is stale), then deletes it; `rank = hotness * buzz(sources) * fit/5` (`rankOf` in `lib/score.mjs`)". In step 4 add: "`parseDetail` also rejects a detail with 2+ names/numbers absent from the source (`ungroundedTokens`)". In `README.md` pipeline step 1 add "stories already kept are recorded as extra sources instead of being re-curated".

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Leave changes in the working tree.**

---

### Task 8: End-to-end verification in a scratch copy

**Files:** none modified in the repo.

- [ ] **Step 1: Copy the repo to the scratchpad** so `data/` (committed memory) is untouched:

```bash
SCR=/private/tmp/claude-504/-Users-minhanhoa-truong-Project-AI-Agent-07-daily-feed/0a3147a6-e5f4-47cf-aa16-5a55eb9cf068/scratchpad/feedcopy
rm -rf "$SCR" && rsync -a --exclude node_modules --exclude .git ./ "$SCR/"
```

- [ ] **Step 2: Run fetch + stub pipeline there**

```bash
cd "$SCR" && DAILY_FEED_ROOT="$SCR" npm run feed:stub
```

Expected: fetch log shows `N sightings`; merge log shows `re-sighted K`; `data/sightings.json` is gone afterwards; build succeeds. Check `node -e 'const i=require("./data/items.json");console.log(i.filter(x=>(x.sources||[]).length>1).map(x=>[x.title,x.sources,x.rank]))'`.

- [ ] **Step 3: Render check.** `DAILY_FEED_ROOT="$SCR" npm run serve` and open `http://localhost:8080`; confirm a multi-source card shows "A · B" and the "N nguồn" pill, and single-source cards look as before.

- [ ] **Step 4: Report** test output, sightings counts, and the grounding measurement from Task 5 Step 6 to the owner. Nothing is committed; the scheduled runner commits on its next run.
