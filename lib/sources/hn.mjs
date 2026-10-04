import { makeCandidate } from '../candidate.mjs';

// Two modes: a literal `url` (e.g. the front page), or `query` + `minPoints`
// + `sinceHours`, which builds a relevance search bounded to recent stories.
function buildUrl(source, now) {
  if (source.url) return source.url;
  const since = Math.floor(now / 1000) - (source.sinceHours ?? 72) * 3600;
  const filters = `created_at_i>${since},points>${source.minPoints ?? 20}`;
  return `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(source.query)}&tags=story&numericFilters=${filters}&hitsPerPage=50`;
}

export async function hn(source, { fetchJson, now = Date.now() }) {
  const data = await fetchJson(buildUrl(source, now));
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
