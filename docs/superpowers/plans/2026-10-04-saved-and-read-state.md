# Saved Items and Read State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the reader save items for later and hide already-read items from Home, with all state in the browser's `localStorage`.

**Architecture:** The build renders a wider Home window (7 days) with extra `data-*` attributes, a bookmark button per card, a Saved pill and placeholders. Two hand-written ES modules in `site/assets/` do the rest. `state.js` holds pure state logic and is unit-tested from Node. `app.js` wires that state to the DOM: hiding, paging, the seen and opened trackers, the Saved view, and export/import.

**Tech Stack:** Node 22 built-ins (`node --test`), plain browser ES modules, `localStorage`, `IntersectionObserver`. No npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-04-saved-and-read-state-design.md`

## Global Constraints

- No runtime npm dependencies; browser code is plain ESM with no libraries; Node 22 built-ins only.
- `npm test` never touches the network.
- Storage key `dailyfeed:v1`; corrupt raw value copied to `dailyfeed:v1:corrupt`.
- Valid item id: `^[0-9a-f]{40}$`.
- Seen: at least 60% of card (or 60% of viewport for taller cards) visible for 2 continuous seconds while the tab is visible. Seen hides on Home 24h after first seen. Opened (detail expanded or any link in the card clicked) hides on the next load. Opened is never downgraded.
- Hiding is evaluated only on page load; cards never disappear mid-visit.
- `read` entries pruned after 30 days; `saved` never pruned automatically.
- Config: `hotNowDays: 2`, `homeDays: 7`, `homePageSize: 40`, `detailDays: 2` (replaces `feedDays: 2`; `detailDays` keeps Vietnamese-detail generation on the last 2 days, unchanged cost — not in the spec, which missed that `lib/detail.mjs` also read `feedDays`).
- Snapshot limits: `title`, `titleVi`, `summary` ≤ 500 chars; `detail` ≤ 8000; `tags` ≤ 10 × 40; `category` ≤ 40; `sourceName` ≤ 100; `addedAt` ≤ 10. `url` is empty or `http:`/`https:`.
- Import: max 5 MB; merged, never replacing. Saved = union, later `savedAt` wins. Read: `opened` beats `seen`, equal states keep the earlier `at`.
- Nothing from storage or an imported file goes through `innerHTML`; hrefs only after an http(s) check.
- UI strings exactly: `Lưu`, `Bỏ lưu`, `Saved`, `Chưa có bài đã lưu`, `Xem thêm`, `N bài đã đọc đang ẩn · Hiện`, `Bạn đã đọc hết. Xem lưu trữ bên dưới.`, `Dữ liệu trên trình duyệt này`, `Xuất`, `Nhập`, `Đã nhập: X lưu, Y đã đọc`, `bỏ qua Z mục lỗi`, `Không lưu được trên trình duyệt này`, `đã đọc`.
- Commits: stage files by path (never `git add -A`), never push. Do not commit regenerated `site/index.html`, `site/archive/`, `site/feed.json` or `data/`; preview builds go to a temp copy. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Prototype-polluting keys in an imported or stored file.** Keys like `__proto__` or `constructor` in `read`/`saved` must be skipped, not merged, and must not pollute `Object.prototype`. Test in Task 1 (`parseState`) and Task 2 (`mergeImport`).
2. **Clock skew between devices.** If an imported `at`/`savedAt` is in the future, a seen item would otherwise never hide. `prune` clamps any future timestamp to `now`. Test in Task 1.
3. **Items with gaps.** If an item has `titleVi: null`, no `tags`, no `detail`, or an unsafe URL, saving must still work: the snapshot keeps an empty `url` and the card shows a title without a link. Test in Task 1 (`sanitizeSnapshot` accepts empty url and null titleVi) and Task 4 (`data-url=""`).
4. **Hostile text inside a saved snapshot** (e.g. `<img src=x onerror=…>` as a title). It must render as literal text in the Saved view. Covered by the Task 5 manual check, step 6.
5. **Corrupt `localStorage` value** (valid JSON of the wrong shape, e.g. `read` is an array). The page must start clean and keep the raw value. Test in Task 1 (`parseState` → `corrupt: true`); browser behaviour in Task 5 manual check, step 8.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `site/assets/state.js` | create | Pure state functions: parse, prune, read rules, save, snapshot validation, import merge |
| `tests/state.test.mjs` | create | Unit tests for `state.js` |
| `lib/home.mjs` | create | `selectHome(items, today, cfg)` → `{ hotNow, feed }` |
| `tests/home.test.mjs` | create | Unit tests for `selectHome` |
| `config/feed.mjs` | modify | `feedDays` → `hotNowDays`, `homeDays`, `homePageSize`, `detailDays` |
| `scripts/build.mjs` | modify | Use `selectHome`; pass `pageSize` |
| `lib/detail.mjs` | modify | `cfg.feedDays` → `cfg.detailDays` |
| `lib/render.mjs` | modify | Card data attributes and bookmark; Saved pill, placeholders, footer tools, module script |
| `site/assets/style.css` | modify | Styles for new controls |
| `site/assets/app.js` | create | DOM wiring |
| `tests/smoke.test.mjs`, `tests/detail.test.mjs`, `tests/render.test.mjs` | modify | Updated expectations |
| `CLAUDE.md`, `README.md` | modify | Document the client-state layer |

---

### Task 1: `state.js`: parse, prune, read rules, save, snapshots

**Files:**
- Create: `site/assets/state.js`
- Test: `tests/state.test.mjs`

**Interfaces:**
- Consumes: `groupOf`, `CATEGORY_LABEL` from `lib/render.mjs` (test only).
- Produces (all exported from `site/assets/state.js`):
  - Constants: `STORAGE_KEY = 'dailyfeed:v1'`, `CORRUPT_KEY = 'dailyfeed:v1:corrupt'`, `DAY_MS`, `SEEN_GRACE_MS` (24h), `READ_TTL_MS` (30d), `MAX_IMPORT_BYTES` (5 MB), `LIMITS` (object of string-field max lengths), `MAX_TAGS = 10`, `MAX_TAG = 40`.
  - `isId(id) → boolean`, `isHttpUrl(raw) → boolean`, `groupOf(category) → 'ai'|'testing'|'it'|'humor'`, `emptyState() → { v: 1, read: {}, saved: {} }`.
  - `sanitizeSnapshot(obj) → snapshot | null`.
  - `normalize(obj) → { state, skipped } | null`: internal shape check, exported for Task 2.
  - `parseState(raw: string|null) → { state, corrupt: boolean }`.
  - `prune(state, now) → state`.
  - `markOpened(state, id, now) → state`, `markSeen(state, id, now) → state`.
  - `isHiddenOnHome(state, id, now) → boolean`.
  - `isSaved(state, id) → boolean`, `save(state, snapshot, now) → state`, `unsave(state, id) → state`, `savedList(state) → snapshot[]` (newest `savedAt` first).
  - All state functions return a new object (or the same object when nothing changes); none mutate their input.

- [ ] **Step 1: Write the failing tests**

Create `tests/state.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, CORRUPT_KEY, DAY_MS, emptyState, parseState, prune, markOpened, markSeen, isHiddenOnHome,
  isSaved, save, unsave, savedList, sanitizeSnapshot, groupOf, isHttpUrl, isId,
} from '../site/assets/state.js';
import { groupOf as renderGroupOf, CATEGORY_LABEL } from '../lib/render.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const T0 = Date.UTC(2026, 9, 4, 8, 0, 0);
const snap = (id = A, extra = {}) => ({
  id, url: 'https://a.com/x', title: 'Hello', titleVi: 'Xin chào', summary: 'Tóm tắt', detail: 'Đoạn một\n\n- ý',
  category: 'ai-tip', sourceName: 'Hacker News', tags: ['llm'], addedAt: '2026-10-04', ...extra,
});

