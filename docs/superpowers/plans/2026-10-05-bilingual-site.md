# Bilingual Site (VI/EN) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every item and every UI string on the Daily Feed site reads in Vietnamese or English, switched by a header dropdown whose default follows the reader's browser language and time zone.

**Architecture:** The curation skill writes an English summary (`summaryEn`) and the detail skill writes an English detail (`detailEn`) in the same file as the Vietnamese one, both validated by the existing scripts. The site renders both languages into one page as `.l-vi` / `.l-en` span pairs; a tiny classic script in `<head>` sets `data-lang` on `<html>` before first paint, CSS hides the inactive language, and the dropdown flips the attribute and remembers it in `localStorage`. A shared `site/assets/strings.js` holds every UI string for both the Node renderer and the browser script.

**Tech Stack:** Node 22 built-ins only, plain ESM `.mjs`, `node --test`, hand-written browser JS under `site/assets/`, no build tooling.

**Spec:** `docs/superpowers/specs/2026-10-05-bilingual-site-design.md`

## Global Constraints

- No runtime npm dependencies; Node 22 built-ins only.
- Tests never touch the network and never read `data/`; fixtures live in `tests/fixtures/`.
- Pages carry a CSP that allows only same-origin script: no inline `<script>`, no `on*=` attributes. The new `lang.js` is a same-origin file.
- All item text goes through `escapeHtml`, URLs through `safeUrl`. Nothing from storage is assigned to `innerHTML` in `app.js`.
- The decision schema is defined twice (`skills/daily-feed-curate/SKILL.md`, `lib/merge.mjs`) and the detail format twice (`skills/daily-feed-detail/SKILL.md`, `lib/detail.mjs`); each change edits both in the same task.
- `site/assets/state.js` `groupOf` must match `lib/render.mjs` `groupOf` (unchanged here, test still checks).
- Limits copied from the spec: `summaryEn` max 220 chars; `detailEn` 200-4000 chars; marker line exactly `===== EN =====`; `localStorage` key `dailyfeed:lang`; Vietnam time zones `Asia/Ho_Chi_Minh` and `Asia/Saigon`.
- Commit by path only (`git add <files>`), never `git add -A`. Never `git push`. Do not commit rebuilt `site/*.html` or `site/feed.json`; the scheduled runner rebuilds and pushes them.

## Review Focus

1. A stored language value that is not `vi` or `en` (edited storage, older build) must fall back to detection, not break the page. Test in Task 4.
2. A browser without `navigator.languages` (only `navigator.language`), or with neither, must still get a language: `en`. Test in Task 4.
3. `localStorage` that throws (private mode, blocked storage) must not stop `lang.js` from setting a language. Test in Task 4.
4. A detail file with the marker but an empty or too-short English half must be rejected as a whole so the Vietnamese half is not written without its pair and the item is retried. Test in Task 3.
5. A saved card for an item that has only a Vietnamese detail must not store the fallback text as `detailEn`; the rendered fallback block is marked `data-fallback` and `snapshotFromCard` skips it. Render test in Task 5; snapshot acceptance test in Task 6.

---

### Task 1: Shared strings module

**Files:**
- Create: `site/assets/strings.js`
- Modify: `lib/render.mjs:3-8` (move `GROUP_LABEL` and `CATEGORY_LABEL` out, re-export)
- Test: `tests/strings.test.mjs` (new)
- Test: `tests/render.test.mjs:149` (GROUP_LABEL shape change)

**Interfaces:**
- Produces: `LANGS = ['vi','en']`, `LANG_KEY = 'dailyfeed:lang'`, `GROUP_LABEL[group] = { vi, en }`, `CATEGORY_LABEL[category] = string` (English, unchanged values), `STRINGS[key] = { vi, en }` where a value is a string or a function of arguments returning a string, `t(key, lang, ...args) → string`, `hotLabelEn(category) → string`. Later tasks import these from `../site/assets/strings.js` (Node) or `./strings.js` (browser).

- [ ] **Step 1: Write the failing test**

Create `tests/strings.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, LANG_KEY, GROUP_LABEL, CATEGORY_LABEL, STRINGS, t, hotLabelEn } from '../site/assets/strings.js';

test('constants', () => {
  assert.deepEqual(LANGS, ['vi', 'en']);
  assert.equal(LANG_KEY, 'dailyfeed:lang');
  assert.deepEqual(Object.keys(GROUP_LABEL), ['ai', 'testing', 'it', 'humor', 'hot']);
  assert.deepEqual(GROUP_LABEL.hot, { vi: 'Hot trên mạng', en: 'Hot online' });
  assert.equal(CATEGORY_LABEL['ai-tip'], 'AI tip');
});

test('every string has both languages and t() picks one', () => {
  for (const [key, v] of Object.entries(STRINGS)) {
    for (const lang of LANGS) {
      const kind = typeof v[lang];
      assert.ok(kind === 'string' || kind === 'function', `${key}.${lang}`);
    }
  }
  assert.equal(t('save', 'vi'), 'Lưu');
  assert.equal(t('save', 'en'), 'Save');
  assert.equal(t('sourcesCount', 'vi', 3), '3 nguồn');
  assert.equal(t('sourcesCount', 'en', 3), '3 sources');
  assert.equal(t('imported', 'en', { saved: 2, read: 5, skipped: 0 }), 'Imported: 2 saved, 5 read');
  assert.equal(t('imported', 'vi', { saved: 2, read: 5, skipped: 1 }), 'Đã nhập: 2 lưu, 5 đã đọc, bỏ qua 1 mục lỗi');
  assert.equal(t('save', 'xx'), 'Lưu', 'unknown language falls back to Vietnamese');
  assert.equal(t('nope', 'en'), '', 'unknown key is empty, never throws');
});

test('hotLabelEn derives an English label from the slug', () => {
  assert.equal(hotLabelEn('hot-cloud-outage'), 'Cloud outage');
  assert.equal(hotLabelEn('hot-security'), 'Security');
  assert.equal(hotLabelEn('hot-'), 'Hot');
  assert.equal(hotLabelEn('ai-tip'), 'Ai tip', 'non-hot input is still a string, never throws');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/strings.test.mjs`
Expected: FAIL, cannot find module `site/assets/strings.js`.

- [ ] **Step 3: Write the module**

Create `site/assets/strings.js`:

```js
// Every UI string of the site in both languages. Plain data and pure
// functions, no DOM: imported by lib/render.mjs at build time and by
// app.js in the browser (same pattern as state.js).
// Spec: docs/superpowers/specs/2026-10-05-bilingual-site-design.md
export const LANGS = ['vi', 'en'];
export const LANG_KEY = 'dailyfeed:lang';

export const GROUP_LABEL = {
  ai: { vi: 'AI', en: 'AI' },
  testing: { vi: 'Testing', en: 'Testing' },
  it: { vi: 'IT', en: 'IT' },
  humor: { vi: 'Humor', en: 'Humor' },
  hot: { vi: 'Hot trên mạng', en: 'Hot online' },
};

// Core category chips are English terms in both views.
export const CATEGORY_LABEL = {
  'ai-trend': 'AI trend', 'ai-product-idea': 'Product idea', 'ai-tip': 'AI tip',
  'test-automation': 'Automation', 'test-manual': 'Manual testing', 'test-db': 'Database', 'test-api': 'API testing', 'test-perf': 'Performance',
  'it-general': 'IT', humor: 'Humor',
};

export const STRINGS = {
  language: { vi: 'Ngôn ngữ', en: 'Language' },
  all: { vi: 'Tất cả', en: 'All' },
  saved: { vi: 'Đã lưu', en: 'Saved' },
  hotNow: { vi: 'Đang hot', en: 'Hot now' },
  archive: { vi: 'Lưu trữ', en: 'Archive' },
  refreshed: { vi: 'cập nhật', en: 'refreshed' },
  showMore: { vi: 'Xem thêm', en: 'Show more' },
  readHidden: { vi: 'bài đã đọc đang ẩn', en: 'read items hidden' },
  show: { vi: 'Hiện', en: 'Show' },
  allRead: { vi: 'Bạn đã đọc hết. Xem lưu trữ bên dưới.', en: 'You have read everything. See the archive below.' },
  noItems: { vi: 'Hôm nay chưa có bài mới. Xem lưu trữ bên dưới.', en: 'No new items today. Check the archive below.' },
  noSaved: { vi: 'Chưa có bài đã lưu', en: 'No saved items yet' },
  readOriginal: { vi: 'Đọc bài gốc', en: 'Read the original' },
  viOnly: { vi: 'Chỉ có bản tiếng Việt.', en: 'Detail available in Vietnamese only.' },
  sourcesCount: { vi: (n) => `${n} nguồn`, en: (n) => `${n} sources` },
  save: { vi: 'Lưu', en: 'Save' },
  savedBtn: { vi: 'Đã lưu', en: 'Saved' },
  saveItem: { vi: 'Lưu bài', en: 'Save item' },
  unsave: { vi: 'Bỏ lưu', en: 'Unsave' },
  unsaveItem: { vi: 'Bỏ lưu bài', en: 'Unsave item' },
  sourcesLine: { vi: 'Nguồn:', en: 'Sources:' },
  footerNote: {
    vi: (n, failed) => `Lấy từ ${n} nguồn${failed ? ` (${failed} nguồn lỗi lần này)` : ''} · mỗi bài đều dẫn về nơi đăng gốc.`,
    en: (n, failed) => `Refreshed from ${n} sources${failed ? ` (${failed} failed this run)` : ''} · every item links to where it came from.`,
  },
  browserData: { vi: 'Dữ liệu trên trình duyệt này:', en: 'Data in this browser:' },
  export: { vi: 'Xuất', en: 'Export' },
  import: { vi: 'Nhập', en: 'Import' },
  curateFailed: {
    vi: (day) => `Bước chọn bài lỗi ngày ${day}; đang hiển thị các bài trước đó.`,
    en: (day) => `Curation failed on ${day}; showing previous items.`,
  },
  noStorage: { vi: 'Không lưu được trên trình duyệt này', en: 'Cannot save in this browser' },
  cannotSave: { vi: 'Không lưu được bài này', en: 'Cannot save this item' },
  importSize: { vi: 'Tệp quá lớn (tối đa 5 MB)', en: 'File too large (max 5 MB)' },
  importJson: { vi: 'Tệp không phải JSON', en: 'File is not JSON' },
  importFormat: { vi: 'Tệp không đúng định dạng Daily Feed', en: 'File is not a Daily Feed export' },
  imported: {
    vi: (r) => `Đã nhập: ${r.saved} lưu, ${r.read} đã đọc${r.skipped ? `, bỏ qua ${r.skipped} mục lỗi` : ''}`,
    en: (r) => `Imported: ${r.saved} saved, ${r.read} read${r.skipped ? `, ${r.skipped} bad entries skipped` : ''}`,
  },
};

// One string in one language. Unknown language falls back to Vietnamese
// (the no-JS default); an unknown key is '' so a typo never throws in the browser.
export function t(key, lang, ...args) {
  const entry = STRINGS[key];
  if (!entry) return '';
  const v = entry[LANGS.includes(lang) ? lang : 'vi'];
  return typeof v === 'function' ? v(...args) : v;
}

// hot-cloud-outage -> "Cloud outage". The Vietnamese label comes from
// curation; English is derived so the curation schema does not change.
export function hotLabelEn(category) {
  const s = String(category ?? '').replace(/^hot-/, '').replace(/-+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Hot';
}
```

