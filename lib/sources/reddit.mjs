import { makeCandidate } from '../candidate.mjs';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)(\?|$)/i;

export async function reddit(source, { fetchJson }) {
  const data = await fetchJson(source.url);
  const posts = (data?.data?.children ?? []).map((c) => c.data).filter((p) => p && p.title && !p.stickied);
  return posts.map((p) => {
    const permalink = `https://www.reddit.com${p.permalink}`;
    const external = p.is_self ? null : (p.url_overridden_by_dest || p.url);
    const isImage = Boolean(external) && (p.post_hint === 'image' || IMAGE_EXT.test(external));
    return makeCandidate({
      url: external || permalink,
      discussionUrl: permalink,
      title: p.title,
      excerpt: p.selftext ? p.selftext : null,
      imageUrl: source.isMeme && isImage ? external : null,
      source: `reddit:r/${p.subreddit}`,
      sourceName: source.name,
      publishedAt: new Date(p.created_utc * 1000).toISOString(),
      engagement: p.score ?? p.ups ?? 0,
      categoryHint: source.categoryHint,
      isMeme: Boolean(source.isMeme),
    });
  });
}
