import { sourcesOf } from './candidate.mjs';
import { GROUP_LABEL, CATEGORY_LABEL, LANGS, t, hotLabelEn } from '../site/assets/strings.js';
export { GROUP_LABEL, CATEGORY_LABEL };

export function groupOf(category) {
  if (category.startsWith('hot-')) return 'hot';
  if (category.startsWith('ai-')) return 'ai';
  if (category.startsWith('test-')) return 'testing';
  if (category === 'humor') return 'humor';
  return 'it';
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Only absolute http(s) URLs may become hrefs or image sources; everything
// else (javascript:, data:, relative paths, garbage) is dropped.
export function safeUrl(raw) {
  try {
    const u = new URL(String(raw ?? ''));
    return u.protocol === 'http:' || u.protocol === 'https:' ? String(raw).trim() : null;
  } catch {
    return null;
  }
}

// Defence in depth behind escapeHtml/safeUrl: no inline or third-party
// script can run even if escaping ever slips. Pages carry no inline event
// handlers (app.js handles broken images); inline style attributes stay
// allowed for the hotness bar. GitHub Pages cannot send headers, hence meta.
export const CSP = [
  "default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", 'font-src https://fonts.gstatic.com',
  'img-src https: http:', "connect-src 'none'",
].join('; ');

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

// `html: true` passes pre-rendered (already escaped) markup as the link text.
const link = (href, text, cls = '', { html = false } = {}) => {
  const safe = safeUrl(href);
  const body = html ? text : escapeHtml(text);
  if (!safe) return `<span class="${cls}">${body}</span>`;
  return `<a class="${cls}" href="${escapeHtml(safe)}" target="_blank" rel="noopener">${body}</a>`;
};

// `code` spans in detail text; odd parts of a split on this are the code.
export const CODE_SPAN = /`([^`\n]+)`/;

const inlineHtml = (line) => line.split(CODE_SPAN)
  .map((part, i) => (i % 2 ? `<code>${escapeHtml(part)}</code>` : escapeHtml(part))).join('');

// Detail text from Claude: paragraphs split by blank lines; a block whose
// lines all start with "- " becomes a list; `x` becomes inline code. Every
// piece is escaped.
export function renderDetail(detail) {
  return String(detail ?? '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => l.startsWith('- '))) return `<ul>${lines.map((l) => `<li>${inlineHtml(l.slice(2))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(inlineHtml).join('<br>')}</p>`;
  }).join('\n');
}

// A quote line of a discussion section: `- "quote" — attribution`. Must
// match QUOTE_LINE in lib/detail.mjs and the parser in site/assets/app.js.
const DISC_QUOTE = /^- "(.+)" — (.+)$/;

// Discussion text from Claude (validated by parseDetail): a lead paragraph,
// a blank line, then quote lines. '' when the text is empty or unparsable.
export function renderDiscussion(text, lang) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines.findIndex((l) => l.startsWith('- '));
  if (first < 1) return '';
  const quotes = lines.slice(first).map((l) => DISC_QUOTE.exec(l));
  if (quotes.some((m) => !m)) return '';
  const items = quotes.map((m) => `<li><q>${escapeHtml(m[1])}</q> <span class="quote__by">${escapeHtml(m[2])}</span></li>`).join('');
  return `<div class="card__discussion"><h4 class="card__discussion-title">${escapeHtml(t('discussion', lang))}</h4><p class="card__discussion-lead">${escapeHtml(lines.slice(0, first).join(' '))}</p><ul class="quotes">${items}</ul></div>`;
}

