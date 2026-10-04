import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, groupOf, renderCard, renderDetail, renderPage, GROUP_LABEL } from '../lib/render.mjs';

const item = {
  id: '1', url: 'https://a.com/x', discussionUrl: 'https://news.ycombinator.com/item?id=1', extraLinks: ['https://b.com/y'],
  title: 'Hello <script>alert(1)</script> "quoted"', summary: 'Tóm tắt & chi tiết', tags: ['llm', 'x<y'],
  category: 'ai-tip', source: 'hn', sourceName: 'Hacker News', hotness: 1.2, fit: 4, rank: 0.96, addedAt: '2026-10-04', imageUrl: null, isMeme: false,
  publishedAt: '2026-10-03T10:00:00Z',
};
const meme = { ...item, id: '2', category: 'humor', imageUrl: 'https://i.redd.it/m.png', isMeme: true, discussionUrl: 'https://www.reddit.com/r/ProgrammerHumor/comments/a/b/', extraLinks: [] };

test('escapeHtml and groupOf', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.deepEqual(['ai-trend', 'test-db', 'it-general', 'humor'].map(groupOf), ['ai', 'testing', 'it', 'humor']);
});

test('renderCard escapes untrusted text and links every source (review focus 5)', () => {
  const html = renderCard(item);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('Hello &lt;script&gt;'));
  assert.ok(html.includes('x&lt;y'));
  assert.ok(html.includes('href="https://a.com/x"'));
  assert.ok(html.includes('href="https://news.ycombinator.com/item?id=1"'));
  assert.ok(html.includes('href="https://b.com/y"'));
  assert.ok(html.includes('data-group="ai"'));
  assert.ok(html.includes('chip--ai'));
  assert.ok(html.includes('--hot: 60%'), 'hotness 1.2 of max 2 = 60%');
  assert.ok(html.includes('target="_blank"') && html.includes('rel="noopener"'));
});

test('renderCard shows meme images lazily with an onerror fallback', () => {
  const html = renderCard(meme);
  assert.ok(html.includes('<img') && html.includes('loading="lazy"') && html.includes('src="https://i.redd.it/m.png"') && html.includes('onerror'));
  assert.ok(renderCard(item).includes('<img') === false);
});

test('renderPage builds hot-now, feed with date dividers, filters, archive, footer notice', () => {
  const html = renderPage({
    title: 'Daily Feed', heading: 'Daily Feed', items: [item, { ...item, id: '3', addedAt: '2026-10-03' }], hotNow: [meme],
    archiveDates: ['2026-10-04', '2026-10-03'], status: { curate: { ok: false, at: '2026-10-04T00:10:00Z' }, fetch: { failedSources: [{ id: 'x' }] } },
    sourceNames: ['Hacker News', 'xkcd'], generatedAt: '2026-10-04T00:15:00Z', basePath: '', isArchive: false,
  });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<title>Daily Feed</title>'));
  assert.ok(html.includes('href="assets/style.css"'));
  assert.ok(html.includes('fonts.googleapis.com') && html.includes('JetBrains+Mono'));
  assert.ok(html.includes('id="hot-now"'));
  for (const g of ['all', 'ai', 'testing', 'it', 'humor']) assert.ok(html.includes(`data-filter="${g}"`));
  assert.ok(html.includes('2026-10-04') && html.includes('2026-10-03'));
  assert.ok(html.includes('href="archive/2026-10-03.html"'));
  assert.ok(html.includes('Curation failed'));
  assert.ok(html.includes('Hacker News') && html.includes('xkcd'));
  const archive = renderPage({ title: 'Daily Feed · 2026-10-03', heading: '2026-10-03', items: [item], hotNow: [], archiveDates: [], status: {}, sourceNames: [], generatedAt: 'x', basePath: '../', isArchive: true });
  assert.ok(archive.includes('href="../assets/style.css"') && archive.includes('href="../index.html"'));
  assert.ok(!archive.includes('id="hot-now"'));
});

