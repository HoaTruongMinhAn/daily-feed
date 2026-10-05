import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyThread, htmlToPlain, normaliseComments, discussionBlock, commentsText, SOURCE_NAME, threadsOf, commentAdapters, fetchComments } from '../lib/comments.mjs';

const cfg = { discussionMaxComments: 12, discussionMinComments: 3, discussionCommentChars: 600 };
const long = (s) => `${s} ${'word '.repeat(12)}`.trim();   // comfortably over 40 chars

test('classifyThread recognises each host family and rejects the rest', () => {
  assert.deepEqual(classifyThread('https://news.ycombinator.com/item?id=49949235'), { kind: 'hn', source: 'Hacker News', id: '49949235' });
  assert.equal(classifyThread('https://news.ycombinator.com/item?id=abc'), null, 'HN id must be digits');
  assert.deepEqual(classifyThread('https://lobste.rs/s/xkwswd/we_re_going_need'), { kind: 'lobsters', source: 'Lobsters', short: 'xkwswd' });
  assert.deepEqual(classifyThread('https://mas.to/@vnzn/117384254326007619'), { kind: 'mastodon', source: 'Mastodon', host: 'mas.to', id: '117384254326007619' });
  assert.deepEqual(classifyThread('https://hachyderm.io/users/bob/statuses/42'), { kind: 'mastodon', source: 'Mastodon', host: 'hachyderm.io', id: '42' });
  assert.equal(classifyThread('https://127.0.0.1/@x/1'), null, 'IP literal host refused');
  assert.equal(classifyThread('https://[::1]/@x/1'), null);
  assert.deepEqual(classifyThread('https://bsky.app/profile/alice.bsky.social/post/3kz2abc'), { kind: 'bluesky', source: 'Bluesky', handle: 'alice.bsky.social', rkey: '3kz2abc' });
  assert.deepEqual(classifyThread('https://www.reddit.com/r/Playwright/comments/1abc2d/trace_viewer/'), { kind: 'reddit', source: 'r/Playwright', path: '/r/Playwright/comments/1abc2d/trace_viewer/', sub: 'Playwright' });
  assert.deepEqual(classifyThread('https://reddit.com/r/QA/comments/jkl'), { kind: 'reddit', source: 'r/QA', path: '/r/QA/comments/jkl', sub: 'QA' });
  assert.equal(classifyThread('https://www.reddit.com/r/QA/comments/../x'), null);
  assert.equal(classifyThread('https://app.daily.dev/posts/abc'), null);
  assert.equal(classifyThread('https://example.com/blog/post'), null);
  assert.equal(classifyThread('not a url'), null);
  assert.equal(classifyThread('http://news.ycombinator.com/item?id=1'), null, 'https only');
  assert.equal(SOURCE_NAME.hn, 'Hacker News');
});

test('htmlToPlain decodes entities, drops tags, collapses whitespace (review focus 3)', () => {
  assert.equal(htmlToPlain('<p>It&#x27;s &quot;fine&quot;<p>second   line<br>end &amp; done</p>'), 'It\'s "fine" second line end & done');
  assert.equal(htmlToPlain('<a href="x">link</a> <script>bad()</script>'), 'link bad()');
  assert.equal(htmlToPlain(null), '');
});

