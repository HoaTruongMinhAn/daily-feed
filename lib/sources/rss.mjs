import { makeCandidate } from '../candidate.mjs';
import { parseFeed } from '../rss.mjs';

export async function rss(source, { fetchText, now }) {
  const xml = await fetchText(source.url);
  return parseFeed(xml).map((e) => makeCandidate({
    url: e.link,
    title: e.title,
    excerpt: e.description,
    imageUrl: source.isMeme ? e.imageUrl : null,
    source: `rss:${source.id}`,
    sourceName: source.name,
    publishedAt: e.publishedAt ?? new Date(now).toISOString(),
    engagement: 1,
    categoryHint: source.categoryHint,
    isMeme: Boolean(source.isMeme),
  }));
}
