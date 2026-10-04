import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, idFor, jaccard, titleTokens, dedupeCandidates, filterKnown, splitSightings } from '../lib/dedup.mjs';
import { makeCandidate, sourcesOf } from '../lib/candidate.mjs';

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
  assert.deepEqual(c.sources, ['HN']);
});

test('sourcesOf falls back to [sourceName] for records without sources', () => {
  assert.deepEqual(sourcesOf({ sourceName: 'HN' }), ['HN']);
  assert.deepEqual(sourcesOf({ sourceName: 'HN', sources: [] }), ['HN']);
  assert.deepEqual(sourcesOf({ sourceName: 'HN', sources: ['HN', 'dev.to'] }), ['HN', 'dev.to']);
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

test('dedupeCandidates unions distinct source names of merged candidates', () => {
  const base = { publishedAt: '2026-10-03T00:00:00Z', categoryHint: 'ai' };
  const a = { ...makeCandidate({ ...base, url: 'https://a.com/p', title: 'Claude ships agent SDK v2', source: 'hn', sourceName: 'Hacker News' }), hotness: 0.9 };
  const b = { ...makeCandidate({ ...base, url: 'https://a.com/p', title: 'Claude ships agent SDK v2', source: 'hn', sourceName: 'Hacker News' }), hotness: 0.5 };
  const c = { ...makeCandidate({ ...base, url: 'https://b.com/p', title: 'Claude ships agent SDK v2 (blog)', source: 'rss', sourceName: 'Lobsters' }), hotness: 0.1 };
  const [out] = dedupeCandidates([a, b, c]);
  assert.deepEqual(out.sources, ['Hacker News', 'Lobsters']);
});

test('splitSightings turns known ids and title matches into sightings (review focus 1)', () => {
  const base = { publishedAt: '2026-10-03T00:00:00Z', categoryHint: 'ai', source: 'rss' };
  const item = { id: idFor('https://a.com/p'), url: 'https://a.com/p', title: 'Clean: Claude ships agent SDK v2', sourceTitle: 'Claude ships the agent SDK v2', sourceName: 'Hacker News' };
  const comic = { id: idFor('https://xkcd.com/1'), url: 'https://xkcd.com/1', title: 'Compiling', sourceName: 'xkcd' };
  const sameId = makeCandidate({ ...base, url: 'https://www.a.com/p/', title: 'whatever', sourceName: 'Lobsters', discussionUrl: 'https://lobste.rs/s/1' });
  const sameTitle = makeCandidate({ ...base, url: 'https://news.site/x', title: 'Claude ships the agent SDK v2', sourceName: 'dev.to' });
  const shortTitle = makeCandidate({ ...base, url: 'https://other.com/c', title: 'Compiling', sourceName: 'Other' });
  const fresh = makeCandidate({ ...base, url: 'https://c.com/new', title: 'Totally new story about databases', sourceName: 'dev.to' });
  const out = splitSightings([sameId, sameTitle, shortTitle, fresh], [item, comic]);
  assert.deepEqual(out.candidates.map((c) => c.url), ['https://other.com/c', 'https://c.com/new'], 'short titles never title-match');
  assert.deepEqual(out.sightings, [
    { itemId: item.id, sourceName: 'Lobsters', link: 'https://lobste.rs/s/1' },
    { itemId: item.id, sourceName: 'dev.to', link: 'https://news.site/x' },
  ]);
  assert.deepEqual(splitSightings([fresh], []).candidates, [fresh]);
});

test('dedup keeps signal/editorialHot if any merged copy had them, without adding them otherwise', () => {
  const a = { id: 'a', url: 'https://a.com/1', title: 'Big cloud outage takes down the web', hotness: 1, sourceName: 'Techmeme', sources: ['Techmeme'], editorialHot: true, signal: false, extraLinks: [] };
  const b = { id: 'b', url: 'https://b.com/2', title: 'Big cloud outage takes down the web', hotness: 0.5, sourceName: 'HN', sources: ['HN'], signal: true, extraLinks: [] };
  const [m] = dedupeCandidates([a, b]);
  assert.equal(m.signal, true);
  assert.equal(m.editorialHot, true);
  assert.deepEqual(m.sources, ['Techmeme', 'HN']);
  const { signal: _s, ...noSignal } = b;
  const [plain] = dedupeCandidates([noSignal, { ...noSignal, id: 'c', url: 'https://c.com/3' }]);
  assert.equal('signal' in plain, false, 'absorb adds nothing when neither copy had the field');
});
