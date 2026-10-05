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
export const LIMITS = { title: 500, titleVi: 500, summary: 500, summaryEn: 500, detail: 8000, detailEn: 8000, discussion: 4000, discussionEn: 4000, category: 40, categoryLabel: 40, sourceName: 100, addedAt: 10 };
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
  if (category.startsWith('hot-')) return 'hot';
  if (category.startsWith('ai-')) return 'ai';
  if (category.startsWith('test-')) return 'testing';
  if (category === 'humor') return 'humor';
  return 'it';
}

// A saved item's copy: id, url, title, titleVi, summary, summaryEn, detail,
// detailEn, discussion, discussionEn, category, categoryLabel, sourceName, tags, addedAt. Unknown fields are dropped; a missing or null text
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
  const read = obj.read === undefined ? {} : obj.read;
  const saved = obj.saved === undefined ? {} : obj.saved;
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

// Another tab may have written since this one loaded. Every change starts
// from the stored value so this tab's write does not erase that tab's
// saves; when nothing usable is stored, this tab's state stands.
export function rebase(current, raw, now) {
  if (raw == null) return current;
  const p = parseState(raw);
  return p.corrupt ? current : prune(p.state, now);
}

// Left click or middle click opens a link; right-click (context menu) does not.
export const isOpeningClick = (e) => (e.type === 'click' && e.button === 0) || (e.type === 'auxclick' && e.button === 1);

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
