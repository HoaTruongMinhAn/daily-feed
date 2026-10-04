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