test('keys and id format', () => {
  assert.equal(STORAGE_KEY, 'dailyfeed:v1');
  assert.equal(CORRUPT_KEY, 'dailyfeed:v1:corrupt');
  assert.ok(isId(A));
  for (const bad of ['A'.repeat(40), 'a'.repeat(39), 'a'.repeat(41), '1', '', null, 42]) assert.equal(isId(bad), false, String(bad));
});

test('parseState: missing value is a clean empty state, not corrupt', () => {
  assert.deepEqual(parseState(null), { state: emptyState(), corrupt: false });
  assert.deepEqual(parseState(''), { state: emptyState(), corrupt: false });
});

test('parseState: wrong shape is corrupt and yields an empty state (review focus 5)', () => {
  for (const raw of ['{bad', '[]', '"x"', '{"v":2,"read":{},"saved":{}}', '{"v":1,"read":[],"saved":{}}', '{"v":1,"read":{},"saved":null}']) {
    assert.deepEqual(parseState(raw), { state: emptyState(), corrupt: true }, raw);
  }
});

test('parseState keeps valid entries and silently drops bad ones', () => {
  const raw = JSON.stringify({
    v: 1,
    read: { [A]: { state: 'opened', at: T0 }, [B]: { state: 'liked', at: T0 }, nothex: { state: 'seen', at: T0 } },
    saved: { [A]: { savedAt: T0, item: snap(A) }, [B]: { savedAt: T0, item: snap(A) } },
  });
  const { state, corrupt } = parseState(raw);
  assert.equal(corrupt, false);
  assert.deepEqual(Object.keys(state.read), [A]);
  assert.deepEqual(Object.keys(state.saved), [A], 'B is dropped: its snapshot id does not match its key');
});

test('parseState ignores __proto__ and constructor keys without polluting (review focus 1)', () => {
  const raw = `{"v":1,"read":{"__proto__":{"state":"opened","at":1},"constructor":{"state":"seen","at":1}},"saved":{"__proto__":{"savedAt":1,"item":{"polluted":true}}}}`;
  const { state, corrupt } = parseState(raw);
  assert.equal(corrupt, false);
  assert.equal(Object.keys(state.read).length, 0);
  assert.equal(Object.keys(state.saved).length, 0);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.getPrototypeOf(state.read), Object.prototype);
});

test('markSeen records the first time only; markOpened upgrades and is never downgraded', () => {
  let s = markSeen(emptyState(), A, T0);
  assert.deepEqual(s.read[A], { state: 'seen', at: T0 });
  assert.equal(markSeen(s, A, T0 + 5), s, 'second seen is a no-op');
  s = markOpened(s, A, T0 + 10);
  assert.deepEqual(s.read[A], { state: 'opened', at: T0 + 10 });
  assert.equal(markSeen(s, A, T0 + 20), s, 'seen never downgrades opened');
  assert.equal(markOpened(s, A, T0 + 30), s, 'opened keeps its first time');
  const e = emptyState();
  assert.equal(markOpened(e, 'nope', T0), e);
  assert.equal(markSeen(e, undefined, T0), e);
});

test('state functions do not mutate their input', () => {
  const e = emptyState();
  markSeen(e, A, T0); markOpened(e, A, T0); save(e, snap(), T0);
  assert.deepEqual(e, emptyState());
});

test('isHiddenOnHome: opened at once, seen only after 24h', () => {
  assert.equal(isHiddenOnHome(emptyState(), A, T0), false);
  const seen = markSeen(emptyState(), A, T0);
  assert.equal(isHiddenOnHome(seen, A, T0 + DAY_MS - 1), false);
  assert.equal(isHiddenOnHome(seen, A, T0 + DAY_MS), true);
  assert.equal(isHiddenOnHome(markOpened(emptyState(), A, T0), A, T0), true);
});

test('prune drops read entries at 30 days, keeps saved, clamps future times (review focus 2)', () => {
  const s = {
    v: 1,
    read: { [A]: { state: 'seen', at: T0 - 30 * DAY_MS }, [B]: { state: 'opened', at: T0 - 29 * DAY_MS } },
    saved: { [A]: { savedAt: T0 - 400 * DAY_MS, item: snap(A) } },
  };
  const p = prune(s, T0);
  assert.deepEqual(Object.keys(p.read), [B]);
  assert.ok(p.saved[A], 'saved is never pruned');
  const future = prune({ v: 1, read: { [A]: { state: 'seen', at: T0 + 5 * DAY_MS } }, saved: { [B]: { savedAt: T0 + DAY_MS, item: snap(B) } } }, T0);
  assert.equal(future.read[A].at, T0);
  assert.equal(future.saved[B].savedAt, T0);
  assert.equal(isHiddenOnHome(future, A, T0 + DAY_MS), true, 'a clamped seen entry hides after 24h of local time');
});

test('save, unsave, isSaved, savedList (newest first)', () => {
  let s = save(emptyState(), snap(A), T0);
  s = save(s, snap(B, { title: 'Second' }), T0 + 1);
  assert.ok(isSaved(s, A) && isSaved(s, B));
  assert.deepEqual(savedList(s).map((i) => i.title), ['Second', 'Hello']);
  s = unsave(s, A);
  assert.equal(isSaved(s, A), false);
  assert.equal(unsave(s, A), s, 'unsaving twice is a no-op');
  const e = emptyState();
  assert.equal(save(e, snap(A, { url: 'javascript:alert(1)' }), T0), e, 'invalid snapshot is not saved');
  assert.equal(isSaved(e, undefined), false);
});

test('sanitizeSnapshot keeps known fields, fills gaps, rejects bad input (review focus 3)', () => {
  const ok = sanitizeSnapshot({ ...snap(), html: '<b>x</b>' });
  assert.deepEqual(Object.keys(ok).sort(), ['addedAt', 'category', 'detail', 'id', 'sourceName', 'summary', 'tags', 'title', 'titleVi', 'url']);
  const gaps = sanitizeSnapshot({ id: A, url: '', title: 'T', titleVi: null });
  assert.deepEqual(gaps, { id: A, url: '', title: 'T', titleVi: '', summary: '', detail: '', category: '', sourceName: '', addedAt: '', tags: [] });
  const bad = [
    snap(A, { url: 'javascript:alert(1)' }), snap(A, { url: 'data:text/html,x' }), snap(A, { url: '/relative' }),
    snap('A'.repeat(40)), snap('1'), snap(A, { title: 42 }), snap(A, { title: '' }), snap(A, { title: 'x'.repeat(501) }),
    snap(A, { detail: 'x'.repeat(8001) }), snap(A, { tags: Array(11).fill('t') }), snap(A, { tags: ['x'.repeat(41)] }),
    snap(A, { tags: [1] }), snap(A, { tags: 'llm' }), null, [], 'x',
  ];
  for (const b of bad) assert.equal(sanitizeSnapshot(b), null, JSON.stringify(b));
  assert.ok(sanitizeSnapshot(snap(A, { detail: 'x'.repeat(8000) })));
});