- [ ] **Step 4: Point `lib/render.mjs` at the module**

In `lib/render.mjs`, replace lines 3-8 (the `GROUP_LABEL` and `CATEGORY_LABEL` definitions) with:

```js
import { GROUP_LABEL, CATEGORY_LABEL } from '../site/assets/strings.js';
export { GROUP_LABEL, CATEGORY_LABEL };
```

Line 107 still reads `CATEGORY_LABEL[item.category]`, which works unchanged. Line 140 reads `GROUP_LABEL[g]` for pill text, which now yields an object; fix it temporarily to `GROUP_LABEL[g].vi` (Task 5 replaces this line).

- [ ] **Step 5: Update the one render test that assumes a flat label**

In `tests/render.test.mjs`, change the assertion in `'hot-* items render in the hot group…'`:

```js
  assert.equal(GROUP_LABEL.hot.vi, 'Hot trên mạng');
```

- [ ] **Step 6: Run the tests**

Run: `node --test tests/strings.test.mjs tests/render.test.mjs tests/state.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add site/assets/strings.js lib/render.mjs tests/strings.test.mjs tests/render.test.mjs
git commit -m "Add a shared bilingual strings module for render and app

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: English summary in curation

**Files:**
- Modify: `lib/merge.mjs:9-34` (`validateDecision`), `lib/merge.mjs:100-115` (kept item in `mergeRun`)
- Modify: `scripts/stub-curate.mjs:16-27`
- Modify: `skills/daily-feed-curate/SKILL.md` (schema block and writing rules)
- Test: `tests/merge.test.mjs`, `tests/stub-curate.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: decision field `summaryEn` (string, 1-220 chars, required on `keep: true`); item field `summaryEn` (trimmed string) set by `mergeRun`.

- [ ] **Step 1: Write the failing tests**

In `tests/merge.test.mjs`, change the `keep` helper on line 8 to include the field:

```js
const keep = (c, extra = {}) => ({ id: c.id, keep: true, category: 'ai-tip', title: 'Clean title', titleVi: 'Tiêu đề sạch', summary: 'Tóm tắt ngắn.', summaryEn: 'Short summary.', tags: ['llm'], fit: 4, ...extra });
```

Add to the `'validateDecision accepts a good decision…'` test, after the `bad summary` line:

```js
  assert.ok(validateDecision(keep(c, { summaryEn: undefined }), ids).includes('bad summaryEn'));
  assert.ok(validateDecision(keep(c, { summaryEn: '   ' }), ids).includes('bad summaryEn'));
  assert.ok(validateDecision(keep(c, { summaryEn: 'x'.repeat(221) }), ids).includes('bad summaryEn'));
  assert.deepEqual(validateDecision({ id: c.id, keep: false }, ids), [], 'a drop needs no summaryEn');
```

In the `'mergeRun keeps valid…'` test, after `assert.equal(kept.titleVi, 'Tiêu đề sạch');` add:

```js
  assert.equal(kept.summaryEn, 'Short summary.');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/merge.test.mjs`
Expected: FAIL on `bad summaryEn` (not produced) and `kept.summaryEn` (undefined).

- [ ] **Step 3: Implement validation and merge**

In `lib/merge.mjs` `validateDecision`, after the `bad summary` line add:

```js
    if (typeof d.summaryEn !== 'string' || !d.summaryEn.trim() || d.summaryEn.length > 220) errors.push('bad summaryEn');
```

In `mergeRun`, in the `keptItems.push({ ... })` object, after `summary: d.summary.trim(),` add:

```js
      summaryEn: d.summaryEn.trim(),
```

- [ ] **Step 4: Update the stub curator**

In `scripts/stub-curate.mjs`, after the `summary:` line inside the kept decision add:

```js
      summaryEn: `[stub] ${(c.excerpt || c.title).slice(0, 200)}`,
```

Also update the file's header comment, replacing `and uses the excerpt (or title) as the "summary".` with `and uses the excerpt (or title) as both the Vietnamese and the English "summary".`

- [ ] **Step 5: Run the tests**

Run: `node --test tests/merge.test.mjs tests/stub-curate.test.mjs`
Expected: PASS (the stub test already asserts every stub decision passes `validateDecision`).

- [ ] **Step 6: Update the curation skill**

In `skills/daily-feed-curate/SKILL.md`:

In the frontmatter `description`, replace `writes a Vietnamese title and a 1-2 sentence Vietnamese summary` with `writes a Vietnamese title, a 1-2 sentence Vietnamese summary and a 1-2 sentence English summary`.

In the decision schema JSON block, after the `"summary"` line add:

```json
      "summaryEn": "<1-2 English sentences, max 220 chars, same content as summary: what it is and why it is worth opening>",
```

In `## Writing rules (summary)`, change the heading to `## Writing rules (summary and summaryEn)` and add as the first bullet:

```markdown
- **Two summaries, one meaning.** `summary` is Vietnamese, `summaryEn` is English. Both say the same thing; neither is a word-for-word translation of the other. Every rule below applies to both.
```

In `## Title and summary`, nothing changes (the English title already exists).

- [ ] **Step 7: Commit**