test('safeUrl allows only http(s); renderCard drops javascript:, data: and relative links (review fix 2)', async () => {
  const { safeUrl } = await import('../lib/render.mjs');
  assert.equal(safeUrl('https://a.com/x?q=1'), 'https://a.com/x?q=1');
  assert.equal(safeUrl('http://a.com'), 'http://a.com');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,hi'), null);
  assert.equal(safeUrl('post/123'), null);
  assert.equal(safeUrl(''), null);
  const html = renderCard({ ...item, url: 'javascript:alert(1)', discussionUrl: 'data:text/html,x', extraLinks: ['javascript:alert(3)', 'https://ok.com/z'], imageUrl: 'javascript:alert(2)' });
  assert.ok(!html.includes('javascript:') && !html.includes('data:text'));
  assert.ok(html.includes('href="https://ok.com/z"'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('Hello &lt;script&gt;'), 'title still shown as text when its url is unsafe');
});

test('renderCard without detail links the title; with titleVi shows it as heading and the English title below', () => {
  const plain = renderCard(item);
  assert.ok(!plain.includes('<details') && plain.includes('<h3 class="card__title"><a'));
  const vi = renderCard({ ...item, titleVi: 'Xin chào <b>' });
  assert.ok(vi.includes('Xin chào &lt;b&gt;') && vi.includes('class="card__orig" lang="en">Hello &lt;script&gt;'));
});

test('renderCard with detail expands in place and ends with the source link; detail is escaped', () => {
  const html = renderCard({ ...item, titleVi: 'Tiêu đề', detail: 'Đoạn <img src=x onerror=alert(1)>\ndòng hai\n\n- ý một\n- ý <b>hai</b>' });
  assert.ok(html.includes('<details class="card__details">') && html.includes('<summary class="card__head">'));
  assert.ok(html.includes('<p>Đoạn &lt;img src=x onerror=alert(1)&gt;<br>dòng hai</p>'));
  assert.ok(html.includes('<ul><li>ý một</li><li>ý &lt;b&gt;hai&lt;/b&gt;</li></ul>'));
  assert.ok(html.includes('href="https://a.com/x"') && html.includes('Đọc bài gốc'));
  assert.ok(!html.includes('<img src=x'));
  assert.equal(renderDetail(''), '');
  assert.ok(!renderCard({ ...item, detail: 'x', url: 'javascript:alert(1)' }).includes('javascript:'));
});

test('renderCard lists several sources escaped, single source unchanged (review focus 2)', () => {
  const multi = renderCard({ ...item, sources: ['Hacker News', 'Lobsters', '<b>x</b>'] });
  assert.ok(multi.includes('Hacker News · Lobsters · &lt;b&gt;x&lt;/b&gt;'));
  assert.ok(multi.includes('<span class="card__buzz">3 nguồn</span>'));
  const single = renderCard(item);
  assert.ok(single.includes('<span class="card__src">Hacker News</span>'));
  assert.ok(!single.includes('card__buzz'));
});

const page = (extra = {}) => renderPage({
  title: 'Daily Feed', heading: 'Daily Feed', items: [item], hotNow: [meme], archiveDates: ['2026-10-04'], status: {},
  sourceNames: ['Hacker News'], generatedAt: '2026-10-04T00:15:00Z', basePath: '', isArchive: false, pageSize: 40, ...extra,
});

test('renderCard carries escaped data attributes and a bookmark button (review focus 3)', () => {
  const html = renderCard({ ...item, id: 'a"<b', category: 'ai-tip' });
  assert.ok(html.includes('data-id="a&quot;&lt;b"'));
  assert.ok(html.includes('data-url="https://a.com/x"'));
  assert.ok(html.includes('data-category="ai-tip"') && html.includes('data-added="2026-10-04"'));
  assert.ok(html.includes('<button class="card__save" type="button" aria-pressed="false" aria-label="Lưu bài" title="Lưu">Save</button>'));
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

test('hot-* items render in the hot group with an escaped Vietnamese label (review focus 5)', () => {
  const hotItem = { id: 'a'.repeat(40), url: 'https://a.com/x', title: 'T', titleVi: 'TV', summary: 'S', category: 'hot-security', categoryLabel: '<img src=x onerror=alert(1)>', sourceName: 'Techmeme', tags: ['x'], fit: 3, hotness: 1, addedAt: '2026-10-04' };
  assert.equal(groupOf('hot-security'), 'hot');
  assert.equal(GROUP_LABEL.hot, 'Hot trên mạng');
  const html = renderCard(hotItem);
  assert.ok(html.includes('data-group="hot"'));
  assert.ok(html.includes('<span class="chip chip--hot">&lt;img src=x onerror=alert(1)&gt;</span>'), html);
  assert.ok(html.includes('data-category-label="&lt;img src=x onerror=alert(1)&gt;"'));
  assert.ok(!html.includes('<img src=x'));
  const plain = renderCard({ ...hotItem, category: 'ai-tip', categoryLabel: undefined });
  assert.ok(plain.includes('<span class="chip chip--ai">AI tip</span>'));
  assert.ok(!plain.includes('data-category-label'));
});

test('the filter bar has a Hot trên mạng pill', () => {
  assert.ok(page().includes('<button class="pill" data-filter="hot" type="button">Hot trên mạng</button>'));
});