test('isHttpUrl and groupOf (kept in sync with lib/render.mjs)', () => {
  assert.ok(isHttpUrl('https://a.com') && isHttpUrl('http://a.com/x'));
  for (const bad of ['javascript:alert(1)', 'data:x', 'a.com', '', null]) assert.equal(isHttpUrl(bad), false);
  for (const c of [...Object.keys(CATEGORY_LABEL), 'weird', '']) assert.equal(groupOf(c), renderGroupOf(c), c);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test tests/state.test.mjs`
Expected: FAIL, `Cannot find module '.../site/assets/state.js'`.

- [ ] **Step 3: Implement `site/assets/state.js`**

```js
// Saved items and read state for the Daily Feed, kept in the reader's
// browser. Pure functions only: no DOM, no storage, `now` is epoch ms and
// always passed in. Functions return new objects and never mutate input.
// Spec: docs/superpowers/specs/2026-10-04-saved-and-read-state-design.md
export const STORAGE_KEY = 'dailyfeed:v1';
export const CORRUPT_KEY = 'dailyfeed:v1:corrupt';
export const DAY_MS = 24 * 60 * 60 * 1000;
export const SEEN_GRACE_MS = DAY_MS;
export const READ_TTL_MS = 30 * DAY_MS;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const LIMITS = { title: 500, titleVi: 500, summary: 500, detail: 8000, category: 40, sourceName: 100, addedAt: 10 };
export const MAX_TAGS = 10;
export const MAX_TAG = 40;

const ID_RE = /^[0-9a-f]{40}$/;
const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const isTime = (t) => Number.isFinite(t) && t > 0;

export const isId = (id) => typeof id === 'string' && ID_RE.test(id);
export const emptyState = () => ({ v: 1, read: {}, saved: {} });

export function isHttpUrl(raw) {
  if (typeof raw !== 'string') return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Must match groupOf in lib/render.mjs (tests/state.test.mjs checks).
export function groupOf(category) {
  if (category.startsWith('ai-')) return 'ai';
  if (category.startsWith('test-')) return 'testing';
  if (category === 'humor') return 'humor';
  return 'it';
}

// A saved item's copy. Unknown fields are dropped; a missing or null text
// field becomes ''; `url` may be '' (no link) but otherwise must be http(s).
export function sanitizeSnapshot(obj) {
  if (!isObj(obj) || !isId(obj.id)) return null;
  const url = obj.url ?? '';
  if (typeof url !== 'string' || url.length > 2000 || (url !== '' && !isHttpUrl(url))) return null;
  const out = { id: obj.id, url };
  for (const [key, max] of Object.entries(LIMITS)) {
    const v = obj[key] ?? '';
    if (typeof v !== 'string' || v.length > max) return null;
    out[key] = v;
  }
  if (!out.title) return null;
  const tags = obj.tags ?? [];
  if (!Array.isArray(tags) || tags.length > MAX_TAGS || !tags.every((t) => typeof t === 'string' && t.length <= MAX_TAG)) return null;
  out.tags = [...tags];
  return out;
}

// Shape check shared by stored state and imported files. Returns null when
// the top level is wrong; bad entries are dropped and counted in `skipped`.
export function normalize(obj) {
  if (!isObj(obj) || obj.v !== 1) return null;
  const read = obj.read ?? {};
  const saved = obj.saved ?? {};
  if (!isObj(read) || !isObj(saved)) return null;
  const state = emptyState();
  let skipped = 0;
  for (const [id, e] of Object.entries(read)) {
    if (isId(id) && isObj(e) && (e.state === 'opened' || e.state === 'seen') && isTime(e.at)) state.read[id] = { state: e.state, at: e.at };
    else skipped++;
  }
  for (const [id, e] of Object.entries(saved)) {
    const item = isObj(e) ? sanitizeSnapshot(e.item) : null;
    if (isId(id) && item && item.id === id && isTime(e.savedAt)) state.saved[id] = { savedAt: e.savedAt, item };
    else skipped++;
  }
  return { state, skipped };
}

// `corrupt` is true when a value was stored but is unusable; the caller
// keeps the raw value aside before overwriting it.
export function parseState(raw) {
  if (raw == null || raw === '') return { state: emptyState(), corrupt: false };
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { state: emptyState(), corrupt: true };
  }
  const n = normalize(obj);
  return n ? { state: n.state, corrupt: false } : { state: emptyState(), corrupt: true };
}

// Drops read entries older than READ_TTL_MS (their items expired long ago)
// and clamps future timestamps, e.g. imported from a device whose clock is
// ahead, to now.
export function prune(state, now) {
  const read = {};
  for (const [id, e] of Object.entries(state.read)) {
    const at = Math.min(e.at, now);
    if (now - at < READ_TTL_MS) read[id] = { state: e.state, at };
  }
  const saved = {};
  for (const [id, e] of Object.entries(state.saved)) saved[id] = { savedAt: Math.min(e.savedAt, now), item: e.item };
  return { v: 1, read, saved };
}

export function markOpened(state, id, now) {
  if (!isId(id) || state.read[id]?.state === 'opened') return state;
  return { ...state, read: { ...state.read, [id]: { state: 'opened', at: now } } };
}

export function markSeen(state, id, now) {
  if (!isId(id) || Object.hasOwn(state.read, id)) return state;
  return { ...state, read: { ...state.read, [id]: { state: 'seen', at: now } } };
}

export function isHiddenOnHome(state, id, now) {
  if (!isId(id) || !Object.hasOwn(state.read, id)) return false;
  const e = state.read[id];
  return e.state === 'opened' || now - e.at >= SEEN_GRACE_MS;
}

export const isSaved = (state, id) => isId(id) && Object.hasOwn(state.saved, id);

export function save(state, snapshot, now) {
  const item = sanitizeSnapshot(snapshot);
  if (!item) return state;
  return { ...state, saved: { ...state.saved, [item.id]: { savedAt: now, item } } };
}

export function unsave(state, id) {
  if (!isSaved(state, id)) return state;
  const saved = { ...state.saved };
  delete saved[id];
  return { ...state, saved };
}

export function savedList(state) {
  return Object.values(state.saved).sort((a, b) => b.savedAt - a.savedAt).map((e) => e.item);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test tests/state.test.mjs && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add site/assets/state.js tests/state.test.mjs
git commit -m "Add browser state module for saved items and read state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `state.js`: import merge

**Files:**
- Modify: `site/assets/state.js` (append)
- Test: `tests/state.test.mjs` (append)

**Interfaces:**
- Consumes: `normalize`, `emptyState`, `MAX_IMPORT_BYTES` from Task 1.
- Produces: `mergeImport(state, text: string) → { ok: true, state, saved: number, read: number, skipped: number } | { ok: false, error: 'size'|'json'|'format' }`. `saved`/`read` count the valid entries in the file; `skipped` counts the malformed ones. The returned `state` is not pruned; the caller prunes it.

- [ ] **Step 1: Write the failing tests**

Append to `tests/state.test.mjs`, and add `mergeImport, MAX_IMPORT_BYTES` to the import list at the top:

```js
const C = 'c'.repeat(40);
const file = (obj) => JSON.stringify({ v: 1, read: {}, saved: {}, ...obj });

test('mergeImport rejects oversize, non-JSON and wrong-format files without touching state', () => {
  const s = save(emptyState(), snap(A), T0);
  assert.deepEqual(mergeImport(s, 'x'.repeat(MAX_IMPORT_BYTES + 1)), { ok: false, error: 'size' });
  assert.deepEqual(mergeImport(s, '{nope'), { ok: false, error: 'json' });
  assert.deepEqual(mergeImport(s, '{"v":2}'), { ok: false, error: 'format' });
  assert.deepEqual(mergeImport(s, '{"v":1,"read":[]}'), { ok: false, error: 'format' });
  assert.deepEqual(mergeImport(s, 42), { ok: false, error: 'size' });
  assert.ok(isSaved(s, A));
});

test('mergeImport: saved is a union, the later savedAt wins a conflict', () => {
  const s = save(emptyState(), snap(A), T0);
  const newer = mergeImport(s, file({ saved: { [A]: { savedAt: T0 + 1, item: snap(A, { title: 'New' }) }, [B]: { savedAt: T0, item: snap(B) } } }));
  assert.equal(newer.ok, true);
  assert.equal(newer.state.saved[A].item.title, 'New');
  assert.ok(newer.state.saved[B]);
  assert.equal(newer.saved, 2);
  const older = mergeImport(s, file({ saved: { [A]: { savedAt: T0 - 1, item: snap(A, { title: 'Old' }) } } }));
  assert.equal(older.state.saved[A].item.title, 'Hello');
});

test('mergeImport: opened beats seen, equal states keep the earlier time', () => {
  const s = { v: 1, saved: {}, read: { [A]: { state: 'seen', at: T0 }, [B]: { state: 'opened', at: T0 }, [C]: { state: 'seen', at: T0 + 10 } } };
  const r = mergeImport(s, file({ read: { [A]: { state: 'opened', at: T0 + 5 }, [B]: { state: 'seen', at: T0 - 5 }, [C]: { state: 'seen', at: T0 } } }));
  assert.deepEqual(r.state.read[A], { state: 'opened', at: T0 + 5 });
  assert.deepEqual(r.state.read[B], { state: 'opened', at: T0 });
  assert.deepEqual(r.state.read[C], { state: 'seen', at: T0 });
  assert.equal(r.read, 3);
});

test('mergeImport skips and counts bad entries, including prototype keys (review focus 1)', () => {
  const text = `{"v":1,"read":{"${A}":{"state":"opened","at":1},"BAD":{"state":"opened","at":1},"__proto__":{"state":"seen","at":1}},`
    + `"saved":{"${B}":${JSON.stringify({ savedAt: 1, item: snap(B, { url: 'javascript:alert(1)' }) })},"${C}":${JSON.stringify({ savedAt: 1, item: snap(C) })}}}`;
  const r = mergeImport(emptyState(), text);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.state.read), [A]);
  assert.deepEqual(Object.keys(r.state.saved), [C]);
  assert.deepEqual([r.read, r.saved, r.skipped], [1, 1, 3]);
  assert.equal(({}).state, undefined);
});

test('mergeImport does not mutate the current state, and an export round-trips', () => {
  const s = markOpened(save(emptyState(), snap(A), T0), B, T0);
  const before = structuredClone(s);
  const r = mergeImport(s, file({ read: { [C]: { state: 'seen', at: T0 } } }));
  assert.deepEqual(s, before);
  assert.ok(r.state.read[C]);
  assert.deepEqual(mergeImport(emptyState(), JSON.stringify(s)).state, s);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test tests/state.test.mjs`
Expected: FAIL, `mergeImport` is not exported (SyntaxError on the import).

- [ ] **Step 3: Implement `mergeImport`**

Append to `site/assets/state.js`:

```js
const strength = (e) => (e.state === 'opened' ? 2 : 1);

// Merges an exported file into the current state; never replaces it. Saved:
// union, the later savedAt wins. Read: opened beats seen; between equal
// states the earlier time wins.
export function mergeImport(state, text) {
  if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'size' };
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: 'json' };
  }
  const n = normalize(obj);
  if (!n) return { ok: false, error: 'format' };
  const read = { ...state.read };
  for (const [id, e] of Object.entries(n.state.read)) {
    const cur = read[id];
    if (!cur || strength(e) > strength(cur) || (e.state === cur.state && e.at < cur.at)) read[id] = e;
  }
  const saved = { ...state.saved };
  for (const [id, e] of Object.entries(n.state.saved)) {
    if (!saved[id] || e.savedAt > saved[id].savedAt) saved[id] = e;
  }
  return {
    ok: true, state: { v: 1, read, saved },
    saved: Object.keys(n.state.saved).length, read: Object.keys(n.state.read).length, skipped: n.skipped,
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test tests/state.test.mjs && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add site/assets/state.js tests/state.test.mjs
git commit -m "Add import merge for browser state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Home window config and selection

**Files:**
- Create: `lib/home.mjs`
- Test: `tests/home.test.mjs`
- Modify: `config/feed.mjs:16`, `scripts/build.mjs:1-30`, `lib/detail.mjs:64-67`, `tests/smoke.test.mjs:14`, `tests/detail.test.mjs:6`

**Interfaces:**
- Consumes: `daysAgo(ymd, n)` from `lib/store.mjs`.
- Produces: `selectHome(items, today: 'YYYY-MM-DD', cfg: { hotNowDays, homeDays, hotNowCount }) → { hotNow: item[], feed: item[] }`, both rank-descending, `feed` excludes `hotNow` ids. `feedConfig.homePageSize` is used by Task 4's `renderPage({ pageSize })`.

- [ ] **Step 1: Write the failing tests**

Create `tests/home.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectHome } from '../lib/home.mjs';

const it = (id, addedAt, rank) => ({ id, addedAt, rank });

test('selectHome: hot now from the last hotNowDays, feed from the last homeDays without hot items', () => {
  const items = [
    it('a', '2026-10-04', 0.5), it('b', '2026-10-04', 0.9), it('c', '2026-10-03', 0.95),
    it('f', '2026-10-02', 5), it('d', '2026-09-28', 2), it('e', '2026-09-27', 3),
  ];
  const { hotNow, feed } = selectHome(items, '2026-10-04', { hotNowDays: 2, homeDays: 7, hotNowCount: 2 });
  assert.deepEqual(hotNow.map((i) => i.id), ['c', 'b'], 'f ranks higher but is 3 days old');
  assert.deepEqual(feed.map((i) => i.id), ['f', 'd', 'a'], 'd is exactly 7 days back (included), e is 8 (excluded)');
});
```

In `tests/smoke.test.mjs`, replace `assert.equal(feedConfig.feedDays, 2);` with:

```js
  assert.equal(feedConfig.hotNowDays, 2);
  assert.equal(feedConfig.homeDays, 7);
  assert.equal(feedConfig.homePageSize, 40);
  assert.equal(feedConfig.detailDays, 2);
  assert.equal('feedDays' in feedConfig, false);
```

In `tests/detail.test.mjs:6`, change `feedDays: 2` to `detailDays: 2`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test tests/home.test.mjs tests/smoke.test.mjs tests/detail.test.mjs`
Expected: FAIL. `home.mjs` not found; `hotNowDays` is undefined; `selectForDetail` returns nothing because `cfg.feedDays` is undefined.

- [ ] **Step 3: Implement**

Create `lib/home.mjs`:

```js
import { daysAgo } from './store.mjs';

// Which items the index renders. "Hot now" stays fresh (hotNowDays); the
// feed reaches back homeDays so the browser can fill Home with unread items
// once recent ones are read.
export function selectHome(items, today, cfg) {
  const byRank = (a, b) => b.rank - a.rank;
  const hotSince = daysAgo(today, cfg.hotNowDays - 1);
  const homeSince = daysAgo(today, cfg.homeDays - 1);
  const hotNow = items.filter((i) => i.addedAt >= hotSince).sort(byRank).slice(0, cfg.hotNowCount);
  const hotIds = new Set(hotNow.map((i) => i.id));
  const feed = items.filter((i) => i.addedAt >= homeSince && !hotIds.has(i.id)).sort(byRank);
  return { hotNow, feed };
}
```

In `config/feed.mjs`, replace the line `  feedDays: 2,             // index shows items added within this many days` with:

```js
  hotNowDays: 2,           // "Hot now" picks from items added within this many days
  homeDays: 7,             // index feed renders items added within this many days; the browser hides read ones
  homePageSize: 40,        // unread cards shown before "Xem thêm"
  detailDays: 2,           // Vietnamese details are written for items added within this many days
```

In `lib/detail.mjs`, change the comment `// Items added within feedDays that have no detail yet and were not already` to `// Items added within detailDays that have no detail yet and were not already`, and `const since = daysAgo(today, cfg.feedDays - 1);` to `const since = daysAgo(today, cfg.detailDays - 1);`.

In `scripts/build.mjs`:
- Add `import { selectHome } from '../lib/home.mjs';` after the `renderPage` import.
- Replace these five lines:

```js
  const feedSince = daysAgo(today, cfg.feedDays - 1);
  const recent = items.filter((i) => i.addedAt >= feedSince).sort(byRank);
  const hotNow = recent.slice(0, cfg.hotNowCount);
  const hotIds = new Set(hotNow.map((i) => i.id));
  const feed = recent.filter((i) => !hotIds.has(i.id));
```

with:

```js
  const { hotNow, feed } = selectHome(items, today, cfg);
```

- Change the import `import { dataFile, readJson, updateStatus, siteDir, todayIn, daysAgo } from '../lib/store.mjs';` to drop `daysAgo` (it is now unused).
- In the index `renderPage({...})` call, add `pageSize: cfg.homePageSize,` after `isArchive: false,`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test && grep -rn "feedDays" lib scripts config tests || echo "no feedDays left"`
Expected: all PASS; prints `no feedDays left`.

- [ ] **Step 5: Commit**

```bash
git add lib/home.mjs tests/home.test.mjs config/feed.mjs scripts/build.mjs lib/detail.mjs tests/smoke.test.mjs tests/detail.test.mjs
git commit -m "Render a 7-day Home window; split feedDays into hotNowDays, homeDays, detailDays

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Markup and styles for saving, paging and the Saved view

**Files:**
- Modify: `lib/render.mjs` (`renderCard` article and meta; `renderPage`)
- Modify: `site/assets/style.css`
- Test: `tests/render.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces (DOM contract `app.js` relies on in Task 5):
  - `<body data-page="home|archive">`.
  - Card: `<article class="card" data-group data-id data-url data-category data-added>`, with `.card__meta` containing `<button class="card__save" type="button" aria-pressed="false" aria-label="Lưu bài" title="Lưu">☆</button>`. Unchanged elements: `.card__title`, `.card__orig`, `.card__summary`, `.card__details`, `.card__detail` (with `<p>`/`<ul>` children and a trailing `p.card__source`), `.card__src`, `.tag`.
  - Pills: `[data-filter]` (existing) plus `<button class="pill pill--saved" data-view="saved" type="button" aria-pressed="false">Saved <span data-saved-count></span></button>`.
  - `#feed` has `data-page-size` on Home only.
  - Home only: `#feed-more` button, `#read-hidden` paragraph containing `[data-count]` and the `#show-read` button, `#all-read` paragraph. All start `hidden`.
  - Both pages: `<section id="saved" hidden>` with `.list` and `#saved-empty`. In the footer, `p.state-tools[hidden]` with `#export`, `#import`, `#import-file` and `#state-msg`.
  - Script: `<script type="module" src="${basePath}assets/app.js"></script>`; the inline filter script is removed.
  - `renderPage` takes a new optional param `pageSize`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/render.test.mjs`:

```js
const page = (extra = {}) => renderPage({
  title: 'Daily Feed', heading: 'Daily Feed', items: [item], hotNow: [meme], archiveDates: ['2026-10-04'], status: {},
  sourceNames: ['Hacker News'], generatedAt: '2026-10-04T00:15:00Z', basePath: '', isArchive: false, pageSize: 40, ...extra,
});

test('renderCard carries escaped data attributes and a bookmark button (review focus 3)', () => {
  const html = renderCard({ ...item, id: 'a"<b', category: 'ai-tip' });
  assert.ok(html.includes('data-id="a&quot;&lt;b"'));
  assert.ok(html.includes('data-url="https://a.com/x"'));
  assert.ok(html.includes('data-category="ai-tip"') && html.includes('data-added="2026-10-04"'));
  assert.ok(html.includes('<button class="card__save" type="button" aria-pressed="false" aria-label="Lưu bài" title="Lưu">☆</button>'));
  assert.ok(renderCard({ ...item, url: 'javascript:alert(1)' }).includes('data-url=""'));
});

test('renderPage home has the Saved pill, paging placeholders, footer tools and the module script', () => {
  const html = page();
  assert.ok(html.includes('<body data-page="home">'));
  assert.ok(html.includes('data-view="saved"') && html.includes('data-saved-count'));
  assert.ok(html.includes('<section id="feed" data-page-size="40">'));
  for (const id of ['feed-more', 'read-hidden', 'show-read', 'all-read', 'saved-empty', 'export', 'import', 'import-file', 'state-msg']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(html.includes('<section id="saved" hidden>'));
  assert.ok(html.includes('<p class="state-tools" hidden>'));
  assert.ok(html.includes('<script type="module" src="assets/app.js"></script>'));
  assert.ok(!html.includes('replaceState'), 'inline filter script is gone');
  assert.ok(html.includes('Xem thêm') && html.includes('bài đã đọc đang ẩn') && html.includes('Bạn đã đọc hết. Xem lưu trữ bên dưới.'));
});

test('renderPage archive loads ../assets/app.js and has no Home paging', () => {
  const html = page({ basePath: '../', isArchive: true, hotNow: [] });
  assert.ok(html.includes('<body data-page="archive">'));
  assert.ok(html.includes('<script type="module" src="../assets/app.js"></script>'));
  assert.ok(html.includes('<section id="feed">'), 'no data-page-size on archive');
  assert.ok(!html.includes('id="feed-more"') && !html.includes('id="read-hidden"'));
  assert.ok(html.includes('id="saved"') && html.includes('id="export"'));
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test tests/render.test.mjs`
Expected: the three new tests FAIL; existing tests PASS.

- [ ] **Step 3: Implement in `lib/render.mjs`**

In `renderCard`, replace the `<article …>` opening line and the meta block:

```js
  return `<article class="card${large ? ' card--large' : ''}" data-group="${group}">
  <div class="card__meta">
    <span class="chip chip--${group}">${escapeHtml(CATEGORY_LABEL[item.category] ?? item.category)}</span>
    ${srcLine}
    <span class="card__fit" title="fit ${item.fit}/5">${'●'.repeat(item.fit)}${'○'.repeat(5 - item.fit)}</span>
  </div>
```

with:

```js
  const data = `data-group="${group}" data-id="${escapeHtml(item.id)}" data-url="${escapeHtml(safeUrl(item.url) ?? '')}" data-category="${escapeHtml(item.category)}" data-added="${escapeHtml(item.addedAt)}"`;
  return `<article class="card${large ? ' card--large' : ''}" ${data}>
  <div class="card__meta">
    <span class="chip chip--${group}">${escapeHtml(CATEGORY_LABEL[item.category] ?? item.category)}</span>
    ${srcLine}
    <span class="card__fit" title="fit ${item.fit}/5">${'●'.repeat(item.fit)}${'○'.repeat(5 - item.fit)}</span>
    <button class="card__save" type="button" aria-pressed="false" aria-label="Lưu bài" title="Lưu">☆</button>
  </div>
```

In `renderPage`:

1. Change the signature to `export function renderPage({ title, heading, items, hotNow, archiveDates, status, sourceNames, generatedAt, basePath, isArchive, pageSize })`.
2. Replace the `filters` constant with:

```js
  const filters = ['all', ...Object.keys(GROUP_LABEL)]
    .map((g) => `<button class="pill" data-filter="${g}" type="button">${g === 'all' ? 'All' : GROUP_LABEL[g]}</button>`).join('')
    + '<button class="pill pill--saved" data-view="saved" type="button" aria-pressed="false">Saved <span data-saved-count></span></button>';
  const feedAttrs = !isArchive && pageSize ? ` data-page-size="${Number(pageSize)}"` : '';
  const homeTools = isArchive ? '' : `<div class="feed-tools">
  <button id="feed-more" class="pill" type="button" hidden>Xem thêm</button>
  <p id="read-hidden" hidden><span data-count>0</span> bài đã đọc đang ẩn · <button class="linkbtn" id="show-read" type="button">Hiện</button></p>
  <p id="all-read" class="empty" hidden>Bạn đã đọc hết. Xem lưu trữ bên dưới.</p>
</div>`;
  const saved = '<section id="saved" hidden><h2>Saved</h2><div class="list"></div><p id="saved-empty" class="empty" hidden>Chưa có bài đã lưu</p></section>';
```

3. Change `<body>` to `<body data-page="${isArchive ? 'archive' : 'home'}">`.
4. Replace `<section id="feed">${renderFeed(items)}</section>` with:

```js
<section id="feed"${feedAttrs}>${renderFeed(items)}</section>
${homeTools}
${saved}
```

5. In `<footer>`, after the second `<p>`, add:

```html
  <p class="state-tools" hidden>Dữ liệu trên trình duyệt này: <button class="linkbtn" id="export" type="button">Xuất</button> · <button class="linkbtn" id="import" type="button">Nhập</button><input id="import-file" type="file" accept="application/json,.json" hidden> <span id="state-msg" role="status"></span></p>
```

6. Replace the whole inline `<script>…</script>` block (from `<script>` through `</script>`) with:

```html
<script type="module" src="${basePath}assets/app.js"></script>
```

- [ ] **Step 4: Add styles to `site/assets/style.css`**

Change `#hot-now h2::before, .archive h2::before { content: '## '; color: var(--accent); }` to:

```css
#hot-now h2::before, .archive h2::before, #saved h2::before { content: '## '; color: var(--accent); }
```

Append:

```css
[hidden] { display: none !important; }
.card__save {
  font: inherit; font-size: 18px; line-height: 1; color: var(--muted);
  background: transparent; border: 0; border-radius: 6px; padding: 0;
  min-width: 32px; min-height: 32px; cursor: pointer;
}
.card__save:hover, .card__save[aria-pressed="true"] { color: var(--accent); }
.card__save:focus-visible, .linkbtn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.card--read { opacity: 0.55; }
.card--read .card__meta::after { content: 'đã đọc'; font-size: 11px; border: 1px solid var(--border); border-radius: 999px; padding: 1px 6px; }
.feed-tools { display: flex; flex-direction: column; align-items: center; gap: 6px; margin-top: 18px; color: var(--muted); font-size: 13px; }
.feed-tools p { margin: 0; }
.linkbtn { font: inherit; color: var(--accent); background: none; border: 0; padding: 4px 2px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.state-tools { margin-top: 12px; }
#state-msg { margin-left: 8px; color: var(--text); }
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test`
Expected: all PASS, including the existing `renderPage builds hot-now…` test.

- [ ] **Step 6: Commit**

```bash
git add lib/render.mjs site/assets/style.css tests/render.test.mjs
git commit -m "Render bookmark buttons, Saved pill, paging placeholders and state tools

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `app.js` DOM wiring, browser verification, docs

**Files:**
- Create: `site/assets/app.js`
- Modify: `CLAUDE.md` (architecture section), `README.md` (new section before `## Rules`)

**Interfaces:**
- Consumes: everything exported by `site/assets/state.js` (Tasks 1–2) and the DOM contract from Task 4.
- Produces: no exports; the page behaviour.

- [ ] **Step 1: Create `site/assets/app.js`**

```js
// Saved items and read state on the page. State rules live in state.js;
// this file wires them to the DOM. Nothing from storage or an imported file
// is ever assigned to innerHTML. Spec:
// docs/superpowers/specs/2026-10-04-saved-and-read-state-design.md
import {
  STORAGE_KEY, CORRUPT_KEY, MAX_IMPORT_BYTES, LIMITS, MAX_TAGS, MAX_TAG,
  parseState, prune, markOpened, markSeen, isHiddenOnHome, isSaved, save, unsave, savedList,
  mergeImport, groupOf, isHttpUrl,
} from './state.js';

const SEEN_MS = 2000;
const SEEN_RATIO = 0.6;
const GROUPS = ['ai', 'testing', 'it', 'humor'];
const NO_STORAGE = 'Không lưu được trên trình duyệt này';
const IMPORT_ERROR = {
  size: 'Tệp quá lớn (tối đa 5 MB)',
  json: 'Tệp không phải JSON',
  format: 'Tệp không đúng định dạng Daily Feed',
};

const $ = (sel) => document.querySelector(sel);
const setHidden = (sel, hidden) => { const e = $(sel); if (e) e.hidden = hidden; };
const say = (text) => { const m = $('#state-msg'); if (m) m.textContent = text; };

// ---- storage

let storageOk = true;
let raw = null;
try { raw = localStorage.getItem(STORAGE_KEY); } catch { storageOk = false; }
const parsed = parseState(raw);
if (parsed.corrupt) {
  try { localStorage.setItem(CORRUPT_KEY, raw); } catch { /* best effort */ }
}
const loadedAt = Date.now();
let state = prune(parsed.state, loadedAt);

function persist() {
  if (storageOk) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return;
    } catch {
      storageOk = false;
    }
  }
  say(NO_STORAGE);
}

// ---- page model

const isHome = document.body.dataset.page === 'home';
const feedEl = $('#feed');
const pageSize = Number(feedEl?.dataset.pageSize) || Infinity;
const homeCards = isHome ? [...document.querySelectorAll('#hot-now .card, #feed .card')] : [];
// Decided once per load so cards never vanish while the reader is on the page.
const hiddenAtLoad = new Set(homeCards.filter((c) => isHiddenOnHome(state, c.dataset.id, loadedAt)).map((c) => c.dataset.id));
let group = 'all';
let view = 'feed';
let limit = pageSize;
let showRead = false;

function apply() {
  document.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('is-active', b.dataset.filter === group));
  const inSaved = view === 'saved';
  const savedPill = $('[data-view="saved"]');
  if (savedPill) {
    savedPill.classList.toggle('is-active', inSaved);
    savedPill.setAttribute('aria-pressed', String(inSaved));
  }
  const matches = (c) => group === 'all' || c.dataset.group === group;
  setHidden('#feed', inSaved);
  setHidden('#saved', !inSaved);
  if (inSaved) {
    let n = 0;
    document.querySelectorAll('#saved .card').forEach((c) => { c.hidden = !matches(c); if (!c.hidden) n++; });
    setHidden('#saved-empty', n > 0);
    for (const sel of ['#hot-now', '#feed-more', '#read-hidden', '#all-read']) setHidden(sel, true);
  } else {
    applyFeed(matches);
  }
  const hash = inSaved ? '#saved' : group === 'all' ? '' : `#${group}`;
  if (history.replaceState) history.replaceState(null, '', hash || location.pathname + location.search);
}

function applyFeed(matches) {
  const isHiddenRead = (c) => hiddenAtLoad.has(c.dataset.id);
  const eligible = (c) => matches(c) && (showRead || !isHiddenRead(c));
  let hot = 0;
  document.querySelectorAll('#hot-now .card').forEach((c) => {
    c.hidden = !eligible(c);
    c.classList.toggle('card--read', showRead && isHiddenRead(c));
    if (!c.hidden) hot++;
  });
  setHidden('#hot-now', hot === 0);
  let shown = 0;
  let more = false;
  document.querySelectorAll('#feed .card').forEach((c) => {
    const ok = eligible(c);
    if (isHome) c.classList.toggle('card--read', showRead && isHiddenRead(c));
    c.hidden = !ok || shown >= limit;
    if (ok && shown >= limit) more = true;
    if (!c.hidden) shown++;
  });
  document.querySelectorAll('#feed .list').forEach((l) => {
    const h = l.previousElementSibling;
    if (h && h.classList.contains('divider')) h.hidden = !l.querySelector('.card:not([hidden])');
  });
  if (!isHome) return;
  setHidden('#feed-more', !more);
  const rh = $('#read-hidden');
  if (rh) {
    rh.hidden = showRead || hiddenAtLoad.size === 0;
    const count = rh.querySelector('[data-count]');
    if (count) count.textContent = String(hiddenAtLoad.size);
  }
  setHidden('#all-read', shown + hot > 0 || hiddenAtLoad.size === 0);
}

// ---- cards built from saved snapshots (DOM API + textContent only)

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function linkEl(href, text, cls = '') {
  if (!isHttpUrl(href)) return el('span', cls, text);
  const a = el('a', cls, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

// Same format as renderDetail in lib/render.mjs.
function appendDetail(body, detail) {
  for (const block of detail.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => l.startsWith('- '))) {
      const ul = el('ul');
      ul.append(...lines.map((l) => el('li', '', l.slice(2))));
      body.append(ul);
    } else {
      const p = el('p');
      lines.forEach((l, i) => { if (i) p.append(el('br')); p.append(l); });
      body.append(p);
    }
  }
}

function saveButton() {
  const b = el('button', 'card__save', '☆');
  b.type = 'button';
  return b;
}

function buildCard(item) {
  const g = groupOf(item.category);
  const card = el('article', 'card');
  card.dataset.group = g;
  card.dataset.id = item.id;
  card.dataset.url = isHttpUrl(item.url) ? item.url : '';
  card.dataset.category = item.category;
  card.dataset.added = item.addedAt;
  const meta = el('div', 'card__meta');
  meta.append(el('span', `chip chip--${g}`, $(`[data-filter="${g}"]`)?.textContent ?? g), el('span', 'card__src', item.sourceName), saveButton());
  const title = el('h3', 'card__title');
  const parts = [title];
  if (item.titleVi) {
    const orig = el('span', 'card__orig', item.title);
    orig.lang = 'en';
    parts.push(orig);
  }
  parts.push(el('span', 'card__summary', item.summary));
  const heading = item.titleVi || item.title;
  let head;
  if (item.detail) {
    title.textContent = heading;
    head = el('details', 'card__details');
    const summary = el('summary', 'card__head');
    const toggle = el('span', 'card__toggle');
    toggle.setAttribute('aria-hidden', 'true');
    summary.append(...parts, toggle);
    const body = el('div', 'card__detail');
    appendDetail(body, item.detail);
    const src = el('p', 'card__source');
    src.append(linkEl(item.url, 'Đọc bài gốc', 'card__go'));
    body.append(src);
    head.append(summary, body);
  } else {
    title.append(linkEl(item.url, heading));
    head = el('div', 'card__head');
    head.append(...parts);
  }
  const foot = el('div', 'card__foot');
  const tags = el('span', 'tags');
  tags.append(...item.tags.map((t) => el('span', 'tag', t)));
  foot.append(tags);
  card.append(meta, head, foot);
  return card;
}

// ---- snapshot of a rendered card (inverse of buildCard / renderCard)

const textOf = (card, sel) => card.querySelector(sel)?.textContent.trim() ?? '';

function detailText(card) {
  const body = card.querySelector('.card__detail');
  if (!body) return '';
  const blocks = [];
  for (const child of body.children) {
    if (child.classList.contains('card__source')) continue;
    if (child.tagName === 'UL') blocks.push([...child.children].map((li) => `- ${li.textContent.trim()}`).join('\n'));
    else if (child.tagName === 'P') blocks.push([...child.childNodes].map((n) => (n.nodeName === 'BR' ? '\n' : n.textContent)).join('').trim());
  }
  return blocks.filter(Boolean).join('\n\n');
}

function snapshotFromCard(card) {
  const clip = (key, s) => s.slice(0, LIMITS[key]);
  const orig = textOf(card, '.card__orig');
  const heading = textOf(card, '.card__title');
  return {
    id: card.dataset.id,
    url: card.dataset.url || '',
    title: clip('title', orig || heading),
    titleVi: orig ? clip('titleVi', heading) : '',
    summary: clip('summary', textOf(card, '.card__summary')),
    detail: clip('detail', detailText(card)),
    category: clip('category', card.dataset.category || ''),
    sourceName: clip('sourceName', textOf(card, '.card__src')),
    addedAt: clip('addedAt', card.dataset.added || ''),
    tags: [...card.querySelectorAll('.tag')].slice(0, MAX_TAGS).map((t) => t.textContent.trim().slice(0, MAX_TAG)),
  };
}

// ---- saved view

function syncSaveButtons() {
  document.querySelectorAll('.card__save').forEach((b) => {
    const on = isSaved(state, b.closest('.card')?.dataset.id);
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? '★' : '☆';
    b.title = on ? 'Bỏ lưu' : 'Lưu';
    b.setAttribute('aria-label', on ? 'Bỏ lưu bài' : 'Lưu bài');
  });
  const n = Object.keys(state.saved).length;
  document.querySelectorAll('[data-saved-count]').forEach((s) => { s.textContent = `(${n})`; });
}

// Rebuilt only when entering the view: unsaving inside it leaves the card
// in place (☆) so a mis-tap can be undone by tapping again.
function renderSaved() {
  const list = $('#saved .list');
  if (!list) return;
  list.replaceChildren(...savedList(state).map((item) => {
    const live = document.querySelector(`#hot-now .card[data-id="${item.id}"], #feed .card[data-id="${item.id}"]`);
    const card = live ? live.cloneNode(true) : buildCard(item);
    card.hidden = false;
    card.classList.remove('card--large', 'card--read');
    return card;
  }));
  syncSaveButtons();
}

// ---- opened and seen

function opened(card) {
  if (!card) return;
  const next = markOpened(state, card.dataset.id, Date.now());
  if (next !== state) { state = next; persist(); }
}

function onCardClick(e) {
  const card = e.target.closest?.('.card');
  if (!card) return;
  if (e.type === 'click' && e.target.closest('.card__save')) {
    const id = card.dataset.id;
    state = isSaved(state, id) ? unsave(state, id) : save(state, snapshotFromCard(card), Date.now());
    persist();
    syncSaveButtons();
    return;
  }
  if (e.target.closest('a')) opened(card);
}

function watchSeen() {
  if (!isHome || !('IntersectionObserver' in window)) return;
  const timers = new Map();
  const qualifying = new Set();
  const start = (card) => {
    if (timers.has(card) || document.visibilityState !== 'visible') return;
    timers.set(card, setTimeout(() => {
      timers.delete(card);
      qualifying.delete(card);
      io.unobserve(card);
      const next = markSeen(state, card.dataset.id, Date.now());
      if (next !== state) { state = next; persist(); }
    }, SEEN_MS));
  };
  const stop = (card) => { clearTimeout(timers.get(card)); timers.delete(card); };
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const vh = en.rootBounds?.height || window.innerHeight;
      const ok = en.isIntersecting && (en.intersectionRatio >= SEEN_RATIO || en.intersectionRect.height >= SEEN_RATIO * vh);
      if (ok) { qualifying.add(en.target); start(en.target); } else { qualifying.delete(en.target); stop(en.target); }
    }
  }, { threshold: Array.from({ length: 21 }, (_, i) => i / 20) });
  homeCards.filter((c) => !Object.hasOwn(state.read, c.dataset.id)).forEach((c) => io.observe(c));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') qualifying.forEach(start);
    else [...timers.keys()].forEach(stop);
  });
}

