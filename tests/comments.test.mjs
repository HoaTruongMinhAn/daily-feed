import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyThread, htmlToPlain, normaliseComments, discussionBlock, commentsText, SOURCE_NAME } from '../lib/comments.mjs';

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
