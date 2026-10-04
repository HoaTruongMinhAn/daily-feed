import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFeed, decodeEntities, stripHtml, firstImage } from '../lib/rss.mjs';

const rss = readFileSync(new URL('./fixtures/rss-sample.xml', import.meta.url), 'utf8');
const atom = readFileSync(new URL('./fixtures/atom-sample.xml', import.meta.url), 'utf8');

test('parseFeed reads RSS 2.0 items with CDATA and entity-encoded bodies', () => {
  const items = parseFeed(rss);
  assert.equal(items.length, 2, 'item without link is skipped');
  assert.equal(items[0].title, 'Playwright & AI: 5 tips');
  assert.equal(items[0].link, 'https://testguild.com/playwright-ai-tips/?utm_source=rss');
  assert.equal(items[0].publishedAt, '2026-10-03T09:00:00.000Z');
  assert.equal(items[0].description, 'Five practical tips.');
  assert.equal(items[0].imageUrl, 'https://testguild.com/img/pw.png');
  assert.equal(items[1].description, 'Hello & welcome');
  assert.equal(items[1].imageUrl, null);
});

test('parseFeed reads Atom entries and self-closing links', () => {
  const items = parseFeed(atom);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Unit Tests');
  assert.equal(items[0].link, 'https://xkcd.com/3100/');
  assert.equal(items[0].publishedAt, '2026-10-03T00:00:00.000Z');
  assert.equal(items[0].imageUrl, 'https://imgs.xkcd.com/comics/unit_tests.png');
});

test('helpers', () => {
  assert.equal(decodeEntities('a &amp; b &#39;c&#x27; &lt;x&gt;'), "a & b 'c' <x>");
  assert.equal(stripHtml('<p>Hi<br/> there</p>'), 'Hi there');
  assert.equal(firstImage('<div><img class="x" src="https://a/b.png"></div>'), 'https://a/b.png');
  assert.equal(firstImage('no image'), null);
  assert.equal(parseFeed('<rss><channel></channel></rss>').length, 0);
});