// ---- export / import

function exportState() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `daily-feed-${new Date().toLocaleDateString('sv-SE')}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importState(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) { say(IMPORT_ERROR.size); return; }
  const res = mergeImport(state, await file.text());
  if (!res.ok) { say(IMPORT_ERROR[res.error]); return; }
  state = prune(res.state, Date.now());
  persist();
  syncSaveButtons();
  if (view === 'saved') { renderSaved(); apply(); }
  if (storageOk) say(`Đã nhập: ${res.saved} lưu, ${res.read} đã đọc${res.skipped ? `, bỏ qua ${res.skipped} mục lỗi` : ''}`);
}

// ---- init

persist();
if (!isHome) {
  document.querySelectorAll('#feed .card').forEach((c) => c.classList.toggle('card--read', isHiddenOnHome(state, c.dataset.id, loadedAt)));
}
setHidden('.state-tools', false);
document.addEventListener('click', onCardClick);
document.addEventListener('auxclick', onCardClick);
// `toggle` does not bubble; a capturing listener still sees it.
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d instanceof HTMLDetailsElement && d.open && d.classList.contains('card__details')) opened(d.closest('.card'));
}, true);
document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { group = b.dataset.filter; limit = pageSize; apply(); }));
$('[data-view="saved"]')?.addEventListener('click', () => {
  view = view === 'saved' ? 'feed' : 'saved';
  if (view === 'saved') renderSaved();
  apply();
});
$('#feed-more')?.addEventListener('click', () => { limit += pageSize; apply(); });
$('#show-read')?.addEventListener('click', () => { showRead = true; apply(); });
$('#export')?.addEventListener('click', exportState);
const fileInput = $('#import-file');
$('#import')?.addEventListener('click', () => fileInput?.click());
fileInput?.addEventListener('change', () => importState(fileInput));

const initial = location.hash.slice(1);
if (initial === 'saved') { view = 'saved'; renderSaved(); } else if (GROUPS.includes(initial)) group = initial;
syncSaveButtons();
apply();
watchSeen();
```

