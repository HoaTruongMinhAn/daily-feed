import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, idFor, jaccard, titleTokens, dedupeCandidates, filterKnown } from '../lib/dedup.mjs';
import { makeCandidate } from '../lib/candidate.mjs';

test('canonicalUrl strips tracking params, www, fragment, trailing slash', () => {
  assert.equal(canonicalUrl('HTTPS://www.Example.com/a/?utm_source=x&id=2&ref=hn#top'), 'https://example.com/a?id=2');
  assert.equal(canonicalUrl('https://example.com/'), 'https://example.com');
  assert.equal(canonicalUrl('https://example.com/post/'), 'https://example.com/post');
});

test('canonicalUrl tolerates invalid urls (review focus 1)', () => {
  assert.equal(canonicalUrl('  not a url '), 'not a url');
  assert.equal(canonicalUrl(''), '');
  assert.equal(typeof idFor('not a url'), 'string');
  assert.equal(idFor('https://www.x.com/a?utm_medium=1'), idFor('https://x.com/a'));
});

test('jaccard on title tokens ignores stop words and punctuation', () => {
  const a = titleTokens('Show HN: The best Playwright tips for 2026!');
  const b = titleTokens('the best playwright tips for 2026');
  assert.equal(jaccard(a, b), 1);
  assert.equal(jaccard(titleTokens('cats'), titleTokens('dogs')), 0);
});

test('makeCandidate fills defaults and canonicalises', () => {
  const c = makeCandidate({ url: 'https://www.a.com/x/?utm_a=1', title: '  T  ', source: 'hn', sourceName: 'HN', publishedAt: '2026-10-03T00:00:00Z', categoryHint: 'ai' });
  assert.equal(c.url, 'https://a.com/x');
  assert.equal(c.id, idFor('https://a.com/x'));
  assert.equal(c.title, 'T');
  assert.deepEqual([c.discussionUrl, c.excerpt, c.imageUrl, c.engagement, c.hotness, c.isMeme, c.extraLinks], [null, null, null, 0, 0, false, []]);
});

test('dedupeCandidates merges same id and near-duplicate titles, keeping the hotter one', () => {
  const base = { source: 'hn', sourceName: 'HN', publishedAt: '2026-10-03T00:00:00Z', categoryHint: 'ai' };
  const a = { ...makeCandidate({ ...base, url: 'https://a.com/p', title: 'Claude ships agent SDK v2', discussionUrl: 'https://news.ycombinator.com/item?id=1' }), hotness: 0.5 };
  const b = { ...makeCandidate({ ...base, url: 'https://www.a.com/p/', title: 'Claude ships agent SDK v2', discussionUrl: 'https://reddit.com/r/x/1' }), hotness: 0.9 };
  const c = { ...makeCandidate({ ...base, url: 'https://b.com/p', title: 'Claude ships agent SDK v2 (blog)', discussionUrl: 'https://news.ycombinator.com/item?id=2' }), hotness: 0.1 };
  const d = { ...makeCandidate({ ...base, url: 'https://c.com/other', title: 'Totally different story about databases' }), hotness: 0.3 };
  const out = dedupeCandidates([a, b, c, d]);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, b.id);
  assert.equal(out[0].discussionUrl, 'https://reddit.com/r/x/1');
  assert.deepEqual(out[0].extraLinks.sort(), ['https://b.com/p', 'https://news.ycombinator.com/item?id=1', 'https://news.ycombinator.com/item?id=2'].sort());
  assert.equal(out[1].id, d.id);
  assert.equal('_tokens' in out[0], false);
});

test('filterKnown drops ids present in memory', () => {
  const x = makeCandidate({ url: 'https://a.com/1', title: 'a', source: 's', sourceName: 's', publishedAt: '2026-10-03T00:00:00Z', categoryHint: 'it' });
  const y = makeCandidate({ url: 'https://a.com/2', title: 'b', source: 's', sourceName: 's', publishedAt: '2026-10-03T00:00:00Z', categoryHint: 'it' });
  assert.deepEqual(filterKnown([x, y], new Set([x.id])).map((c) => c.id), [y.id]);
});