test('normaliseComments drops short, deleted and link-only comments, cuts long ones, interleaves threads, and applies the min/max', () => {
  const hn = { source: 'Hacker News', comments: [
    { author: '@a1', score: null, text: long('hn one') }, { author: '@a2', score: null, text: 'short' },
    { author: '@a3', score: null, text: '[deleted]' }, { author: '@a4', score: null, text: 'https://example.com/only-a-link-here-and-nothing-else' },
    { author: '@a5', score: null, text: `${'x'.repeat(700)} tail` },
  ] };
  const lob = { source: 'Lobsters', comments: [{ author: '@b1', score: 9, text: long('lob one') }, { author: '@b2', score: 3, text: long('lob two') }] };
  const out = normaliseComments([hn, lob], cfg);
  assert.deepEqual(out.map((c) => c.author), ['@a1', '@b1', '@a5', '@b2'], 'round-robin across threads, each in its own order');
  assert.equal(out[2].text.length, 600);
  assert.equal(out[1].source, 'Lobsters');
  assert.deepEqual(normaliseComments([lob], cfg), [], 'two usable comments is under the minimum of 3');
  const many = { source: 'Hacker News', comments: Array.from({ length: 20 }, (_, i) => ({ author: `@u${i}`, score: null, text: long(`c${i}`) })) };
  assert.equal(normaliseComments([many], cfg).length, 12);
  assert.deepEqual(normaliseComments([], cfg), []);
  assert.equal(normaliseComments([{ source: 'X', comments: [{ author: null, score: 1, text: `line one\n\nline   two ${'w '.repeat(20)}` }] }, lob], cfg)[0].author, '@unknown');
  assert.ok(!normaliseComments([{ source: 'X', comments: [{ author: '@n', score: 1, text: `a\nb ${'w '.repeat(20)}` }] }, lob], cfg)[0].text.includes('\n'), 'text is one line');
});

test('discussionBlock and commentsText', () => {
  const cs = [{ author: '@a', source: 'Hacker News', score: null, text: 'Hard caps are table stakes.' }, { author: '@b', source: 'Lobsters', score: 14, text: 'Disagree, soft caps suffice.' }];
  assert.deepEqual(discussionBlock(cs), ['[Hacker News] @a: Hard caps are table stakes.', '[Lobsters] @b (14 pts): Disagree, soft caps suffice.']);
  assert.equal(commentsText(cs), 'Hard caps are table stakes.\nDisagree, soft caps suffice.');
  assert.equal(commentsText([]), '');
});

// ---- adapters and fetchComments

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const routes = (map, calls = []) => async (url, opts = {}) => { calls.push({ url, opts }); if (!(url in map)) throw new Error(`HTTP 404 for ${url}`); return map[url]; };

test('threadsOf dedups discussionUrl and extraLinks and keeps only recognised hosts (review focus 4)', () => {
  const item = { discussionUrl: 'https://news.ycombinator.com/item?id=100', extraLinks: ['https://news.ycombinator.com/item?id=100', 'https://lobste.rs/s/xkwswd/t', 'https://app.daily.dev/posts/x', 'javascript:alert(1)'] };
  assert.deepEqual(threadsOf(item).map((t) => [t.kind, t.url]), [['hn', 'https://news.ycombinator.com/item?id=100'], ['lobsters', 'https://lobste.rs/s/xkwswd/t']]);
  assert.deepEqual(threadsOf({}), []);
});

test('hn adapter: top-level children in HN order, HTML decoded, null text dropped', async () => {
  const getJson = routes({ 'https://hn.algolia.com/api/v1/items/100': fixture('hn-item.json') });
  const out = await commentAdapters.hn(classifyThread('https://news.ycombinator.com/item?id=100'), { getJson });
  assert.deepEqual(out.map((c) => c.author), ['tptacek', 'skeptic', 'c']);
  assert.equal(out[0].text, "Hard caps are table stakes for any pay-by-usage API. I've been burned twice.");
  assert.equal(out[1].text, 'Soft caps with a warning email are enough for most people, "hard" caps break prod at 3am.');
  assert.equal(out[0].score, null);
});

test('lobsters adapter: top-level by score, username string or object', async () => {
  const getJson = routes({ 'https://lobste.rs/s/xkwswd.json': fixture('lobsters-story.json') });
  const out = await commentAdapters.lobsters(classifyThread('https://lobste.rs/s/xkwswd/t'), { getJson });
  assert.deepEqual(out.map((c) => [c.author, c.score]), [['old_style', 21], ['pushcx', 14]]);
});