export function renderCard(item, { large = false } = {}) {
  const group = groupOf(item.category);
  const hotPct = Math.round(Math.min(item.hotness / 2, 1) * 100);
  const extra = [
    safeUrl(item.discussionUrl) ? link(item.discussionUrl, 'discussion', 'card__link') : '',
    ...(item.extraLinks ?? []).filter(safeUrl).map((u, i) => link(u, `more ${i + 1}`, 'card__link')),
  ].filter(Boolean).join(' ');
  const imageSrc = safeUrl(item.imageUrl);
  const imageHref = safeUrl(item.url) ?? imageSrc;
  const image = imageSrc
    ? `<a href="${escapeHtml(imageHref)}" target="_blank" rel="noopener"><img class="card__img" loading="lazy" src="${escapeHtml(imageSrc)}" alt=""></a>`
    : '';
  const titleVi = typeof item.titleVi === 'string' && item.titleVi.trim() ? item.titleVi : null;
  const heading = pair(titleVi ?? item.title, item.title);
  const orig = titleVi ? `<span class="card__orig l l-vi" lang="en">${escapeHtml(item.title)}</span>` : '';
  const summaryEn = typeof item.summaryEn === 'string' && item.summaryEn.trim() ? item.summaryEn : null;
  const summary = pair(item.summary, summaryEn ?? (item.excerpt || item.summary), { cls: 'card__summary', fallbackEn: !summaryEn });
  const detailEn = typeof item.detailEn === 'string' && item.detailEn.trim() ? item.detailEn : null;
  const sourceLink = (lang) => `  <p class="card__source">${link(item.url, t('readOriginal', lang), 'card__go')}</p>`;
  const discussion = typeof item.discussion === 'string' && item.discussion.trim() ? item.discussion : null;
  const discussionEn = discussion && typeof item.discussionEn === 'string' && item.discussionEn.trim() ? item.discussionEn : null;
  // Without an English detail the English block borrows the Vietnamese one,
  // marked data-fallback and prefixed with a note. With no detail at all the
  // block holds only the discussion.
  const detailBlock = (lang, text, fallback, disc) => `<div class="card__detail l l-${lang}" lang="${lang}"${fallback ? ' data-fallback=""' : ''}>
${fallback ? `<p class="card__note">${escapeHtml(t('viOnly', 'en'))}</p>\n` : ''}${text ? renderDetail(text) : ''}
${disc ? renderDiscussion(disc, lang) : ''}
${sourceLink(lang)}
  </div>`;
  const head = item.detail || discussion
    ? `<details class="card__details">
  <summary class="card__head">
    <h3 class="card__title">${heading}</h3>
    ${orig}
    ${summary}
    <span class="card__toggle" aria-hidden="true"></span>
  </summary>
  ${detailBlock('vi', item.detail, false, discussion)}
  ${detailBlock('en', detailEn ?? item.detail, Boolean(item.detail) && !detailEn, discussionEn ?? discussion)}
</details>`
    : `<div class="card__head">
  <h3 class="card__title">${link(item.url, heading, '', { html: true })}</h3>
  ${orig}
  ${summary}
</div>`;
  const srcs = sourcesOf(item);
  const srcLine = srcs.length > 1
    ? `<span class="card__src">${escapeHtml(srcs.join(' · '))}</span> <span class="card__buzz">${tp('sourcesCount', srcs.length)}</span>`
    : `<span class="card__src">${escapeHtml(item.sourceName)}</span>`;
  const ownLabel = typeof item.categoryLabel === 'string' ? item.categoryLabel.trim() : '';
  const label = ownLabel ? pair(ownLabel, hotLabelEn(item.category)) : escapeHtml(CATEGORY_LABEL[item.category] || item.category);
  const labelAttr = ownLabel ? ` data-category-label="${escapeHtml(ownLabel)}"` : '';
  const data = `data-group="${group}" data-id="${escapeHtml(item.id)}" data-url="${escapeHtml(safeUrl(item.url) ?? '')}" data-category="${escapeHtml(item.category)}"${labelAttr} data-added="${escapeHtml(item.addedAt)}"`;
  return `<article class="card${large ? ' card--large' : ''}" ${data}>
  <div class="card__meta">
    <span class="chip chip--${group}">${label}</span>
    ${srcLine}
    <span class="card__fit" title="fit ${item.fit}/5">${'●'.repeat(item.fit)}${'○'.repeat(5 - item.fit)}</span>
    <button class="card__save" type="button" aria-pressed="false" aria-label="${escapeHtml(t('saveItem', 'vi'))}" title="${escapeHtml(t('save', 'vi'))}">${tp('save')}</button>
  </div>
  ${head}
  ${image}
  <div class="card__foot">
    <span class="tags">${(item.tags ?? []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</span>
    <span class="links">${extra}</span>
  </div>
  <div class="hot" style="--hot: ${hotPct}%"></div>
</article>`;
}

function renderFeed(items) {
  const byDate = new Map();
  for (const it of items) {
    if (!byDate.has(it.addedAt)) byDate.set(it.addedAt, []);
    byDate.get(it.addedAt).push(it);
  }
  const dates = [...byDate.keys()].sort().reverse();
  if (!dates.length) return `<p class="empty">${tp('noItems')}</p>`;
  return dates.map((d) => `<h2 class="divider" id="d-${d}">${d}</h2>\n<div class="list">${byDate.get(d).sort((a, b) => b.rank - a.rank).map((it) => renderCard(it)).join('\n')}</div>`).join('\n');
}

// `assetVersion` (a hash of site/assets/*, from build.mjs) goes on every asset
// URL so a freshly deployed page never runs with a cached older script or
// stylesheet: the two would disagree about the markup.
export function renderPage({ title, heading, items, hotNow, archiveDates, status, sourceNames, generatedAt, basePath, isArchive, pageSize, assetVersion = '' }) {
  const asset = (name) => `${basePath}assets/${name}${assetVersion ? `?v=${escapeHtml(String(assetVersion))}` : ''}`;
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
  const langSelect = `<span class="lang-wrap"><select id="lang" class="lang" aria-label="Language">${LANGS.map((l) => `<option value="${l}">${l === 'vi' ? 'Tiếng Việt' : 'English'}</option>`).join('')}</select></span>`;
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${escapeHtml(title)}</title>
<script src="${asset('lang.js')}"></script>
<meta name="description" content="Daily curated feed: AI, testing, IT, and IT humor.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;700&family=JetBrains+Mono:wght@400;500;700&display=swap">
<link rel="stylesheet" href="${asset('style.css')}">
</head>
<body data-page="${isArchive ? 'archive' : 'home'}">
<header class="top">
  <div class="top__row">
    <a class="brand" href="${basePath}index.html">${escapeHtml(heading)}</a>
    <span class="top__tools"><span class="top__date">${tp('refreshed')} ${escapeHtml(String(generatedAt).slice(0, 10))}</span> ${langSelect}</span>
  </div>
  <nav class="filters" aria-label="Category filter">${filters}</nav>
</header>
<main>
${notice}
${hot}
<section id="feed"${feedAttrs}>${renderFeed(items)}</section>
${homeTools}
${saved}
${archive}
</main>
<footer>
  <p>${tp('sourcesLine')} ${sourceNames.map(escapeHtml).join(' · ')}</p>
  <p>${tp('footerNote', sourceNames.length, failed)}</p>
  <p class="state-tools" hidden>${tp('browserData')} <button class="linkbtn" id="export" type="button">${tp('export')}</button> · <button class="linkbtn" id="import" type="button">${tp('import')}</button><input id="import-file" type="file" accept="application/json,.json" hidden> <span id="state-msg" role="status"></span></p>
</footer>
<script type="module" src="${asset('app.js')}"></script>
</body>
</html>
`;
}
