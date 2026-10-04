import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { htmlToText, decodeEntities, fetchArticleText } from '../lib/article.mjs';

const html = readFileSync(new URL('./fixtures/article.html', import.meta.url), 'utf8');

test('htmlToText keeps the article body and drops scripts, nav, aside, footer', () => {
  const text = htmlToText(html);
  assert.ok(text.startsWith('Flaky tests & how to kill them'));
  assert.ok(text.includes('- Isolate fixtures per test'));
  assert.ok(text.includes('4.1% to 0.3% over six weeks — measured'));
  for (const gone of ['alert', 'color:red', 'Home', 'newsletter', '© 2026']) assert.ok(!text.includes(gone), gone);
  assert.ok(!/\n{3,}/.test(text));
});

test('htmlToText caps length and decodeEntities handles numeric and named entities', () => {
  assert.equal(htmlToText(html, 20).length, 20);
  assert.equal(decodeEntities('&lt;a&gt; &#65;&#x42; &bogus; &amp;amp;'), '<a> AB &bogus; &amp;');
});

const fakeFetch = (routes) => async (url) => {
  const r = routes[url];
  if (!r) return { ok: false, status: 404, headers: new Headers(), text: async () => '' };
  return { ok: true, status: 200, headers: new Headers({ 'content-type': r.type }), text: async () => r.body };
};

test('fetchArticleText uses the README for GitHub repos and the item API for HN posts', async () => {
  const fetchImpl = fakeFetch({
    'https://api.github.com/repos/o/r/readme': { type: 'application/json', body: JSON.stringify({ content: Buffer.from('# Tool\n\n<img src=x>Does things.').toString('base64') }) },
    'https://hn.algolia.com/api/v1/items/42': { type: 'application/json', body: JSON.stringify({ text: '<p>Ask HN: how do you test LLM apps?</p>' }) },
    'https://blog.example/post': { type: 'text/html; charset=utf-8', body: html },
    'https://blog.example/paper.pdf': { type: 'application/pdf', body: '%PDF' },
  });
  assert.equal(await fetchArticleText('https://github.com/o/r', { fetchImpl }), '# Tool\n\nDoes things.');
  assert.equal(await fetchArticleText('https://news.ycombinator.com/item?id=42', { fetchImpl }), 'Ask HN: how do you test LLM apps?');
  assert.ok((await fetchArticleText('https://blog.example/post', { fetchImpl })).startsWith('Flaky tests'));
  await assert.rejects(fetchArticleText('https://blog.example/paper.pdf', { fetchImpl }), /content-type/);
  assert.equal(await fetchArticleText('javascript:alert(1)', { fetchImpl }), null);
});

test('htmlToText without <article>/<main> keeps prose blocks and drops short menu and form text', () => {
  const page = `<body><div class="menu"><a>Home</a> <a>Blog</a></div><div><span>EMAIL ADDRESS</span><span>REQUIRED</span></div>
<div class="content"><h2>Scheduler results</h2><p>${'The new scheduler packs GPU jobs tighter than the default one. '.repeat(3)}</p>
<ul><li>Home</li><li>Bin-packing by GPU memory rather than by GPU count alone</li></ul><p>${'Utilisation rose from 41% to 78% on the same cluster. '.repeat(3)}</p></div></body>`;
  const text = htmlToText(page);
  assert.ok(text.startsWith('Scheduler results'));
  assert.ok(text.includes('- Bin-packing by GPU memory') && text.includes('Utilisation rose'));
  for (const gone of ['Home', 'EMAIL ADDRESS', 'REQUIRED']) assert.ok(!text.includes(gone), gone);
});
