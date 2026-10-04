import { makeCandidate } from '../candidate.mjs';

export async function devto(source, { fetchJson }) {
  const data = await fetchJson(source.url);
  return (Array.isArray(data) ? data : []).filter((a) => a.title && a.url).map((a) => makeCandidate({
    url: a.url,
    title: a.title,
    excerpt: a.description,
    source: 'devto',
    sourceName: source.name,
    publishedAt: a.published_at,
    engagement: a.positive_reactions_count ?? 0,
    categoryHint: source.categoryHint,
  }));
}
