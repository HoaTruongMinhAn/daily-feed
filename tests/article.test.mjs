import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { htmlToText, decodeEntities, fetchArticleText, isPublicAddress, publicOnlyLookup } from '../lib/article.mjs';

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

// requestRaw stand-in: routes map url -> { status?, type?, body?, location? }.
const fakePage = (routes, calls = []) => async (url, opts) => {
  calls.push({ url, opts });
  const r = routes[url];
  if (!r) return { status: 404, headers: {}, text: '' };
  const headers = { ...(r.type ? { 'content-type': r.type } : {}), ...(r.location ? { location: r.location } : {}) };
  return { status: r.status ?? 200, headers, text: r.body ?? '' };
};

test('fetchArticleText uses the README for GitHub repos and the item API for HN posts', async () => {
  const fetchImpl = fakeFetch({
    'https://api.github.com/repos/o/r/readme': { type: 'application/json', body: JSON.stringify({ content: Buffer.from('# Tool\n\n<img src=x>Does things.').toString('base64') }) },
    'https://hn.algolia.com/api/v1/items/42': { type: 'application/json', body: JSON.stringify({ text: '<p>Ask HN: how do you test LLM apps?</p>' }) },
  });
  const getPage = fakePage({
    'https://blog.example/post': { type: 'text/html; charset=utf-8', body: html },
    'https://blog.example/paper.pdf': { type: 'application/pdf', body: '%PDF' },
  });
  assert.equal(await fetchArticleText('https://github.com/o/r', { fetchImpl, getPage }), '# Tool\n\nDoes things.');
  assert.equal(await fetchArticleText('https://news.ycombinator.com/item?id=42', { fetchImpl, getPage }), 'Ask HN: how do you test LLM apps?');
  assert.ok((await fetchArticleText('https://blog.example/post', { fetchImpl, getPage })).startsWith('Flaky tests'));
  await assert.rejects(fetchArticleText('https://blog.example/paper.pdf', { fetchImpl, getPage }), /content-type/);
  assert.equal(await fetchArticleText('javascript:alert(1)', { fetchImpl, getPage }), null);
});

test('isPublicAddress rejects loopback, private, link-local, CGNAT, multicast and mapped forms', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', 'not-an-ip']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['93.184.216.34', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) assert.equal(isPublicAddress(ip), true, ip);
});

test('publicOnlyLookup passes public answers through and refuses any non-public one', async () => {
  const dnsFake = (answers) => (h, o, cb) => cb(null, answers);
  const run = (lookup, opts) => new Promise((r) => lookup('h.example', opts, (...a) => r(a)));
  assert.deepEqual(await run(publicOnlyLookup(dnsFake([{ address: '93.184.216.34', family: 4 }])), {}), [null, '93.184.216.34', 4]);
  assert.deepEqual(await run(publicOnlyLookup(dnsFake([{ address: '93.184.216.34', family: 4 }])), { all: true }), [null, [{ address: '93.184.216.34', family: 4 }]]);
  const [err] = await run(publicOnlyLookup(dnsFake([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }])), {});
  assert.match(err.message, /non-public address/);
});

test('fetchArticleText refuses private IP literals and redirects into the LAN, and follows public redirects', async () => {
  const calls = [];
  const getPage = fakePage({
    'https://short.example/a': { status: 301, location: 'http://192.168.1.1/admin' },
    'https://short.example/b': { status: 302, location: '/post' },
    'https://short.example/post': { type: 'text/html', body: html },
    'https://loop.example/': { status: 302, location: '/' },
  }, calls);
  for (const url of ['http://127.0.0.1:8080/', 'http://[::1]/', 'http://2130706433/', 'http://169.254.169.254/latest/meta-data/', 'https://short.example/a']) {
    await assert.rejects(fetchArticleText(url, { getPage }), /non-public/, url);
  }
  assert.ok(!calls.some((c) => c.url.includes('192.168') || c.url.includes('127.0') || c.url.includes('169.254')));
  assert.ok((await fetchArticleText('https://short.example/b', { getPage })).startsWith('Flaky tests'));
  assert.ok(calls.every((c) => typeof c.opts.lookup === 'function' && c.opts.maxBytes > 0));
  await assert.rejects(fetchArticleText('https://loop.example/', { getPage }), /too many redirects/);
});

test('fetchArticleText with the real request path refuses a hostname that resolves to loopback', async () => {
  const server = createServer((req, res) => res.end('<p>secret</p>'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(fetchArticleText(`http://localhost:${server.address().port}/`), /non-public address/);
  } finally { server.close(); }
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
