export const GROUP_LABEL = { ai: 'AI', testing: 'Testing', it: 'IT', humor: 'Humor' };
export const CATEGORY_LABEL = {
  'ai-trend': 'AI trend', 'ai-product-idea': 'Product idea', 'ai-tip': 'AI tip',
  'test-automation': 'Automation', 'test-manual': 'Manual testing', 'test-db': 'Database', 'test-api': 'API testing', 'test-perf': 'Performance',
  'it-general': 'IT', humor: 'Humor',
};

export function groupOf(category) {
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

const link = (href, text, cls = '') => `<a class="${cls}" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`;

export function renderCard(item, { large = false } = {}) {
  const group = groupOf(item.category);
  const hotPct = Math.round(Math.min(item.hotness / 2, 1) * 100);
  const extra = [
    item.discussionUrl ? link(item.discussionUrl, 'discussion', 'card__link') : '',
    ...(item.extraLinks ?? []).map((u, i) => link(u, `more ${i + 1}`, 'card__link')),
  ].filter(Boolean).join(' ');
  const image = item.imageUrl
    ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener"><img class="card__img" loading="lazy" src="${escapeHtml(item.imageUrl)}" alt="" onerror="this.parentNode.remove()"></a>`
    : '';
  return `<article class="card${large ? ' card--large' : ''}" data-group="${group}">
  <div class="card__meta">
    <span class="chip chip--${group}">${escapeHtml(CATEGORY_LABEL[item.category] ?? item.category)}</span>
    <span class="card__src">${escapeHtml(item.sourceName)}</span>
    <span class="card__fit" title="fit ${item.fit}/5">${'●'.repeat(item.fit)}${'○'.repeat(5 - item.fit)}</span>
  </div>
  <h3 class="card__title">${link(item.url, item.title)}</h3>
  ${image}
  <p class="card__summary">${escapeHtml(item.summary)}</p>
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

export function renderPage({ title, heading, items, hotNow, archiveDates, status, sourceNames, generatedAt, basePath, isArchive }) {
  const filters = ['all', ...Object.keys(GROUP_LABEL)]
    .map((g) => `<button class="pill" data-filter="${g}" type="button">${g === 'all' ? 'All' : GROUP_LABEL[g]}</button>`).join('');
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
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="Daily curated feed: AI, testing, IT, and IT humor.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap">
<link rel="stylesheet" href="${basePath}assets/style.css">
</head>
<body>
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
<section id="feed">${renderFeed(items)}</section>
${archive}
</main>
<footer>
  <p>Sources: ${sourceNames.map(escapeHtml).join(' · ')}</p>
  <p>Refreshed from ${sourceNames.length} sources${failed ? ` (${failed} failed this run)` : ''} · every item links to where it came from.</p>
</footer>
<script>
(function () {
  var buttons = document.querySelectorAll('[data-filter]');
  function apply(g) {
    buttons.forEach(function (b) { b.classList.toggle('is-active', b.dataset.filter === g); });
    document.querySelectorAll('[data-group]').forEach(function (c) { c.hidden = g !== 'all' && c.dataset.group !== g; });
    document.querySelectorAll('.list').forEach(function (l) {
      var visible = l.querySelector('[data-group]:not([hidden])');
      var h = l.previousElementSibling; if (h && h.classList.contains('divider')) h.hidden = !visible;
    });
    if (history.replaceState) history.replaceState(null, '', g === 'all' ? location.pathname : '#' + g);
  }
  buttons.forEach(function (b) { b.addEventListener('click', function () { apply(b.dataset.filter); }); });
  var initial = location.hash.slice(1);
  apply(['ai', 'testing', 'it', 'humor'].indexOf(initial) >= 0 ? initial : 'all');
})();
</script>
</body>
</html>
`;
}