test('mastodon adapter: direct replies only, by favourites+boosts, through a public-only lookup', async () => {
  const calls = [];
  const getJson = routes({ 'https://mas.to/api/v1/statuses/117384254326007619/context': fixture('mastodon-context.json') }, calls);
  const out = await commentAdapters.mastodon(classifyThread('https://mas.to/@vnzn/117384254326007619'), { getJson, lookup: (h, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]) });
  assert.deepEqual(out.map((c) => [c.author, c.score]), [['vnzn@mas.to', 7], ['ops', 1]]);
  assert.equal(out[1].text, 'This is a billing UX problem, not an API problem, and providers know it.');
  assert.equal(typeof calls[0].opts.lookup, 'function', 'a lookup is passed for Mastodon hosts');
  await new Promise((resolve) => calls[0].opts.lookup('mas.to', {}, (err) => { assert.match(err.message, /non-public address/); resolve(); }));
});

test('bluesky adapter: resolves the handle, reads depth-1 replies by likes+reposts, skips resolve for a DID', async () => {
  const calls = [];
  const getJson = routes({
    'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=alice.bsky.social': { did: 'did:plc:abc' },
    'https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=at%3A%2F%2Fdid%3Aplc%3Aabc%2Fapp.bsky.feed.post%2F3kz2abc&depth=1': fixture('bluesky-thread.json'),
  }, calls);
  const out = await commentAdapters.bluesky(classifyThread('https://bsky.app/profile/alice.bsky.social/post/3kz2abc'), { getJson });
  assert.deepEqual(out.map((c) => [c.author, c.score]), [['bob.dev', 34], ['alice.bsky.social', 13]]);
  calls.length = 0;
  await commentAdapters.bluesky(classifyThread('https://bsky.app/profile/did:plc:abc/post/3kz2abc'), { getJson });
  assert.equal(calls.length, 1, 'no resolveHandle for a DID');
});

test('reddit adapter: through the client, t1 depth 0 only, by score; no client = empty', async () => {
  let asked;
  const redditClient = { comments: async (path) => { asked = path; return fixture('reddit-comments.json'); } };
  const out = await commentAdapters.reddit(classifyThread('https://www.reddit.com/r/Playwright/comments/1abc2d/trace_viewer/'), { redditClient });
  assert.equal(asked, '/r/Playwright/comments/1abc2d/trace_viewer/');
  assert.deepEqual(out.map((c) => [c.author, c.score]), [['qa_lead', 88], ['contrarian', 41], ['[deleted]', 3]]);
  assert.deepEqual(await commentAdapters.reddit(classifyThread('https://www.reddit.com/r/QA/comments/x'), {}), []);
});

test('fetchComments: one failing thread leaves the others; result shape; nothing usable = empty comments (review focus 2)', async () => {
  const logs = [];
  const getJson = routes({ 'https://hn.algolia.com/api/v1/items/100': fixture('hn-item.json'), 'https://lobste.rs/s/xkwswd.json': fixture('lobsters-story.json') });
  const item = { id: 'i1', discussionUrl: 'https://news.ycombinator.com/item?id=100', extraLinks: ['https://lobste.rs/s/xkwswd/t', 'https://mas.to/@x/1'] };
  const res = await fetchComments(item, { getJson, cfg, log: (m) => logs.push(m) });
  assert.deepEqual(res.threads, ['https://news.ycombinator.com/item?id=100', 'https://lobste.rs/s/xkwswd/t', 'https://mas.to/@x/1']);
  assert.deepEqual(res.comments.map((c) => [c.source, c.author]), [['Hacker News', '@tptacek'], ['Lobsters', '@old_style'], ['Hacker News', '@skeptic'], ['Lobsters', '@pushcx']]);
  assert.ok(typeof res.fetchedAt === 'string' && logs.some((l) => l.includes('mas.to')));
  const none = await fetchComments({ id: 'i2', discussionUrl: 'https://lobste.rs/s/xkwswd/t' }, { getJson, cfg, log: () => {} });
  assert.deepEqual(none.comments, [], 'two comments is under the minimum');
  assert.deepEqual((await fetchComments({ id: 'i3' }, { getJson, cfg, log: () => {} })).comments, []);
});
