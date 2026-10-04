import { canonicalUrl, idFor } from './dedup.mjs';

export function makeCandidate({
  url, discussionUrl = null, title, excerpt = null, imageUrl = null,
  source, sourceName, publishedAt, engagement = 0, categoryHint, isMeme = false,
}) {
  const canonical = canonicalUrl(url);
  return {
    id: idFor(canonical),
    url: canonical,
    discussionUrl: discussionUrl ?? null,
    title: String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
    excerpt: excerpt ? String(excerpt).replace(/\s+/g, ' ').trim().slice(0, 400) : null,
    imageUrl: imageUrl ?? null,
    source,
    sourceName,
    sources: [sourceName],
    publishedAt,
    engagement: Number.isFinite(engagement) ? engagement : 0,
    hotness: 0,
    categoryHint,
    isMeme: Boolean(isMeme),
    extraLinks: [],
  };
}

// Distinct source names that carried this story; records written before
// `sources` existed count as their single sourceName.
export function sourcesOf(x) {
  return Array.isArray(x?.sources) && x.sources.length ? x.sources : [x?.sourceName];
}
