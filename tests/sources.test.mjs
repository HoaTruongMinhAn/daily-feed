import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adapters } from '../lib/sources/index.mjs';
import { sources } from '../config/sources.mjs';
import { tootText } from '../lib/sources/mastodon.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const text = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const now = Date.parse('2026-10-04T00:00:00Z');

test('hn adapter maps hits, uses the thread as url when none, skips untitled', async () => {
  const out = await adapters.hn({ id: 'hn-front', name: 'Hacker News', family: 'hn', url: 'u', categoryHint: 'it', p90: 300 }, { fetchJson: async () => fixture('hn.json'), now });
  assert.equal(out.length, 2);
  assert.equal(out[0].url, 'https://anthropic.com/news/agent-sdk-2');
  assert.equal(out[0].discussionUrl, 'https://news.ycombinator.com/item?id=100');
  assert.equal(out[0].engagement, 420 + 2 * 50);
  assert.equal(out[1].engagement, 95, 'missing num_comments counts as 0');
  assert.equal(out[0].source, 'hn');
  assert.equal(out[1].url, 'https://news.ycombinator.com/item?id=101');
});

test('reddit adapter: reads through the client, memes get imageUrl, engagement counts comments (review focus 2)', async () => {
  const src = { id: 'r-humor', name: 'r/ProgrammerHumor', family: 'reddit', sub: 'ProgrammerHumor', t: 'week', categoryHint: 'humor', p90: 12000, isMeme: true };
  let asked;
  const redditClient = { top: async (sub, t) => { asked = [sub, t]; return fixture('reddit.json'); } };
  const out = await adapters.reddit(src, { redditClient, now });
  assert.deepEqual(asked, ['ProgrammerHumor', 'week']);
  assert.equal(out.length, 3);
  assert.equal(out[0].imageUrl, 'https://i.redd.it/meme1.png');
  assert.equal(out[0].isMeme, true);
  assert.equal(out[0].engagement, 5400 + 2 * 300);
  assert.equal(out[0].discussionUrl, 'https://www.reddit.com/r/ProgrammerHumor/comments/abc/when_the_test/');
  assert.equal(out[1].imageUrl, null);
  assert.equal(out[2].url, 'https://reddit.com/r/QualityAssurance/comments/jkl/flaky');
  assert.equal(out[2].excerpt, 'We cut flaky tests by 80% by...');
  assert.equal(out[2].source, 'reddit:r/QualityAssurance');
  assert.equal(out[0].publishedAt, new Date(1791072000 * 1000).toISOString());
  await assert.rejects(adapters.reddit(src, { now }), /reddit client not configured/);
});

test('github adapter builds a dated query and titles repos', async () => {
  let requested;
  const src = { id: 'gh-testing', name: 'GitHub', family: 'github', query: 'topic:testing', createdWithinDays: 30, categoryHint: 'testing', p90: 1000 };
  const out = await adapters.github(src, { fetchJson: async (url) => { requested = url; return fixture('github.json'); }, now });
  assert.match(requested, /created%3A%3E2026-09-04/);
  assert.equal(out[0].title, 'acme/llm-test-kit: Evaluate LLM apps in CI');
  assert.equal(out[0].engagement, 1200);
  assert.equal(out[0].publishedAt, '2026-10-03T08:00:00Z');
  assert.equal(out[1].title, 'acme/nodesc');
});

test('devto adapter maps articles', async () => {
  const out = await adapters.devto({ id: 'devto-ai', name: 'dev.to', family: 'devto', url: 'u', categoryHint: 'ai', p90: 100 }, { fetchJson: async () => fixture('devto.json'), now });
  assert.equal(out[0].url, 'https://dev.to/x/playwright-fixtures');
  assert.equal(out[0].engagement, 88 + 2 * 6);
  assert.equal(out[0].excerpt, 'Fixtures done right.');
});

test('rss adapter maps feed entries; memes keep images; missing dates become now', async () => {
  const src = { id: 'xkcd', name: 'xkcd', family: 'rss', url: 'u', categoryHint: 'humor', p90: 1, isMeme: true };
  const out = await adapters.rss(src, { fetchText: async () => text('atom-sample.xml'), now });
  assert.equal(out[0].imageUrl, 'https://imgs.xkcd.com/comics/unit_tests.png');
  assert.equal(out[0].engagement, 1);
  assert.equal(out[0].source, 'rss:xkcd');
  const noDate = await adapters.rss({ ...src, isMeme: false }, { fetchText: async () => '<rss><channel><item><title>t</title><link>https://a.com/x</link><description><img src="https://a/i.png"></description></item></channel></rss>', now });
  assert.equal(noDate[0].publishedAt, new Date(now).toISOString());
  assert.equal(noDate[0].imageUrl, null);
});