- [ ] **Step 2: Syntax-check and run the suite**

Run: `node --check site/assets/app.js && npm test`
Expected: no output from `--check`; all tests PASS.

- [ ] **Step 3: Build a preview into a temp copy (keeps `site/` and `data/` clean)**

```bash
PREVIEW="$(mktemp -d)/daily-feed" && mkdir -p "$PREVIEW" && cp -R data site "$PREVIEW/" \
  && DAILY_FEED_ROOT="$PREVIEW" node scripts/build.mjs && echo "$PREVIEW"
python3 -m http.server 8080 -d "$PREVIEW/site"   # run in the background
git status --short   # expected: no changes under data/ or site/ other than site/assets/app.js
```

- [ ] **Step 4: Browser verification**

Use the Playwright MCP tools (`browser_navigate`, `browser_click`, `browser_evaluate`, `browser_file_upload`, `browser_console_messages`) against `http://localhost:8080/`. Run each check and record what happened.

1. **Paging:** count `#feed .card:not([hidden])`. Expect ≤ 40. `#feed-more` is visible if the feed has more than 40 cards; clicking it raises the count by up to 40.
2. **Opened:** expand the first feed card's details. `JSON.parse(localStorage['dailyfeed:v1']).read[id].state === 'opened'`. The card is still visible. Reload: the card is hidden and `#read-hidden` shows `1 bài đã đọc đang ẩn · Hiện`. Click `Hiện`: the card is back with class `card--read`.
3. **Seen:** scroll a card fully into view, wait 3 s, and check that its read entry is `seen`. Set that entry's `at` to `Date.now() - 25*3600*1000` with `browser_evaluate`, then reload: the card is hidden. Set it to `Date.now() - 23*3600*1000`, then reload: the card is visible.
4. **Save:** click a card's `.card__save`. It shows ★, `aria-pressed="true"`, and the Saved pill reads `Saved (1)`. Reload: still ★.
5. **Saved view:** click the Saved pill. The URL ends in `#saved`, `#feed` is hidden and `#saved` shows the card. Click `AI`: only saved AI cards remain. Unsave inside the view: the card stays with ☆. Leave and re-enter the view: it's gone and `Chưa có bài đã lưu` shows.
6. **Snapshot card with hostile text (review focus 4):** with `browser_evaluate`, add `saved['f'.repeat(40)] = { savedAt: Date.now(), item: { id: 'f'.repeat(40), url: 'https://example.com/', title: '<img src=x onerror=alert(1)>', titleVi: '', summary: 's', detail: 'a\n\n- b', category: 'ai-tip', sourceName: 'X', tags: [], addedAt: '2026-10-01' } }` to the stored state, then open `/#saved`. The title shows the literal text `<img src=x onerror=alert(1)>`. `document.querySelectorAll('#saved img').length === 0`, and no dialog appears.
7. **Import:** write a temp file with one valid saved entry, one saved entry whose url is `javascript:alert(1)`, and one read entry with id `BAD`. Click `Nhập` and upload it with `browser_file_upload`. The message reads `Đã nhập: 1 lưu, 0 đã đọc, bỏ qua 2 mục lỗi`. Upload a file containing `{"v":2}`: the message reads `Tệp không đúng định dạng Daily Feed`. Click `Xuất`: no error in the console.
8. **Corrupt storage (review focus 5):** set `localStorage['dailyfeed:v1'] = '{"v":1,"read":[]}'`, then reload. The page renders, `localStorage['dailyfeed:v1:corrupt']` equals that string, and `dailyfeed:v1` is now a valid empty state.
9. **Archive:** open `/archive/<today>.html`. The card opened in check 2 has `card--read` and shows `đã đọc`. There is no `#feed-more`. The bookmark works and `../assets/state.js` loads (check the network/console).
10. **Console:** `browser_console_messages` shows no errors across all checks.

