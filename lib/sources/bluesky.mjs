import { makeCandidate } from '../candidate.mjs';

// Public custom feeds only: anonymous search returns 403 (checked 2026-10-04).
const POST_URI = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/;

export function postUrl(post) {
  const m = POST_URI.exec(post?.uri ?? '');
  if (!m) return null;
  return `https://bsky.app/profile/${post.author?.handle || m[1]}/post/${m[2]}`;
}

export async function bluesky(source, { fetchJson }) {
  const data = await fetchJson(`https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=${encodeURIComponent(source.feed)}&limit=50`);
  return (data?.feed ?? []).map((f) => f?.post).filter(Boolean).map((p) => {
    const self = postUrl(p);
    const ext = p.embed?.external?.uri && p.embed?.external?.title ? p.embed.external : null;
    const text = typeof p.record?.text === 'string' ? p.record.text.trim() : '';
    const url = ext ? ext.uri : self;
    const title = ext ? ext.title : (text.split('\n').map((l) => l.trim()).find(Boolean) ?? '');
    if (!url || !title) return null;
    return makeCandidate({
      url,
      discussionUrl: ext ? self : null,
      title: title.slice(0, 200),
      excerpt: (ext ? ext.description : '') || text || null,
      source: 'bluesky',
      sourceName: source.name,
      publishedAt: p.record?.createdAt ?? p.indexedAt,
      engagement: (p.repostCount ?? 0) + (p.likeCount ?? 0) + 2 * (p.replyCount ?? 0),
      categoryHint: source.categoryHint,
    });
  }).filter(Boolean);
}
