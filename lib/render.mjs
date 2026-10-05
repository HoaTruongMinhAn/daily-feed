import { sourcesOf } from './candidate.mjs';
import { GROUP_LABEL, CATEGORY_LABEL } from '../site/assets/strings.js';
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

const link = (href, text, cls = '') => {
  const safe = safeUrl(href);
  if (!safe) return `<span class="${cls}">${escapeHtml(text)}</span>`;
  return `<a class="${cls}" href="${escapeHtml(safe)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`;
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
  const heading = titleVi ?? item.title;
  const orig = titleVi ? `<span class="card__orig" lang="en">${escapeHtml(item.title)}</span>` : '';
  const summary = `<span class="card__summary">${escapeHtml(item.summary)}</span>`;
  const head = item.detail
    ? `<details class="card__details">
  <summary class="card__head">
    <h3 class="card__title">${escapeHtml(heading)}</h3>
    ${orig}
    ${summary}
    <span class="card__toggle" aria-hidden="true"></span>
  </summary>
  <div class="card__detail">
${renderDetail(item.detail)}
  <p class="card__source">${link(item.url, 'Đọc bài gốc', 'card__go')}</p>
  </div>
</details>`
    : `<div class="card__head">
  <h3 class="card__title">${link(item.url, heading)}</h3>
  ${orig}
  ${summary}
</div>`;
  const srcs = sourcesOf(item);
  const srcLine = srcs.length > 1
    ? `<span class="card__src">${escapeHtml(srcs.join(' · '))}</span> <span class="card__buzz">${srcs.length} nguồn</span>`
    : `<span class="card__src">${escapeHtml(item.sourceName)}</span>`;
  const ownLabel = typeof item.categoryLabel === 'string' ? item.categoryLabel.trim() : '';
  const label = ownLabel || CATEGORY_LABEL[item.category] || item.category;
  const labelAttr = ownLabel ? ` data-category-label="${escapeHtml(ownLabel)}"` : '';
  const data = `data-group="${group}" data-id="${escapeHtml(item.id)}" data-url="${escapeHtml(safeUrl(item.url) ?? '')}" data-category="${escapeHtml(item.category)}"${labelAttr} data-added="${escapeHtml(item.addedAt)}"`;
  return `<article class="card${large ? ' card--large' : ''}" ${data}>
  <div class="card__meta">
    <span class="chip chip--${group}">${escapeHtml(label)}</span>
    ${srcLine}
    <span class="card__fit" title="fit ${item.fit}/5">${'●'.repeat(item.fit)}${'○'.repeat(5 - item.fit)}</span>
    <button class="card__save" type="button" aria-pressed="false" aria-label="Lưu bài" title="Lưu">Save</button>
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
  if (!dates.length) return '<p class="empty">No new items today. Check the archive below.</p>';
  return dates.map((d) => `<h2 class="divider" id="d-${d}">${d}</h2>\n<div class="list">${byDate.get(d).sort((a, b) => b.rank - a.rank).map((it) => renderCard(it)).join('\n')}</div>`).join('\n');
}

export function renderPage({ title, heading, items, hotNow, archiveDates, status, sourceNames, generatedAt, basePath, isArchive, pageSize }) {
  const filters = ['all', ...Object.keys(GROUP_LABEL)]
    .map((g) => `<button class="pill" data-filter="${g}" type="button">${g === 'all' ? 'All' : GROUP_LABEL[g].vi}</button>`).join('')
    + '<button class="pill pill--saved" data-view="saved" type="button" aria-pressed="false">Saved <span data-saved-count></span></button>';
  const feedAttrs = !isArchive && pageSize ? ` data-page-size="${Number(pageSize)}"` : '';
  const homeTools = isArchive ? '' : `<div class="feed-tools">
  <button id="feed-more" class="pill" type="button" hidden>Xem thêm</button>
  <p id="read-hidden" hidden><span data-count>0</span> bài đã đọc đang ẩn · <button class="linkbtn" id="show-read" type="button">Hiện</button></p>
  <p id="all-read" class="empty" hidden>Bạn đã đọc hết. Xem lưu trữ bên dưới.</p>
</div>`;
  const saved = '<section id="saved" hidden><h2>Saved</h2><div class="list"></div><p id="saved-empty" class="empty" hidden>Chưa có bài đã lưu</p></section>';
  const hot = !isArchive && hotNow.length
    ? `<section id="hot-now"><h2>Hot now</h2><div class="grid">${hotNow.map((it) => renderCard(it, { large: true })).join('\n')}</div></section>`
    : '';
  const archive = archiveDates.length
    ? `<section class="archive"><h2>Archive</h2><p>${archiveDates.map((d) => `<a href="${basePath}archive/${d}.html">${d}</a>`).join(' · ')}</p></section>`
    : '';
  const failed = status?.fetch?.failedSources?.length ?? 0;
  const notice = status?.curate && status.curate.ok === false
    ? `<p class="notice">Curation failed on ${escapeHtml((status.curate.at ?? '').slice(0, 10))}; showing previous items.</p>`
    : '';
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${escapeHtml(title)}</title>
<meta name="description" content="Daily curated feed: AI, testing, IT, and IT humor.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;700&family=JetBrains+Mono:wght@400;500;700&display=swap">
<link rel="stylesheet" href="${basePath}assets/style.css">
</head>
<body data-page="${isArchive ? 'archive' : 'home'}">
<header class="top">
  <div class="top__row">
    <a class="brand" href="${basePath}index.html">${escapeHtml(heading)}</a>
    <span class="top__date">refreshed ${escapeHtml(String(generatedAt).slice(0, 10))}</span>
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
  <p>Sources: ${sourceNames.map(escapeHtml).join(' · ')}</p>
  <p>Refreshed from ${sourceNames.length} sources${failed ? ` (${failed} failed this run)` : ''} · every item links to where it came from.</p>
  <p class="state-tools" hidden>Dữ liệu trên trình duyệt này: <button class="linkbtn" id="export" type="button">Xuất</button> · <button class="linkbtn" id="import" type="button">Nhập</button><input id="import-file" type="file" accept="application/json,.json" hidden> <span id="state-msg" role="status"></span></p>
</footer>
<script type="module" src="${basePath}assets/app.js"></script>
</body>
</html>
`;
}