```bash
git add lib/merge.mjs scripts/stub-curate.mjs skills/daily-feed-curate/SKILL.md tests/merge.test.mjs
git commit -m "Curation writes and merge validates an English summary (summaryEn)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: English detail in the detail step

**Files:**
- Modify: `lib/detail.mjs` (`selectForDetail`, `parseDetail`, new `DETAIL_EN_MARKER`)
- Modify: `scripts/detail-merge.mjs:33`
- Modify: `scripts/stub-detail.mjs:9-14`
- Modify: `skills/daily-feed-detail/SKILL.md`
- Test: `tests/detail.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DETAIL_EN_MARKER = '===== EN ====='`; `parseDetail(raw, sourceText)` returns `{ titleVi, detail, detailEn, ungrounded, errors }`, with new error strings `no english detail` and `bad detailEn length N`; `selectForDetail` also returns items that have `detail` but no `detailEn`; item field `detailEn` set by `detail-merge`.

- [ ] **Step 1: Write the failing tests**

In `tests/detail.test.mjs`:

Replace the import line with:

```js
import { selectForDetail, queueFile, parseDetail, ungroundedTokens, sourceTextFor, DETAIL_EN_MARKER } from '../lib/detail.mjs';
```

Add a helper after the `it` helper:

```js
const EN = '\n\n===== EN =====\n\n';
const enBody = 'Paragraph one. '.repeat(20);
```

Replace the `selectForDetail` test with:

```js
test('selectForDetail picks recent items missing either detail, best rank first, within batch and daily budget', () => {
  const items = [
    it('a', { rank: 0.2 }), it('b', { rank: 0.9 }), it('c', { rank: 0.5 }),
    it('d', { detail: 'x', detailEn: 'y' }), it('e', { addedAt: '2026-10-02' }), it('f', { detailTriedAt: '2026-10-04' }),
    it('g', { addedAt: '2026-10-03', rank: 0.1, detailTriedAt: '2026-10-03' }),
    it('h', { rank: 0.7, detail: 'vietnamese only' }),
  ];
  assert.deepEqual(selectForDetail(items, '2026-10-04', cfg).map((i) => i.id), ['b', 'h'], 'h has a Vietnamese detail but no English one, so it is redone');
  const tried = items.map((i) => (['b', 'h'].includes(i.id) ? { ...i, detailTriedAt: '2026-10-04' } : i));
  assert.deepEqual(selectForDetail(tried, '2026-10-04', cfg).map((i) => i.id), [], 'f, b, h used the budget of 3');
  assert.deepEqual(selectForDetail(tried, '2026-10-04', { ...cfg, detailMaxPerDay: 10 }).map((i) => i.id), ['c', 'a']);
  assert.deepEqual(selectForDetail(tried, '2026-10-04', { ...cfg, detailMaxPerDay: 10, detailBatchSize: 5 }).map((i) => i.id), ['c', 'a', 'g']);
});
```

Replace the `'parseDetail splits title from body and enforces limits'` test with:

```js
test('parseDetail splits title, Vietnamese and English halves and enforces limits on each', () => {
  assert.equal(DETAIL_EN_MARKER, '===== EN =====');
  const body = 'Đoạn một. '.repeat(30) + '\n\n\n\n- ý một\n- ý hai';
  const ok = parseDetail(`Tiêu đề tiếng Việt\r\n\r\n${body}\u0007\r\n\r\n===== EN =====\r\n\r\n${enBody}\n\n\n- point one\n`);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.titleVi, 'Tiêu đề tiếng Việt');
  assert.ok(ok.detail.endsWith('- ý một\n- ý hai') && !ok.detail.includes('\n\n\n'));
  assert.ok(ok.detailEn.startsWith('Paragraph one.') && ok.detailEn.endsWith('- point one') && !ok.detailEn.includes('\n\n\n'));
  assert.ok(!ok.detail.includes('EN =====') && !ok.detailEn.includes('EN ====='));
  assert.ok(parseDetail('only a title').errors.includes('no body'));
  assert.deepEqual(parseDetail(`Title\n\n${body}`).errors, ['no english detail'], 'review focus 4: no marker rejects the whole file');
  assert.ok(parseDetail(`Title\n\nshort${EN}${enBody}`).errors.some((e) => e.startsWith('bad detail length')));
  assert.deepEqual(parseDetail(`Title\n\n${body}${EN}`).errors, ['bad detailEn length 0'], 'review focus 4: empty English half');
  assert.ok(parseDetail(`Title\n\n${body}${EN}short`).errors.some((e) => e.startsWith('bad detailEn length')));
  assert.ok(parseDetail(`${'x'.repeat(141)}\n\n${body}${EN}${enBody}`).errors.includes('bad titleVi'));
  assert.ok(parseDetail(`T\n\n${'y'.repeat(4001)}${EN}${enBody}`).errors.some((e) => e.startsWith('bad detail length')));
  assert.ok(parseDetail(`T\n\n${body}${EN}${'y'.repeat(4001)}`).errors.some((e) => e.startsWith('bad detailEn length')));
  const indented = parseDetail(`T\n\n${body}\n  ===== EN =====  \n${enBody}`);
  assert.deepEqual(indented.errors, [], 'marker with surrounding spaces still splits');
});
```

In `'parseDetail rejects two or more ungrounded tokens and reports one'`, change the three `parseDetail(...)` inputs so each has an English half, and add one case where the invented names sit in the English half:

```js
  const body = 'Playwright 1.48 thêm trace viewer v2 vào CLI. '.repeat(6);
  const en = 'Playwright 1.48 adds trace viewer v2 to the CLI. '.repeat(5);
  const ok = parseDetail(`Playwright 1.48 có gì mới\n\n${body}${EN}${en}`, SRC);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.ungrounded, []);
  const one = parseDetail(`Playwright 1.48 có gì mới\n\n${body} Kubernetes.${EN}${en}`, SRC);
  assert.deepEqual(one.errors, []);
  assert.deepEqual(one.ungrounded, ['Kubernetes']);
  const two = parseDetail(`Playwright 1.48 có gì mới\n\n${body} Kubernetes và Cypress.${EN}${en}`, SRC);
  assert.deepEqual(two.errors, ['ungrounded: Kubernetes | Cypress']);
  const twoEn = parseDetail(`Playwright 1.48 có gì mới\n\n${body}${EN}${en} Kubernetes and Cypress.`, SRC);
  assert.deepEqual(twoEn.errors, ['ungrounded: Kubernetes | Cypress'], 'the English half is checked too');
  assert.deepEqual(parseDetail(`Tiêu đề\n\n${body} Kubernetes và Cypress.${EN}${en}`).errors, [], 'no sourceText: no check');
```

In `'a versioned name and its embedded number count as one miss (final review)'`, change the `parseDetail` call to include an English half:

```js
  const en = 'Playwright 1.48 adds trace viewer v2 to the CLI. '.repeat(5);
  assert.deepEqual(parseDetail(`Playwright 1.48 có gì mới\n\n${body} So với GPT-5.5.${EN}${en}`, SRC).errors, [], 'one invented name is a note, not a reject');
```

The two `stubDetail` assertions (`'stubDetail output passes parseDetail'` and inside `sourceTextFor…`) stay as they are; they will fail until the stub writes both halves.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/detail.test.mjs`
Expected: FAIL: `DETAIL_EN_MARKER` undefined, `h` not selected, `no english detail` not produced, stub output rejected.

- [ ] **Step 3: Implement in `lib/detail.mjs`**

Add after `DETAIL_UNGROUNDED_MAX`:

```js
// Separates the Vietnamese and English halves of Claude's detail file.
export const DETAIL_EN_MARKER = '===== EN =====';
const EN_SPLIT = /^[ \t]*===== EN =====[ \t]*$/m;
```

Replace the filter line in `selectForDetail` with:

```js
    .filter((i) => i.addedAt >= since && (!i.detail || !i.detailEn) && i.detailTriedAt !== today)
```

and update its comment to: `// Items added within detailDays that lack a detail in either language and were not already tried today, best rank first, up to what is left of today's budget. An item with only a Vietnamese detail (written before the English half existed) is redone whole.`

Replace `parseDetail` with:

```js
// Claude's output file: line 1 = Vietnamese title, blank line, the Vietnamese
// detail, a line DETAIL_EN_MARKER, then the English detail (each: paragraphs
// separated by blank lines, "- " bullet lines). With `sourceText`, names and
// numbers in the title and both halves are checked against it (see
// ungroundedTokens); more than DETAIL_UNGROUNDED_MAX misses rejects it.
export function parseDetail(raw, sourceText = null) {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  const nl = text.indexOf('\n');
  if (nl < 0) return { errors: ['no body'] };
  const titleVi = text.slice(0, nl).trim();
  const [viPart, ...enParts] = text.slice(nl + 1).split(EN_SPLIT);
  const tidy = (s) => s.replace(/\n{3,}/g, '\n\n').trim();
  const detail = tidy(viPart);
  const detailEn = tidy(enParts.join('\n'));
  const errors = [];
  if (!titleVi || titleVi.length > TITLE_VI_MAX) errors.push('bad titleVi');
  if (detail.length < DETAIL_MIN || detail.length > DETAIL_MAX) errors.push(`bad detail length ${detail.length}`);
  if (!enParts.length) errors.push('no english detail');
  else if (detailEn.length < DETAIL_MIN || detailEn.length > DETAIL_MAX) errors.push(`bad detailEn length ${detailEn.length}`);
  const ungrounded = sourceText === null ? [] : ungroundedTokens(`${titleVi}\n${detail}\n${detailEn}`, sourceText);
  if (ungrounded.length > DETAIL_UNGROUNDED_MAX) errors.push(`ungrounded: ${ungrounded.slice(0, 8).join(' | ')}`);
  return errors.length ? { errors } : { titleVi, detail, detailEn, ungrounded, errors };
}
```

Update the file's header comment line to `// The detail step (Vietnamese and English): pick items, build the per-item queue file Claude reads, and validate the per-item file Claude writes back.`

- [ ] **Step 4: Update `detail-merge` and the stub**

In `scripts/detail-merge.mjs`, replace the `byId.set(id, …)` line with:

```js
    byId.set(id, { ...item, titleVi: parsed.titleVi, detail: parsed.detail, detailEn: parsed.detailEn });
```

