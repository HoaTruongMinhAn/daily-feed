// Saved items and read state on the page. State rules live in state.js;
// this file wires them to the DOM. Nothing from storage or an imported file
// is ever assigned to innerHTML. Spec:
// docs/superpowers/specs/2026-10-04-saved-and-read-state-design.md
// Language: lang.js sets html[data-lang] before paint; strings.js holds every
// UI string; this file wires the dropdown and re-renders the strings it sets
// itself. Spec: docs/superpowers/specs/2026-10-05-bilingual-site-design.md
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

const $ = (sel) => document.querySelector(sel);
const setHidden = (sel, hidden) => { const e = $(sel); if (e) e.hidden = hidden; };
// Status messages are kept by key so a language switch can re-render them.
let message = null;
const say = (key, ...args) => {
  message = key ? { key, args } : null;
  const m = $('#state-msg');
  if (m) m.textContent = key ? tr(key, ...args) : '';
};

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
    if (message?.key === 'noStorage') say(null);
  } catch {
    storageOk = false;
    say('noStorage');
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

// Same format as renderDetail in lib/render.mjs (CODE_SPAN there).
function appendInline(parent, line) {
  line.split(/`([^`\n]+)`/).forEach((part, i) => parent.append(i % 2 ? el('code', '', part) : part));
}

function appendDetail(body, detail) {
  for (const block of detail.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => l.startsWith('- '))) {
      const ul = el('ul');
      for (const l of lines) { const li = el('li'); appendInline(li, l.slice(2)); ul.append(li); }
      body.append(ul);
    } else {
      const p = el('p');
      lines.forEach((l, i) => { if (i) p.append(el('br')); appendInline(p, l); });
      body.append(p);
    }
  }
}

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

function saveButton() {
  const b = el('button', 'card__save', tr('save'));
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
  parts.push(...pairEl('span', 'card__summary', item.summary, item.summaryEn || item.summary, { fallbackEn: !item.summaryEn }));
  const heading = pairEl('span', '', item.titleVi || item.title, item.title);
  // Without an English detail the English block borrows the Vietnamese one,
  // marked data-fallback and prefixed with a note (same as lib/render.mjs).
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

// ---- snapshot of a rendered card (inverse of buildCard / renderCard)

const textOf = (card, sel) => card.querySelector(sel)?.textContent.trim() ?? '';

// Inverse of appendInline: <br> back to a newline, <code> back to `x`.
const inlineText = (node) => [...node.childNodes]
  .map((n) => (n.nodeName === 'BR' ? '\n' : n.nodeName === 'CODE' ? `\`${n.textContent}\`` : n.textContent)).join('').trim();

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

// ---- saved view

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
    if (saving && !isSaved(state, id)) say('cannotSave');
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
  if (file.size > MAX_IMPORT_BYTES) { say('importSize'); return; }
  const text = await file.text();
  const res = mergeImport(storageOk ? rebase(state, stored(), Date.now()) : state, text);
  if (!res.ok) { say(IMPORT_ERROR[res.error]); return; }
  state = prune(res.state, Date.now());
  persist();
  syncSaveButtons();
  if (view === 'saved') { renderSaved(); apply(); }
  say('imported', res);
  if (!storageOk) { const m = $('#state-msg'); if (m) m.textContent += ` · ${tr('noStorage')}`; }
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

// Broken card images drop their link. Done here, not by an inline onerror,
// so the page CSP can forbid inline script. Images that failed before this
// module ran fire no further event, so sweep those once.
const dropBrokenImage = (img) => img.parentElement?.remove();
document.addEventListener('error', (e) => { if (e.target instanceof HTMLImageElement && e.target.matches('.card__img')) dropBrokenImage(e.target); }, true);
document.querySelectorAll('img.card__img').forEach((img) => { if (img.complete && img.naturalWidth === 0) dropBrokenImage(img); });

const initial = location.hash.slice(1);
if (initial === 'saved') { view = 'saved'; renderSaved(); } else if (GROUPS.includes(initial)) group = initial;
syncSaveButtons();
apply();
watchSeen();
