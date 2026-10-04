import { makeCandidate } from '../candidate.mjs';

export async function hn(source, { fetchJson }) {
  const data = await fetchJson(source.url);
  return (data.hits ?? []).filter((h) => h.title).map((h) => {
    const thread = `https://news.ycombinator.com/item?id=${h.objectID}`;
    return makeCandidate({
      url: h.url || thread,
      discussionUrl: thread,
      title: h.title,
      source: 'hn',
      sourceName: source.name,
      publishedAt: h.created_at,
      engagement: h.points ?? 0,
      categoryHint: source.categoryHint,
    });
  });
}