and the header comment `attaches titleVi + detail to items` with `attaches titleVi + detail + detailEn to items`.

In `scripts/stub-detail.mjs`, replace `stubDetail` with:

```js
export function stubDetail(queueText) {
  const title = (queueText.match(/^title: (.*)$/m)?.[1] ?? 'untitled').slice(0, 120);
  const body = queueText.split('----- ARTICLE TEXT')[1]?.split('----- END ARTICLE TEXT')[0].split('\n').slice(1).join('\n') ?? '';
  const detail = `[stub] ${body.slice(0, 1200).trim()}`.padEnd(220, '.');
  const detailEn = `[stub en] ${body.slice(0, 1200).trim()}`.padEnd(220, '.');
  return `[stub] ${title}\n\n${detail}\n\n===== EN =====\n\n${detailEn}\n`;
}
```

and its header comment to `// Writes "[stub] <title>" plus the start of the queued file as the Vietnamese detail and again as the English detail.`

- [ ] **Step 5: Run the tests**

Run: `node --test tests/detail.test.mjs`
Expected: PASS.

- [ ] **Step 6: Update the detail skill**

In `skills/daily-feed-detail/SKILL.md`:

Frontmatter `description`: replace `Writes the Vietnamese title and the expandable Vietnamese detail (about 10-20 lines)` with `Writes the Vietnamese title and the expandable detail in Vietnamese and in English (about 10-20 lines each)`.

Replace the `## Output file format` code block with:

```
<Vietnamese title, one line, max 140 chars>

<Vietnamese detail: paragraphs separated by one blank line; a list is lines starting with "- ">

===== EN =====

<English detail: same shape, same points>
```

After that block add:

```markdown
The marker line is exactly `===== EN =====` on its own line. A file without it, or with an English half shorter than 200 characters, is rejected whole and the item is retried another day.
```

In `## Detail`, change the first bullet to:

```markdown
- Two halves, same substance: Vietnamese first, then English after the marker. Each half is roughly 10-20 lines on screen (about 700-2000 characters; hard limits 200-4000). The English half covers the same points in natural English, not a sentence-by-sentence translation. Shorter is fine when the source is short; never pad.
```

In `## Writing rules (detail and title)`, in the **Checked by script** bullet, replace `in your title and detail` with `in your title and both halves of the detail`.

- [ ] **Step 7: Commit**

```bash
git add lib/detail.mjs scripts/detail-merge.mjs scripts/stub-detail.mjs skills/daily-feed-detail/SKILL.md tests/detail.test.mjs
git commit -m "Detail step writes and validates an English detail after a marker line

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Language detection script and CSS

**Files:**
- Create: `site/assets/lang.js`
- Modify: `site/assets/style.css` (append rules)
- Test: `tests/lang.test.mjs` (new)

**Interfaces:**
- Produces: a classic script that, when loaded in a page, sets `data-lang` and `lang` on `<html>`, and exposes `window.DailyFeedLang = { detectLang, applyLang, KEY }`. `detectLang(languages, timeZone, stored) → 'vi' | 'en'`. `applyLang(document, lang)` sets both attributes. CSS classes `.l-vi` / `.l-en` hidden by `html[data-lang]`.

- [ ] **Step 1: Write the failing test**

Create `tests/lang.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LANG_KEY } from '../site/assets/strings.js';

const src = readFileSync(new URL('../site/assets/lang.js', import.meta.url), 'utf8');

// Runs lang.js as a browser would: a classic script against a fake document.
function load({ languages, language, timeZone = 'Europe/Berlin', stored = null, storageThrows = false } = {}) {
  const attrs = {};
  const sandbox = {
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } },
    navigator: {},
    localStorage: { getItem: (k) => { if (storageThrows) throw new Error('blocked'); return k === LANG_KEY ? stored : null; } },
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }) },
  };
  if (languages !== undefined) sandbox.navigator.languages = languages;
  if (language !== undefined) sandbox.navigator.language = language;
  vm.runInNewContext(src, sandbox);
  return { attrs, api: sandbox.DailyFeedLang };
}

test('lang.js is a classic script with no module syntax and exposes detectLang', () => {
  assert.ok(!/^\s*(import|export)\b/m.test(src));
  const { api } = load();
  assert.equal(typeof api.detectLang, 'function');
  assert.equal(api.KEY, LANG_KEY);
});

test('detectLang: stored choice wins, then Vietnamese browser language, then Vietnam time zone, else English', () => {
  const { api: { detectLang } } = load();
  assert.equal(detectLang(['en-US'], 'Europe/Berlin', 'vi'), 'vi');
  assert.equal(detectLang(['vi-VN'], 'Asia/Ho_Chi_Minh', 'en'), 'en');
  assert.equal(detectLang(['en-US', 'vi'], 'Europe/Berlin', null), 'vi');
  assert.equal(detectLang(['VI-vn'], 'Europe/Berlin', null), 'vi', 'case-insensitive');
  assert.equal(detectLang(['vie'], 'Europe/Berlin', null), 'en', 'only the vi tag, not any prefix');
  assert.equal(detectLang(['en-US'], 'Asia/Ho_Chi_Minh', null), 'vi');
  assert.equal(detectLang(['en-US'], 'Asia/Saigon', null), 'vi');
  assert.equal(detectLang(['en-US'], 'Asia/Bangkok', null), 'en');
  assert.equal(detectLang(['en-US'], 'Europe/Berlin', 'xx'), 'en', 'review focus 1: unknown stored value is ignored');
  assert.equal(detectLang(undefined, undefined, undefined), 'en', 'review focus 2: nothing known defaults to English');
  assert.equal(detectLang([42, null], null, null), 'en', 'junk entries are skipped');
});

test('on load it sets data-lang and lang on <html> from the page environment', () => {
  assert.deepEqual(load({ languages: ['vi-VN'] }).attrs, { 'data-lang': 'vi', lang: 'vi' });
  assert.deepEqual(load({ languages: ['en-GB'] }).attrs, { 'data-lang': 'en', lang: 'en' });
  assert.deepEqual(load({ languages: ['en-GB'], timeZone: 'Asia/Ho_Chi_Minh' }).attrs, { 'data-lang': 'vi', lang: 'vi' });
  assert.deepEqual(load({ languages: ['vi-VN'], stored: 'en' }).attrs, { 'data-lang': 'en', lang: 'en' });
  assert.deepEqual(load({ language: 'vi' }).attrs, { 'data-lang': 'vi', lang: 'vi' }, 'review focus 2: navigator.language fallback');
  assert.deepEqual(load({}).attrs, { 'data-lang': 'en', lang: 'en' }, 'review focus 2: no language info at all');
  assert.deepEqual(load({ languages: ['vi-VN'], storageThrows: true }).attrs, { 'data-lang': 'vi', lang: 'vi' }, 'review focus 3: storage that throws is ignored');
});

