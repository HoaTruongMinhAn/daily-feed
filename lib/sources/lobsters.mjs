import { makeCandidate } from '../candidate.mjs';

export async function lobsters(source, { fetchJson }) {
  const data = await fetchJson(`https://lobste.rs/t/${encodeURIComponent(source.tag)}.json`);
  return (Array.isArray(data) ? data : []).filter((s) => s?.title && (s.url || s.comments_url)).map((s) => makeCandidate({
    url: s.url || s.comments_url,
    discussionUrl: s.comments_url ?? null,
    title: s.title,
    excerpt: s.description_plain || null,
    source: 'lobsters',
    sourceName: source.name,
    publishedAt: s.created_at,
    engagement: (s.score ?? 0) + 2 * (s.comment_count ?? 0),
    categoryHint: source.categoryHint,
  }));
}
