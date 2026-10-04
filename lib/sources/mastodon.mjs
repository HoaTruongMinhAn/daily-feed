import { makeCandidate } from '../candidate.mjs';

// Toot HTML → plain text. Tags go first, entities are decoded last, so a
// decoded "<" is plain text that render escapes again.
export function tootText(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>|<\/p>/gi, '\n')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

const firstLine = (s) => s.split('\n').find(Boolean) ?? '';

function fromStatus(s, source) {
  if (!s || typeof s !== 'object') return null;
  const text = tootText(s.content);
  const card = s.card?.url && s.card?.title ? s.card : null;
  const url = card ? card.url : s.url;
  const title = card ? card.title : firstLine(text).slice(0, 200);
  if (!url || !title) return null;
  return makeCandidate({
    url,
    discussionUrl: card ? s.url ?? null : null,
    title,
    excerpt: (card ? card.description : '') || text || null,
    source: `mastodon:${source.instance}`,
    sourceName: source.name,
    publishedAt: s.created_at,
    engagement: (s.reblogs_count ?? 0) + (s.favourites_count ?? 0) + 2 * (s.replies_count ?? 0),
    categoryHint: source.categoryHint,
  });
}

// Trending links carry no publish date; they trend now.
function fromTrendLink(l, source, now) {
  if (!l?.url || !l?.title) return null;
  return makeCandidate({
    url: l.url,
    title: l.title,
    excerpt: l.description || null,
    source: `mastodon:${source.instance}`,
    sourceName: source.name,
    publishedAt: new Date(now).toISOString(),
    engagement: (l.history ?? []).reduce((n, h) => n + (Number(h?.accounts) || 0), 0),
    categoryHint: source.categoryHint,
  });
}

export async function mastodon(source, { fetchJson, now = Date.now() }) {
  const base = `https://${source.instance}/api/v1`;
  if (source.mode === 'trendsLinks') {
    const data = await fetchJson(`${base}/trends/links?limit=40`);
    return (Array.isArray(data) ? data : []).map((l) => fromTrendLink(l, source, now)).filter(Boolean);
  }
  const data = await fetchJson(`${base}/timelines/tag/${encodeURIComponent(source.tag)}?limit=40`);
  return (Array.isArray(data) ? data : []).map((s) => fromStatus(s, source)).filter(Boolean);
}