test('style.css hides the inactive language and shows Vietnamese without JS', () => {
  const css = readFileSync(new URL('../site/assets/style.css', import.meta.url), 'utf8');
  assert.ok(css.includes('html[data-lang="vi"] .l-en'));
  assert.ok(css.includes('html[data-lang="en"] .l-vi'));
  assert.ok(css.includes('html:not([data-lang]) .l-en'));
  assert.ok(css.includes(`html[data-lang="en"] .card--read .card__meta::after { content: 'read'; }`));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/lang.test.mjs`
Expected: FAIL, `lang.js` not found.

- [ ] **Step 3: Write `site/assets/lang.js`**

```js
// Sets the page language before first paint. Loaded synchronously from
// <head> as a classic script (no module syntax, so it is not deferred);
// tests run it with node:vm against a fake document. The dropdown in
// app.js reuses detectLang/applyLang through window.DailyFeedLang.
// Spec: docs/superpowers/specs/2026-10-05-bilingual-site-design.md
(function (global) {
  var KEY = 'dailyfeed:lang';
  var LANGS = ['vi', 'en'];
  var VI_ZONES = ['Asia/Ho_Chi_Minh', 'Asia/Saigon'];

  // stored (a remembered dropdown choice) wins; else Vietnamese when any
  // preferred browser language is vi or the device time zone is Vietnam's;
  // else English.
  function detectLang(languages, timeZone, stored) {
    if (LANGS.indexOf(stored) >= 0) return stored;
    var list = Array.isArray(languages) ? languages : [];
    for (var i = 0; i < list.length; i++) {
      if (typeof list[i] === 'string' && /^vi(-|$)/i.test(list[i])) return 'vi';
    }
    if (VI_ZONES.indexOf(timeZone) >= 0) return 'vi';
    return 'en';
  }

  function applyLang(doc, lang) {
    doc.documentElement.setAttribute('data-lang', lang);
    doc.documentElement.setAttribute('lang', lang);
  }

  global.DailyFeedLang = { detectLang: detectLang, applyLang: applyLang, KEY: KEY };

  if (global.document) {
    var stored = null;
    try { stored = global.localStorage.getItem(KEY); } catch (e) { stored = null; }
    var tz = null;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { tz = null; }
    var nav = global.navigator || {};
    var languages = Array.isArray(nav.languages) ? nav.languages : (nav.language ? [nav.language] : []);
    applyLang(global.document, detectLang(languages, tz, stored));
  }
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Append the CSS**

Append to `site/assets/style.css`:

```css

/* Language pairs: every bilingual text is a .l-vi span and a .l-en span;
   lang.js sets html[data-lang] before paint. Without JS the page is Vietnamese. */
html[data-lang="vi"] .l-en, html[data-lang="en"] .l-vi, html:not([data-lang]) .l-en { display: none; }
html[data-lang="en"] .card--read .card__meta::after { content: 'read'; }
.card__note { margin: 0 0 10px; font-size: 13px; font-style: italic; color: var(--muted); }
.lang {
  font: inherit; font-family: var(--mono); font-size: 13px; color: var(--muted);
  background: transparent; border: 1px solid var(--border); border-radius: 999px;
  padding: 4px 10px; cursor: pointer;
}
.lang:hover { border-color: var(--border-strong); color: var(--text); }
.lang option { color: var(--text); background: var(--bg); }
```

- [ ] **Step 5: Run the tests**

Run: `node --test tests/lang.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add site/assets/lang.js site/assets/style.css tests/lang.test.mjs
git commit -m "Add lang.js (region default, remembered choice) and language CSS

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Bilingual markup in the renderer

**Files:**
- Modify: `lib/render.mjs` (`renderCard`, `renderFeed`, `renderPage`)
- Test: `tests/render.test.mjs`

**Interfaces:**
- Consumes: `GROUP_LABEL`, `CATEGORY_LABEL`, `STRINGS`, `t`, `hotLabelEn` from `site/assets/strings.js` (Task 1); `lang.js` at `${basePath}assets/lang.js` (Task 4).
- Produces: card markup that `app.js` (Task 7) reads back:
  - `h3.card__title > span.l.l-vi` (Vietnamese or English title) and `span.l.l-en` (English title);
  - `span.card__orig.l.l-vi[lang=en]` present only when `titleVi` exists;
  - `span.card__summary.l.l-vi` and `span.card__summary.l.l-en`, the English one carrying `data-fallback=""` when it shows the excerpt or Vietnamese summary;
  - `div.card__detail.l.l-vi` and `div.card__detail.l.l-en` (the latter with `data-fallback=""` and a leading `p.card__note` when `detailEn` is missing), each ending with `p.card__source`;
  - `span.chip` whose content for `hot-*` is a pair, else the English `CATEGORY_LABEL`;
  - `span.card__buzz` containing a pair;
  - `button.card__save` with Vietnamese `aria-label`/`title` and a pair as text;
  - `select#lang.lang` in the header; `<script src="…assets/lang.js">` in `<head>`.

- [ ] **Step 1: Write the failing tests**

In `tests/render.test.mjs`:

Add to the fixture `item` (top of file) the field `summaryEn: 'Summary & detail'`, and add a new fixture after `meme`:

```js
const old = { ...item, id: '4', summaryEn: undefined, excerpt: 'Source excerpt <i>', titleVi: 'Tiêu đề cũ', detail: 'Đoạn cũ. '.repeat(30) };
```

Add a helper near the top:

```js
const pair = (vi, en) => `<span class="l l-vi" lang="vi">${vi}</span><span class="l l-en" lang="en">${en}</span>`;
```

Update existing assertions:

- In `'renderCard without detail links the title; with titleVi…'` replace the body with:

```js
  const plain = renderCard(item);
  assert.ok(!plain.includes('<details') && plain.includes('<h3 class="card__title"><a'));
  assert.ok(plain.includes(pair('Hello &lt;script&gt;alert(1)&lt;/script&gt; &quot;quoted&quot;', 'Hello &lt;script&gt;alert(1)&lt;/script&gt; &quot;quoted&quot;')), 'no titleVi: both sides show the English title');
  assert.ok(!plain.includes('card__orig'));
  const vi = renderCard({ ...item, titleVi: 'Xin chào <b>' });
  assert.ok(vi.includes('<span class="l l-vi" lang="vi">Xin chào &lt;b&gt;</span><span class="l l-en" lang="en">Hello &lt;script&gt;'));
  assert.ok(vi.includes('<span class="card__orig l l-vi" lang="en">Hello &lt;script&gt;'));
```

- In `'renderCard with detail expands in place…'` replace the `Đọc bài gốc` assertion with:

```js
  assert.ok(html.includes('<div class="card__detail l l-vi" lang="vi">') && html.includes('<div class="card__detail l l-en" lang="en">'));
  assert.ok(html.includes('href="https://a.com/x"') && html.includes('>Đọc bài gốc</a>') && html.includes('>Read the original</a>'));
```

- In `'renderCard lists several sources escaped…'` replace the buzz assertion with:

```js
  assert.ok(multi.includes(`<span class="card__buzz">${pair('3 nguồn', '3 sources')}</span>`));
```

- In `'renderCard carries escaped data attributes and a bookmark button…'` replace the button assertion with:

```js
  assert.ok(html.includes(`<button class="card__save" type="button" aria-pressed="false" aria-label="Lưu bài" title="Lưu">${pair('Lưu', 'Save')}</button>`));
```

- In `'renderPage home has the Saved pill…'` replace the last assertion with:

```js
  assert.ok(html.includes('Xem thêm') && html.includes('Show more') && html.includes('bài đã đọc đang ẩn') && html.includes('read items hidden'));
  assert.ok(html.includes('Bạn đã đọc hết. Xem lưu trữ bên dưới.') && html.includes('You have read everything. See the archive below.'));
```

- In `'hot-* items render in the hot group…'` replace the chip assertion with:

```js
  assert.ok(html.includes(`<span class="chip chip--hot">${pair('&lt;img src=x onerror=alert(1)&gt;', 'Security')}</span>`), html);
```

- Replace `'the filter bar has a Hot trên mạng pill'` with:

```js
test('the filter bar pills are bilingual', () => {
  const html = page();
  assert.ok(html.includes(`<button class="pill" data-filter="hot" type="button">${pair('Hot trên mạng', 'Hot online')}</button>`));
  assert.ok(html.includes(`<button class="pill" data-filter="all" type="button">${pair('Tất cả', 'All')}</button>`));
  assert.ok(html.includes(`data-view="saved" type="button" aria-pressed="false">${pair('Đã lưu', 'Saved')} <span data-saved-count></span></button>`));
});
```

Add new tests at the end:

```js
test('renderCard summary is a pair; English falls back to the excerpt, then the Vietnamese summary, marked data-fallback', () => {
  const both = renderCard(item);
  assert.ok(both.includes('<span class="card__summary l l-vi" lang="vi">Tóm tắt &amp; chi tiết</span><span class="card__summary l l-en" lang="en">Summary &amp; detail</span>'));
  const excerpt = renderCard(old);
  assert.ok(excerpt.includes('<span class="card__summary l l-en" lang="en" data-fallback="">Source excerpt &lt;i&gt;</span>'));
  const none = renderCard({ ...old, excerpt: '' });
  assert.ok(none.includes('<span class="card__summary l l-en" lang="en" data-fallback="">Tóm tắt &amp; chi tiết</span>'));
});

test('renderCard detail: English half when present, else the Vietnamese detail with a note, marked data-fallback (review focus 5)', () => {
  const both = renderCard({ ...item, titleVi: 'T', detail: 'Đoạn một.', detailEn: 'Paragraph one.' });
  assert.ok(both.includes('<div class="card__detail l l-vi" lang="vi">\n<p>Đoạn một.</p>'));
  assert.ok(both.includes('<div class="card__detail l l-en" lang="en">\n<p>Paragraph one.</p>'));
  assert.ok(!both.includes('card__note'));
  const fallback = renderCard(old);
  assert.ok(fallback.includes('<div class="card__detail l l-en" lang="en" data-fallback="">\n<p class="card__note">Detail available in Vietnamese only.</p>'));
  assert.ok(fallback.includes('<p>Đoạn cũ.'), 'the Vietnamese text is shown in the English block');
  assert.equal((fallback.match(/card__source/g) ?? []).length, 2, 'each block ends with its own source link');
});

test('renderPage loads lang.js synchronously in <head>, has the dropdown and bilingual chrome', () => {
  const html = page();
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes('<script src="assets/lang.js"></script>'));
  assert.ok(head.indexOf('assets/lang.js') < head.indexOf('assets/style.css'), 'runs before the stylesheet so the attribute is set before paint');
  assert.ok(!head.includes('type="module" src="assets/lang.js"'), 'classic script, not deferred');
  assert.ok(html.includes('<html lang="vi">'));
  assert.ok(html.includes('<select id="lang" class="lang" aria-label="Language">'));
  assert.ok(html.includes('<option value="vi">Tiếng Việt</option>') && html.includes('<option value="en">English</option>'));
  assert.ok(html.includes(pair('Đang hot', 'Hot now')) && html.includes(pair('Lưu trữ', 'Archive')));
  assert.ok(html.includes(pair('Xuất', 'Export')) && html.includes(pair('Nhập', 'Import')));
  assert.ok(!/\son[a-z]+=/i.test(html.replace(/<meta http-equiv[^>]+>/, '')));
  const archive = page({ basePath: '../', isArchive: true, hotNow: [] });
  assert.ok(archive.includes('<script src="../assets/lang.js"></script>'));
  const empty = page({ items: [], hotNow: [] });
  assert.ok(empty.includes(pair('Hôm nay chưa có bài mới. Xem lưu trữ bên dưới.', 'No new items today. Check the archive below.')));
  const failed = page({ status: { curate: { ok: false, at: '2026-10-04T00:10:00Z' } } });
  assert.ok(failed.includes('Curation failed on 2026-10-04') && failed.includes('Bước chọn bài lỗi ngày 2026-10-04'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/render.test.mjs`
Expected: FAIL on the pair markup, dropdown, and `lang.js` assertions.

- [ ] **Step 3: Implement in `lib/render.mjs`**

Change the import block at the top to:

```js
import { sourcesOf } from './candidate.mjs';
import { GROUP_LABEL, CATEGORY_LABEL, LANGS, t, hotLabelEn } from '../site/assets/strings.js';
export { GROUP_LABEL, CATEGORY_LABEL };
```

Add after `safeUrl`:

```js
// A bilingual text: one span per language, both escaped; CSS shows one.
// `cls` adds classes to both spans; `fallbackEn` marks the English span as
// borrowed text (excerpt or Vietnamese) so app.js does not store it as English.
export function pair(vi, en, { cls = '', fallbackEn = false } = {}) {
  const c = cls ? `${cls} l` : 'l';
  const fb = fallbackEn ? ' data-fallback=""' : '';
  return `<span class="${c} l-vi" lang="vi">${escapeHtml(vi)}</span><span class="${c} l-en" lang="en"${fb}>${escapeHtml(en)}</span>`;
}

// Same for a UI string from strings.js.
const tp = (key, ...args) => pair(t(key, 'vi', ...args), t(key, 'en', ...args));
```

Replace `renderCard` from `const titleVi = …` through the `head` assignment with:

```js
  const titleVi = typeof item.titleVi === 'string' && item.titleVi.trim() ? item.titleVi : null;
  const heading = pair(titleVi ?? item.title, item.title);
  const orig = titleVi ? `<span class="card__orig l l-vi" lang="en">${escapeHtml(item.title)}</span>` : '';
  const summaryEn = typeof item.summaryEn === 'string' && item.summaryEn.trim() ? item.summaryEn : null;
  const summary = pair(item.summary, summaryEn ?? (item.excerpt || item.summary), { cls: 'card__summary', fallbackEn: !summaryEn });
  const detailEn = typeof item.detailEn === 'string' && item.detailEn.trim() ? item.detailEn : null;
  const sourceLink = (lang) => `  <p class="card__source">${link(item.url, t('readOriginal', lang), 'card__go')}</p>`;
  const detailBlock = (lang, text, fallback) => `<div class="card__detail l l-${lang}" lang="${lang}"${fallback ? ' data-fallback=""' : ''}>
${fallback ? `<p class="card__note">${escapeHtml(t('viOnly', 'en'))}</p>\n` : ''}${renderDetail(text)}
${sourceLink(lang)}
  </div>`;
  const head = item.detail
    ? `<details class="card__details">
  <summary class="card__head">
    <h3 class="card__title">${heading}</h3>
    ${orig}
    ${summary}
    <span class="card__toggle" aria-hidden="true"></span>
  </summary>
  ${detailBlock('vi', item.detail, false)}
  ${detailBlock('en', detailEn ?? item.detail, !detailEn)}
</details>`
    : `<div class="card__head">
  <h3 class="card__title">${link(item.url, heading)}</h3>
  ${orig}
  ${summary}
</div>`;
```

`link()` escapes its text, which would double-escape the pair. Change `link` to accept pre-rendered HTML through an option:

```js
const link = (href, text, cls = '', { html = false } = {}) => {
  const safe = safeUrl(href);
  const body = html ? text : escapeHtml(text);
  if (!safe) return `<span class="${cls}">${body}</span>`;
  return `<a class="${cls}" href="${escapeHtml(safe)}" target="_blank" rel="noopener">${body}</a>`;
};
```

and in the no-detail branch call `link(item.url, heading, '', { html: true })`.

Replace the `srcLine`, `ownLabel`/`label` and the save button:

```js
  const srcs = sourcesOf(item);
  const srcLine = srcs.length > 1
    ? `<span class="card__src">${escapeHtml(srcs.join(' · '))}</span> <span class="card__buzz">${tp('sourcesCount', srcs.length)}</span>`
    : `<span class="card__src">${escapeHtml(item.sourceName)}</span>`;
  const ownLabel = typeof item.categoryLabel === 'string' ? item.categoryLabel.trim() : '';
  const label = ownLabel ? pair(ownLabel, hotLabelEn(item.category)) : escapeHtml(CATEGORY_LABEL[item.category] || item.category);
```

and in the template: `<span class="chip chip--${group}">${label}</span>` (no extra `escapeHtml`), and

```js
    <button class="card__save" type="button" aria-pressed="false" aria-label="${escapeHtml(t('saveItem', 'vi'))}" title="${escapeHtml(t('save', 'vi'))}">${tp('save')}</button>
```

In `renderFeed`, replace the empty message with:

```js
  if (!dates.length) return `<p class="empty">${tp('noItems')}</p>`;
```

In `renderPage`:

```js
  const filters = ['all', ...Object.keys(GROUP_LABEL)]
    .map((g) => `<button class="pill" data-filter="${g}" type="button">${g === 'all' ? tp('all') : pair(GROUP_LABEL[g].vi, GROUP_LABEL[g].en)}</button>`).join('')
    + `<button class="pill pill--saved" data-view="saved" type="button" aria-pressed="false">${tp('saved')} <span data-saved-count></span></button>`;
  const feedAttrs = !isArchive && pageSize ? ` data-page-size="${Number(pageSize)}"` : '';
  const homeTools = isArchive ? '' : `<div class="feed-tools">
  <button id="feed-more" class="pill" type="button" hidden>${tp('showMore')}</button>
  <p id="read-hidden" hidden><span data-count>0</span> ${tp('readHidden')} · <button class="linkbtn" id="show-read" type="button">${tp('show')}</button></p>
  <p id="all-read" class="empty" hidden>${tp('allRead')}</p>
</div>`;
  const saved = `<section id="saved" hidden><h2>${tp('saved')}</h2><div class="list"></div><p id="saved-empty" class="empty" hidden>${tp('noSaved')}</p></section>`;
  const hot = !isArchive && hotNow.length
    ? `<section id="hot-now"><h2>${tp('hotNow')}</h2><div class="grid">${hotNow.map((it) => renderCard(it, { large: true })).join('\n')}</div></section>`
    : '';
  const archive = archiveDates.length
    ? `<section class="archive"><h2>${tp('archive')}</h2><p>${archiveDates.map((d) => `<a href="${basePath}archive/${d}.html">${d}</a>`).join(' · ')}</p></section>`
    : '';
  const failed = status?.fetch?.failedSources?.length ?? 0;
  const notice = status?.curate && status.curate.ok === false
    ? `<p class="notice">${tp('curateFailed', (status.curate.at ?? '').slice(0, 10))}</p>`
    : '';
  const langSelect = `<select id="lang" class="lang" aria-label="Language">${LANGS.map((l) => `<option value="${l}">${l === 'vi' ? 'Tiếng Việt' : 'English'}</option>`).join('')}</select>`;
```

In the HTML template: insert `<script src="${basePath}assets/lang.js"></script>` immediately after the `<title>` line and before the `<meta name="description">` line (so it precedes every stylesheet link). In the header row replace the date span with:

```html
    <span class="top__tools"><span class="top__date">${tp('refreshed')} ${escapeHtml(String(generatedAt).slice(0, 10))}</span> ${langSelect}</span>
```

Footer:

```html
  <p>${tp('sourcesLine')} ${sourceNames.map(escapeHtml).join(' · ')}</p>
  <p>${tp('footerNote', sourceNames.length, failed)}</p>
  <p class="state-tools" hidden>${tp('browserData')} <button class="linkbtn" id="export" type="button">${tp('export')}</button> · <button class="linkbtn" id="import" type="button">${tp('import')}</button><input id="import-file" type="file" accept="application/json,.json" hidden> <span id="state-msg" role="status"></span></p>
```

Add to `style.css` (same task, it is render-side layout): `.top__tools { display: flex; align-items: center; gap: 10px; }` next to the `.top__date` rule.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/render.test.mjs tests/strings.test.mjs tests/state.test.mjs`
Expected: PASS.

- [ ] **Step 5: Render the site locally and look at it**

Run: `node scripts/build.mjs && npm run serve`
Open `http://localhost:8080/`. Check: the dropdown shows, the page is Vietnamese (no app.js change yet, so the dropdown does nothing); in DevTools set `document.documentElement.dataset.lang = 'en'` and confirm every string flips, cards show English titles with no original line, and older items show the excerpt and the "Vietnamese only" note. Stop the server. Do not commit `site/index.html`, `site/archive/`, or `site/feed.json`.

- [ ] **Step 6: Commit**

```bash
git add lib/render.mjs site/assets/style.css tests/render.test.mjs
git commit -m "Render every item and UI string as a VI/EN pair with a language dropdown

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Saved snapshots carry the English fields

**Files:**
- Modify: `site/assets/state.js:12` (`LIMITS`)
- Test: `tests/state.test.mjs`

**Interfaces:**
- Produces: `LIMITS.summaryEn = 500`, `LIMITS.detailEn = 8000`; `sanitizeSnapshot` keeps both as optional strings (missing → `''`).

- [ ] **Step 1: Write the failing test**

Add to `tests/state.test.mjs`:

```js
test('sanitizeSnapshot keeps summaryEn and detailEn, and accepts a snapshot without them (review focus 5)', () => {
  const full = sanitizeSnapshot(snap(A, { summaryEn: 'Summary', detailEn: 'Paragraph\n\n- point' }));
  assert.equal(full.summaryEn, 'Summary');
  assert.equal(full.detailEn, 'Paragraph\n\n- point');
  const without = sanitizeSnapshot(snap(A));
  assert.equal(without.summaryEn, '');
  assert.equal(without.detailEn, '');
  assert.equal(sanitizeSnapshot(snap(A, { detailEn: 'x'.repeat(8001) })), null);
  assert.equal(sanitizeSnapshot(snap(A, { summaryEn: 'x'.repeat(501) })), null);
  assert.equal(sanitizeSnapshot(snap(A, { summaryEn: 5 })), null);
  const raw = JSON.stringify({ v: 1, read: {}, saved: { [A]: { savedAt: T0, item: snap(A) } } });
  assert.equal(parseState(raw).corrupt, false, 'an export from before the English fields still imports');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/state.test.mjs`
Expected: FAIL: `full.summaryEn` is `undefined`.

- [ ] **Step 3: Implement**

In `site/assets/state.js`, change `LIMITS` to:

```js
export const LIMITS = { title: 500, titleVi: 500, summary: 500, summaryEn: 500, detail: 8000, detailEn: 8000, category: 40, categoryLabel: 40, sourceName: 100, addedAt: 10 };
```

Also update the comment above `sanitizeSnapshot` to list the fields: `// A saved item's copy: id, url, title, titleVi, summary, summaryEn, detail, detailEn, category, categoryLabel, sourceName, tags, addedAt. Unknown fields are dropped; …`.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/state.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/assets/state.js tests/state.test.mjs
git commit -m "Saved snapshots keep summaryEn and detailEn

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Browser script: dropdown, dynamic strings, bilingual saved cards

**Files:**
- Modify: `site/assets/app.js`

**Interfaces:**
- Consumes: `STRINGS`, `t`, `LANGS`, `LANG_KEY`, `GROUP_LABEL`, `CATEGORY_LABEL`, `hotLabelEn` from `./strings.js` (Task 1); `window.DailyFeedLang.applyLang` from `lang.js` (Task 4); card markup contract from Task 5; `LIMITS.summaryEn/detailEn` from Task 6.
- Produces: nothing consumed later. There is no DOM test harness in this repo; verification is manual in the browser (Step 3) plus `npm test` for the pure modules.

- [ ] **Step 1: Replace the string constants and message handling**

In `site/assets/app.js`, replace the import block and the constants `NO_STORAGE`, `CANNOT_SAVE`, `IMPORT_ERROR` with:

```js
import {
  STORAGE_KEY, CORRUPT_KEY, MAX_IMPORT_BYTES, LIMITS, MAX_TAGS, MAX_TAG,
  parseState, prune, markOpened, markSeen, isHiddenOnHome, isSaved, save, unsave, savedList,
  mergeImport, groupOf, isHttpUrl, rebase, isOpeningClick,
} from './state.js';
import { LANGS, LANG_KEY, GROUP_LABEL, CATEGORY_LABEL, t, hotLabelEn } from './strings.js';

const SEEN_MS = 2000;
const SEEN_RATIO = 0.6;
const GROUPS = ['ai', 'testing', 'it', 'humor', 'hot'];
const IMPORT_ERROR = { size: 'importSize', json: 'importJson', format: 'importFormat' };

// ---- language (lang.js already set html[data-lang] before paint)

const root = document.documentElement;
let lang = LANGS.includes(root.dataset.lang) ? root.dataset.lang : 'vi';
const tr = (key, ...args) => t(key, lang, ...args);
```

Replace the `say` helper with a version that remembers what it said so the message can be re-rendered after a language switch:

```js
let message = null; // { key, args } of the status message currently shown
const say = (key, ...args) => {
  message = key ? { key, args } : null;
  const m = $('#state-msg');
  if (m) m.textContent = key ? tr(key, ...args) : '';
};
```

In `persist()`, replace the two uses:

```js
    if (message?.key === 'noStorage') say(null);
  } catch {
    storageOk = false;
    say('noStorage');
  }
```

In `onCardClick`: `if (saving && !isSaved(state, id)) say('cannotSave');`

In `importState`: `say(IMPORT_ERROR.size)` becomes `say('importSize')`; `say(IMPORT_ERROR[res.error])` stays (it now maps to a key); replace the `done` lines with:

```js
  if (storageOk) say('imported', res);
  else { say('imported', res); const m = $('#state-msg'); if (m) m.textContent += ` · ${tr('noStorage')}`; }
```

- [ ] **Step 2: Bilingual saved cards and snapshot**

Add after `linkEl`:

```js
// A bilingual text as two spans, mirroring pair() in lib/render.mjs.
function pairEl(tag, cls, vi, en, { fallbackEn = false } = {}) {
  const mk = (l, text) => {
    const e = el(tag, `${cls ? `${cls} ` : ''}l l-${l}`, text);
    e.lang = l;
    if (l === 'en' && fallbackEn) e.dataset.fallback = '';
    return e;
  };
  return [mk('vi', vi), mk('en', en)];
}
```

Replace `saveButton` and `buildCard` with:

```js
function saveButton() {
  const b = el('button', 'card__save', tr('save'));
  b.type = 'button';
  return b;
}

```

The detail block needs the item's url, so it is a closure inside `buildCard`:

```js
function buildCard(item) {
  const g = groupOf(item.category);
  const card = el('article', 'card');
  card.dataset.group = g;
  card.dataset.id = item.id;
  card.dataset.url = isHttpUrl(item.url) ? item.url : '';
  card.dataset.category = item.category;
  if (item.categoryLabel) card.dataset.categoryLabel = item.categoryLabel;
  card.dataset.added = item.addedAt;
  const meta = el('div', 'card__meta');
  const chip = el('span', `chip chip--${g}`);
  if (item.categoryLabel) chip.append(...pairEl('span', '', item.categoryLabel, hotLabelEn(item.category)));
  else if (CATEGORY_LABEL[item.category]) chip.textContent = CATEGORY_LABEL[item.category];
  else chip.append(...pairEl('span', '', GROUP_LABEL[g].vi, GROUP_LABEL[g].en));
  meta.append(chip, el('span', 'card__src', item.sourceName), saveButton());
  const title = el('h3', 'card__title');
  const parts = [title];
  if (item.titleVi) {
    const orig = el('span', 'card__orig l l-vi', item.title);
    orig.lang = 'en';
    parts.push(orig);
  }
  const summaryEn = item.summaryEn || item.summary;
  parts.push(...pairEl('span', 'card__summary', item.summary, summaryEn, { fallbackEn: !item.summaryEn }));
  const heading = pairEl('span', '', item.titleVi || item.title, item.title);
  const detailBlock = (l, text, fallback) => {
    const body = el('div', `card__detail l l-${l}`);
    body.lang = l;
    if (fallback) { body.dataset.fallback = ''; body.append(el('p', 'card__note', t('viOnly', 'en'))); }
    appendDetail(body, text);
    const src = el('p', 'card__source');
    src.append(linkEl(item.url, t('readOriginal', l), 'card__go'));
    body.append(src);
    return body;
  };
  let head;
  if (item.detail) {
    title.append(...heading);
    head = el('details', 'card__details');
    const summary = el('summary', 'card__head');
    const toggle = el('span', 'card__toggle');
    toggle.setAttribute('aria-hidden', 'true');
    summary.append(...parts, toggle);
    head.append(summary, detailBlock('vi', item.detail, false), detailBlock('en', item.detailEn || item.detail, !item.detailEn));
  } else {
    const a = linkEl(item.url, '');
    a.append(...heading);
    title.append(a);
    head = el('div', 'card__head');
    head.append(...parts);
  }
  const foot = el('div', 'card__foot');
  const tags = el('span', 'tags');
  tags.append(...item.tags.map((tg) => el('span', 'tag', tg)));
  foot.append(tags);
  card.append(meta, head, foot);
  return card;
}
```

Replace `detailText` and `snapshotFromCard` with:

```js
// Rebuilds the detail text of one language block; '' for a fallback block
// (borrowed Vietnamese text must not be stored as English).
function detailText(card, l) {
  const body = card.querySelector(`.card__detail.l-${l}`);
  if (!body || (l === 'en' && body.hasAttribute('data-fallback'))) return '';
  const blocks = [];
  for (const child of body.children) {
    if (child.classList.contains('card__source') || child.classList.contains('card__note')) continue;
    if (child.tagName === 'UL') blocks.push([...child.children].map((li) => `- ${inlineText(li)}`).join('\n'));
    else if (child.tagName === 'P') blocks.push(inlineText(child));
  }
  return blocks.filter(Boolean).join('\n\n');
}

function snapshotFromCard(card) {
  const clip = (key, s) => s.slice(0, LIMITS[key]);
  const orig = textOf(card, '.card__orig');
  const summaryEnEl = card.querySelector('.card__summary.l-en');
  return {
    id: card.dataset.id,
    // A link too long to store is dropped rather than refusing the save.
    url: (card.dataset.url || '').length > 2000 ? '' : card.dataset.url || '',
    // The `||` fallbacks read a card rendered before the language pairs existed.
    title: clip('title', textOf(card, '.card__title .l-en') || orig || textOf(card, '.card__title')),
    titleVi: orig ? clip('titleVi', textOf(card, '.card__title .l-vi') || textOf(card, '.card__title')) : '',
    summary: clip('summary', textOf(card, '.card__summary.l-vi') || textOf(card, '.card__summary')),
    summaryEn: summaryEnEl && !summaryEnEl.hasAttribute('data-fallback') ? clip('summaryEn', summaryEnEl.textContent.trim()) : '',
    detail: clip('detail', detailText(card, 'vi')),
    detailEn: clip('detailEn', detailText(card, 'en')),
    category: clip('category', card.dataset.category || ''),
    categoryLabel: clip('categoryLabel', card.dataset.categoryLabel || ''),
    sourceName: clip('sourceName', textOf(card, '.card__src')),
    addedAt: clip('addedAt', card.dataset.added || ''),
    tags: [...card.querySelectorAll('.tag')].slice(0, MAX_TAGS).map((tg) => tg.textContent.trim().slice(0, MAX_TAG)),
  };
}
```

Replace `syncSaveButtons` with:

```js
function syncSaveButtons() {
  document.querySelectorAll('.card__save').forEach((b) => {
    const on = isSaved(state, b.closest('.card')?.dataset.id);
    b.setAttribute('aria-pressed', String(on));
    b.textContent = tr(on ? 'savedBtn' : 'save');
    b.title = tr(on ? 'unsave' : 'save');
    b.setAttribute('aria-label', tr(on ? 'unsaveItem' : 'saveItem'));
  });
  const n = Object.keys(state.saved).length;
  document.querySelectorAll('[data-saved-count]').forEach((s) => { s.textContent = `(${n})`; });
}
```

Add the dropdown wiring in the `// ---- init` section, after the `#import` listeners:

```js
// Language dropdown: flips html[data-lang] (CSS does the rest), remembers
// the choice, and refreshes the few strings this script sets itself.
const langSel = $('#lang');
function setLang(next) {
  if (!LANGS.includes(next)) return;
  lang = next;
  if (window.DailyFeedLang) window.DailyFeedLang.applyLang(document, lang);
  else { root.dataset.lang = lang; root.lang = lang; }
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* remembered for this page only */ }
  if (langSel) langSel.value = lang;
  syncSaveButtons();
  if (message) say(message.key, ...message.args);
}
if (langSel) {
  langSel.value = lang;
  langSel.addEventListener('change', () => setLang(langSel.value));
}
```

Update the header comment of the file: add a line `// Language: lang.js sets html[data-lang] before paint; strings.js holds every UI string; this file wires the dropdown and re-renders the strings it sets itself.` and the spec reference `docs/superpowers/specs/2026-10-05-bilingual-site-design.md`.

- [ ] **Step 3: Verify in the browser**

Run: `npm test` (everything still passes; this task has no unit test of its own), then `node scripts/build.mjs && npm run serve` and open `http://localhost:8080/`:

1. Page loads in the language your browser/timezone implies; the dropdown shows it.
2. Switch to English: every chrome string, card title, summary, detail, "Read the original", source count, save button, and the footer flip without reload. Switch back.
3. Reload: the chosen language persists. DevTools → Application → Local Storage shows `dailyfeed:lang`.
4. Save a card in English mode, open Saved: the card shows English; switch to Vietnamese: it shows Vietnamese. In DevTools run `JSON.parse(localStorage.getItem('dailyfeed:v1')).saved` and confirm the snapshot has `summaryEn`/`detailEn` for a new item and `''` for an old one.
5. Save an old item (one with the "Vietnamese only" note), switch languages: the note still renders from the saved snapshot.
6. Import an export file made before this change (any JSON with `v:1`): no error.
7. Open an archive page: dropdown present and working.
8. DevTools console: no errors, no CSP violations.

Stop the server. Do not commit `site/index.html`, `site/archive/`, or `site/feed.json`.

- [ ] **Step 4: Commit**

```bash
git add site/assets/app.js
git commit -m "Wire the language dropdown and build bilingual saved cards in app.js

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Documentation

**Files:**
- Modify: `CLAUDE.md`, `README.md`

- [ ] **Step 1: CLAUDE.md**

In the first paragraph, replace `Vietnamese titles with the English original, Vietnamese summaries, and an expandable Vietnamese detail per item` with `bilingual: Vietnamese and English title, summary and expandable detail per item, switched by a header dropdown whose default follows the reader's browser language and time zone`.

In step 2 (**curate**) of Architecture, nothing. In step 3 (**merge**), after `and keep their raw \`sourceTitle\`` add `; kept items carry \`summary\` (Vietnamese) and \`summaryEn\``.

In step 4 (**detail**), replace `writes \`data/details/<id>.txt\` (line 1 Vietnamese title, then the detail)` with `writes \`data/details/<id>.txt\` (line 1 Vietnamese title, the Vietnamese detail, a \`===== EN =====\` line, the English detail)`, and `sets \`titleVi\`/\`detail\` on the item` with `sets \`titleVi\`/\`detail\`/\`detailEn\` on the item; an item with \`detail\` but no \`detailEn\` is re-queued`.

In step 5 (**build**), add a sentence: `Both languages are rendered into every page as \`.l-vi\`/\`.l-en\` span pairs (\`pair\` in \`lib/render.mjs\`); \`site/assets/lang.js\` (classic script in \`<head>\`) sets \`html[data-lang]\` before paint and CSS hides the other language.`

In the paragraph starting `Saved items and read state live only in the reader's browser`, add: `\`site/assets/strings.js\` holds every UI string in both languages and is imported by both \`lib/render.mjs\` and \`app.js\`; \`site/assets/lang.js\` is tested from \`tests/lang.test.mjs\` through \`node:vm\`. The language choice is \`localStorage\` key \`dailyfeed:lang\`.`

In the paragraph about the decision schema, after `\`validateDecision\`)` add `, including \`summaryEn\``; after `the detail file format and limits` add ` (\`DETAIL_EN_MARKER\`)`.

Add to the design docs line: `Bilingual: \`docs/superpowers/specs/2026-10-05-bilingual-site-design.md\`.`

- [ ] **Step 2: README.md**

Replace the first paragraph with:

```markdown
A personal, daily-refreshed feed of AI, testing, IT, and IT-humor links,
in Vietnamese and English: title, one-line summary, and an expandable
10-20 line detail per item, each with a link to the original. A dropdown
in the header switches language; the default follows the browser language
and time zone (Vietnamese for a Vietnamese browser or a Vietnam time zone,
English otherwise) and the choice is remembered in the browser. Static
site on GitHub Pages: https://hoatruongminhan.github.io/daily-feed/
```

In "How it works" step 2 replace `Vietnamese title and summary` with `Vietnamese title, Vietnamese and English summary`; step 4 replace `writes the Vietnamese detail` with `writes the Vietnamese and English detail`. In "Run locally" replace `only write missing Vietnamese details` with `only write missing details`.

Add after the first paragraph of "Saved and read state": `Saved cards keep both languages and follow the dropdown.`

- [ ] **Step 3: Run the whole suite one last time**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "Document the bilingual site, summaryEn/detailEn and the language dropdown

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## After the plan

The deployed page updates on the next scheduled run, which rebuilds `site/` with the new renderer and pushes. Until then the live `index.html` is the old markup served with the new `app.js`; `app.js` tolerates that (`#lang` may be absent, `.l-*` selectors return empty text). The first runs after deploy also re-queue every item that has a Vietnamese detail but no English one, within `detailMaxPerDay`.
