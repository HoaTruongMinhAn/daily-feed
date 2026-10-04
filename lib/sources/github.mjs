import { makeCandidate } from '../candidate.mjs';

export async function github(source, { fetchJson, now }) {
  const since = new Date(now - (source.createdWithinDays ?? 30) * 864e5).toISOString().slice(0, 10);
  const q = encodeURIComponent(`${source.query} created:>${since}`);
  const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=30`;
  const data = await fetchJson(url, { headers: { accept: 'application/vnd.github+json' } });
  return (data.items ?? []).map((r) => makeCandidate({
    url: r.html_url,
    title: r.description ? `${r.full_name}: ${r.description}` : r.full_name,
    excerpt: r.description,
    source: 'github',
    sourceName: source.name,
    publishedAt: r.pushed_at ?? r.created_at,
    engagement: r.stargazers_count ?? 0,
    categoryHint: source.categoryHint,
  }));
}