test('config/sources.mjs entries are well formed', () => {
  assert.ok(sources.length >= 12);
  for (const s of sources) {
    assert.ok(adapters[s.family], `${s.id} unknown family ${s.family}`);
    assert.ok(['ai', 'testing', 'it', 'humor', 'hot'].includes(s.categoryHint), `${s.id} bad hint`);
    assert.ok(s.p90 > 0, `${s.id} needs p90`);
    assert.ok(s.url || s.query || s.sub || s.tag || s.feed || s.mode, `${s.id} needs url, query, sub, tag, feed or mode`);
  }
  assert.equal(new Set(sources.map((s) => s.id)).size, sources.length, 'ids unique');
});

test('reddit sources are enabled and name a subreddit', () => {
  const r = sources.filter((s) => s.family === 'reddit');
  assert.ok(r.length >= 7);
  for (const s of r) {
    assert.match(s.sub, /^[A-Za-z0-9_]+$/, s.id);
    assert.equal(s.disabled, undefined, s.id);
    assert.ok(['day', 'week'].includes(s.t ?? 'day'), s.id);
  }
});

test('hn adapter builds a recency-bounded search url when given query/minPoints instead of url', async () => {
  let requested;
  const src = { id: 'hn-llm', name: 'Hacker News', family: 'hn', query: 'LLM', minPoints: 40, sinceHours: 72, categoryHint: 'ai', p90: 200 };
  await adapters.hn(src, { fetchJson: async (url) => { requested = url; return fixture('hn.json'); }, now });
  const since = Math.floor(now / 1000) - 72 * 3600;
  assert.match(requested, /^https:\/\/hn\.algolia\.com\/api\/v1\/search\?query=LLM&tags=story&numericFilters=/);
  assert.ok(requested.includes(`created_at_i>${since}`), requested);
  assert.ok(requested.includes('points>40'), requested);
});

test('mastodon tag mode: card link wins, toot is the discussion, HTML stripped, empty posts skipped', async () => {
  let asked;
  const src = { id: 'm', name: 'Mastodon', family: 'mastodon', instance: 'hachyderm.io', tag: 'softwaretesting', categoryHint: 'testing', p90: 20 };
  const out = await adapters.mastodon(src, { fetchJson: async (u) => { asked = u; return fixture('mastodon-tag.json'); }, now });
  assert.equal(asked, 'https://hachyderm.io/api/v1/timelines/tag/softwaretesting?limit=40');
  assert.equal(out.length, 2);
  assert.equal(out[0].url, 'https://blog.example.com/flaky');
  assert.equal(out[0].discussionUrl, 'https://hachyderm.io/@ana/1');
  assert.equal(out[0].title, 'Taming flaky tests');
  assert.equal(out[0].engagement, 12 + 30 + 2 * 4);
  assert.equal(out[0].source, 'mastodon:hachyderm.io');
  assert.equal(out[1].url, 'https://hachyderm.io/@bo/2');
  assert.equal(out[1].discussionUrl, null);
  assert.equal(out[1].title, 'Hot take: #qa is a role, not a phase');
  assert.ok(!out[1].excerpt.includes('<'), out[1].excerpt);
});

test('tootText decodes entities after stripping tags, so markup cannot be re-created', () => {
  assert.equal(tootText('<p>a &amp; b</p><p>c</p>'), 'a & b\nc');
  assert.equal(tootText('<p>&lt;img src=x onerror=1&gt;</p>'), '<img src=x onerror=1>', 'decoded text is plain data; render escapes it');
});

test('mastodon trendsLinks: engagement sums accounts, publishedAt is now, url-less links skipped', async () => {
  const src = { id: 'mt', name: 'Mastodon trends', family: 'mastodon', instance: 'hachyderm.io', mode: 'trendsLinks', categoryHint: 'hot', p90: 50 };
  let asked;
  const out = await adapters.mastodon(src, { fetchJson: async (u) => { asked = u; return fixture('mastodon-trends.json'); }, now });
  assert.equal(asked, 'https://hachyderm.io/api/v1/trends/links?limit=40');
  assert.equal(out.length, 1);
  assert.equal(out[0].engagement, 40);
  assert.equal(out[0].publishedAt, new Date(now).toISOString());
  assert.equal(out[0].categoryHint, 'hot');
});

test('bluesky adapter: external embed becomes the link, text posts link to bsky.app, broken posts skipped', async () => {
  let asked;
  const feed = 'at://did:plc:x/app.bsky.feed.generator/whats-llm';
  const out = await adapters.bluesky({ id: 'b', name: 'Bluesky', family: 'bluesky', feed, categoryHint: 'ai', p90: 30 }, { fetchJson: async (u) => { asked = u; return fixture('bluesky-feed.json'); }, now });
  assert.equal(asked, `https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=${encodeURIComponent(feed)}&limit=50`);
  assert.equal(out.length, 2);
  assert.equal(out[0].url, 'https://example.com/llm-evals');
  assert.equal(out[0].discussionUrl, 'https://bsky.app/profile/ana.bsky.social/post/3kx1');
  assert.equal(out[0].engagement, 10 + 40 + 2 * 5);
  assert.equal(out[1].url, 'https://bsky.app/profile/bo.dev/post/3kx2');
  assert.equal(out[1].title, 'When the test passes on the first try');
});

