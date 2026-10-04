// Saved items and read state on the page. State rules live in state.js;
// this file wires them to the DOM. Nothing from storage or an imported file
// is ever assigned to innerHTML. Spec:
// docs/superpowers/specs/2026-10-04-saved-and-read-state-design.md
import {
  STORAGE_KEY, CORRUPT_KEY, MAX_IMPORT_BYTES, LIMITS, MAX_TAGS, MAX_TAG,
  parseState, prune, markOpened, markSeen, isHiddenOnHome, isSaved, save, unsave, savedList,
  mergeImport, groupOf, isHttpUrl, rebase, isOpeningClick,
} from './state.js';

const SEEN_MS = 2000;
const SEEN_RATIO = 0.6;
const GROUPS = ['ai', 'testing', 'it', 'humor'];
const NO_STORAGE = 'Không lưu được trên trình duyệt này';
const CANNOT_SAVE = 'Không lưu được bài này';
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

// Every write is tried, so a full quota that frees up later recovers.
// `storageOk` says whether the last write landed; while it did not, this
// tab's in-memory state is ahead of storage and must not be rebased away.
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageOk = true;
    if ($('#state-msg')?.textContent === NO_STORAGE) say('');
  } catch {
    storageOk = false;
    say(NO_STORAGE);
  }
}

function stored() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

// Applies one change on top of what is stored now, so another open tab's
// changes are not overwritten.
function update(op) {
  const base = storageOk ? rebase(state, stored(), Date.now()) : state;
  const next = op(base);
  state = next;
  if (next !== base) persist();
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
  // Counted within the active category, so "read everything" means this one.
  const hiddenHere = homeCards.filter((c) => matches(c) && isHiddenRead(c)).length;
  const rh = $('#read-hidden');
  if (rh) {
    rh.hidden = showRead || hiddenHere === 0;
    const count = rh.querySelector('[data-count]');
    if (count) count.textContent = String(hiddenHere);
  }
  setHidden('#all-read', shown + hot > 0 || hiddenHere === 0);
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
  const b = el('button', 'card__save', 'Save');
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
    // A link too long to store is dropped rather than refusing the save.
    url: (card.dataset.url || '').length > 2000 ? '' : card.dataset.url || '',
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
    b.textContent = on ? 'Saved' : 'Save';
    b.title = on ? 'Bỏ lưu' : 'Lưu';
    b.setAttribute('aria-label', on ? 'Bỏ lưu bài' : 'Lưu bài');
  });
  const n = Object.keys(state.saved).length;
  document.querySelectorAll('[data-saved-count]').forEach((s) => { s.textContent = `(${n})`; });
}

// Rebuilt only when entering the view: unsaving inside it leaves the card
// in place (Save) so a mis-tap can be undone by tapping again.
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
  if (card) update((s) => markOpened(s, card.dataset.id, Date.now()));
}

function onCardClick(e) {
  if (!isOpeningClick(e)) return;
  const card = e.target.closest?.('.card');
  if (!card) return;
  if (e.type === 'click' && e.target.closest('.card__save')) {
    const id = card.dataset.id;
    let saving = false;
    update((s) => {
      saving = !isSaved(s, id);
      return saving ? save(s, snapshotFromCard(card), Date.now()) : unsave(s, id);
    });
    if (saving && !isSaved(state, id)) say(CANNOT_SAVE);
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
      update((s) => markSeen(s, card.dataset.id, Date.now()));
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
  const text = await file.text();
  const res = mergeImport(storageOk ? rebase(state, stored(), Date.now()) : state, text);
  if (!res.ok) { say(IMPORT_ERROR[res.error]); return; }
  state = prune(res.state, Date.now());
  persist();
  syncSaveButtons();
  if (view === 'saved') { renderSaved(); apply(); }
  const done = `Đã nhập: ${res.saved} lưu, ${res.read} đã đọc${res.skipped ? `, bỏ qua ${res.skipped} mục lỗi` : ''}`;
  say(storageOk ? done : `${done} · ${NO_STORAGE}`);
}

// ---- init

persist();
if (!isHome) {
  document.querySelectorAll('#feed .card').forEach((c) => c.classList.toggle('card--read', isHiddenOnHome(state, c.dataset.id, loadedAt)));
}
setHidden('.state-tools', false);
// Another tab changed the state: follow it. Home hiding stays as decided at load.
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return;
  state = rebase(state, e.newValue, Date.now());
  syncSaveButtons();
});
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
