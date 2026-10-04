import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, groupOf, renderCard, renderPage } from '../lib/render.mjs';

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