test('lobsters adapter: score + 2*comments, text posts use the comments page', async () => {
  let asked;
  const out = await adapters.lobsters({ id: 'l', name: 'Lobsters', family: 'lobsters', tag: 'testing', categoryHint: 'testing', p90: 60 }, { fetchJson: async (u) => { asked = u; return fixture('lobsters.json'); }, now });
  assert.equal(asked, 'https://lobste.rs/t/testing.json');
  assert.equal(out[0].engagement, 38 + 28);
  assert.equal(out[0].discussionUrl, 'https://lobste.rs/s/2r2sg8/finding_bugs');
  assert.equal(out[1].url, 'https://lobste.rs/s/ab12cd/ask_how_do_you_test');
  assert.equal(out[1].excerpt, 'We run them twice.');
});

test('dailydev adapter: POSTs the GraphQL query, shares use the shared article, link-less posts use the daily.dev page', async () => {
  let asked;
  const fetchJson = async (u, opts) => { asked = { u, ...opts, body: JSON.parse(opts.body) }; return fixture('dailydev.json'); };
  const out = await adapters.dailydev({ id: 'd', name: 'daily.dev', family: 'dailydev', feed: 'mostDiscussedFeed', period: 3, categoryHint: 'it', p90: 100 }, { fetchJson, now });
  assert.equal(asked.u, 'https://api.daily.dev/graphql');
  assert.equal(asked.method, 'POST');
  assert.equal(asked.headers['content-type'], 'application/json');
  assert.match(asked.body.query, /feed: mostDiscussedFeed\(/);
  assert.deepEqual(asked.body.variables, { first: 50, period: 3 });
  assert.equal(out.length, 3);
  assert.equal(out[0].url, 'https://leaddev.com/ai/meet-the-developers-rejecting-ai');
  assert.equal(out[0].discussionUrl, 'https://daily.dev/posts/meet-the-developers-rejecting-ai-mgfmaufls');
  assert.equal(out[0].engagement, 271 + 2 * 75);
  assert.equal(out[0].excerpt, 'A growing number of developers are publicly rejecting AI coding tools.');
  assert.equal(out[0].source, 'dailydev');
  assert.equal(out[1].title, 'The birth of the Software Verification Engineer');
  assert.equal(out[1].url, 'https://blog.reqproof.com/p/the-birth-of-the-software-verification');
  assert.equal(out[1].engagement, 78, 'missing numComments counts as 0');
  assert.equal(out[2].url, 'https://daily.dev/posts/a-post-with-no-link-nourl1234');
});

test('dailydev adapter: only the two known feeds are queried, and GraphQL errors throw', async () => {
  const src = { id: 'd', name: 'daily.dev', family: 'dailydev', feed: 'mostUpvotedFeed', categoryHint: 'it', p90: 80 };
  await assert.rejects(adapters.dailydev({ ...src, feed: 'post(id: "x") { title } x: mostUpvotedFeed' }, { fetchJson: async () => fixture('dailydev.json'), now }), /unknown daily\.dev feed/);
  await assert.rejects(adapters.dailydev(src, { fetchJson: async () => ({ errors: [{ message: 'Unknown argument' }] }), now }), /daily\.dev: Unknown argument/);
});

test('dailydev adapter: tagFeed asks for the newest posts of each tag in one request and merges repeats', async () => {
  let body;
  const fetchJson = async (u, opts) => { body = JSON.parse(opts.body); return fixture('dailydev-tags.json'); };
  const out = await adapters.dailydev({ id: 'd', name: 'daily.dev', family: 'dailydev', feed: 'tagFeed', tags: ['testing', 'playwright'], categoryHint: 'testing', p90: 3 }, { fetchJson, now });
  assert.match(body.query, /t0: tagFeed\(tag: \$t0, first: \$first, ranking: TIME\)/);
  assert.match(body.query, /t1: tagFeed\(tag: \$t1,/);
  assert.deepEqual(body.variables, { first: 50, t0: 'testing', t1: 'playwright' });
  assert.deepEqual(out.map((c) => c.title), ['Why Every QA Wolf AI Agent Gets Its Own Computer', 'Test logging with ReplaceAttr']);
  assert.equal(out[1].engagement, 3);
  assert.equal(out[0].engagement, 1, 'unvoted posts count as 1, like RSS');
  await assert.rejects(adapters.dailydev({ id: 'd', name: 'daily.dev', family: 'dailydev', feed: 'tagFeed', tags: [], categoryHint: 'testing', p90: 3 }, { fetchJson, now }), /needs tags/);
});