If a check fails, fix `app.js` and repeat Steps 2–4. Then stop the server.

- [ ] **Step 5: Docs**

In `CLAUDE.md`, after the paragraph that starts `5. **build** (`scripts/build.mjs` → `lib/render.mjs`)` and before `Every step records its outcome`, add:

```markdown
Saved items and read state live only in the reader's browser
(`localStorage` key `dailyfeed:v1`). `site/assets/state.js` (pure rules,
tested from `tests/state.test.mjs`) and `site/assets/app.js` (DOM wiring)
are hand-written source, not build output. The index renders `homeDays`
of items and `app.js` hides read ones, so `lib/render.mjs` card markup and
`app.js` (`snapshotFromCard`, `buildCard`) must stay in step. Spec:
`docs/superpowers/specs/2026-10-04-saved-and-read-state-design.md`.
```

In `README.md`, insert before `## Rules`:

```markdown
## Saved and read state

Each card has a ☆ button; saved items are under the **Saved** pill. Home
hides items you have read: opened (detail expanded or a link clicked) at
once, merely scrolled past after a day. "Hiện" at the bottom shows them
again for that visit, and archive pages always show everything.

This state lives only in the current browser, with no account and no
sync. To move it between phone and laptop, use **Xuất** (export a JSON
file) and **Nhập** (import; it merges, never overwrites) in the footer.
Clearing site data in the browser erases it.
```

- [ ] **Step 6: Final check and commit**

Run: `npm test && git status --short`
Expected: all PASS; changes only in `site/assets/app.js`, `CLAUDE.md`, `README.md`.

```bash
git add site/assets/app.js CLAUDE.md README.md
git commit -m "Wire saved items, read hiding, paging and export/import in the browser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The live site updates after the next scheduled run rebuilds `site/` and pushes. No interactive push.
