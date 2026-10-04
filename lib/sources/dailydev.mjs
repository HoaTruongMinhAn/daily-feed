import { makeCandidate } from '../candidate.mjs';

// The GraphQL API daily.dev's own web app uses: no login, but undocumented
// (the documented Public API needs a paid plan). `tag` feeds are too sparse
// to use (checked 2026-10-04). `feed` is spliced into the query, so only
// these names are allowed; everything else goes in as variables.
const FEEDS = new Set(['mostUpvotedFeed', 'mostDiscussedFeed']);
const NODE = 'id type title url summary createdAt numUpvotes numComments commentsPermalink sharedPost { title url summary }';

export async function dailydev(source, { fetchJson }) {
  if (!FEEDS.has(source.feed)) throw new Error(`unknown daily.dev feed ${source.feed}`);
  const query = `query($first: Int, $period: Int) { feed: ${source.feed}(first: $first, period: $period) { edges { node { ${NODE} } } } }`;
  const data = await fetchJson('https://api.daily.dev/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { first: 50, period: source.period ?? 3 } }),
  });
  if (data?.errors?.length && !data.data) throw new Error(`daily.dev: ${data.errors[0]?.message ?? 'GraphQL error'}`);
  return (data?.data?.feed?.edges ?? []).map((e) => e?.node).filter(Boolean).map((p) => {
    // A share carries no title or link of its own; the article is the shared post.
    const shared = p.type === 'share' ? p.sharedPost : null;
    const title = shared?.title || p.title;
    const url = shared?.url || p.url || p.commentsPermalink;
    if (!title || !url) return null;
    return makeCandidate({
      url,
      discussionUrl: p.commentsPermalink ?? null,
      title,
      excerpt: shared?.summary || p.summary || null,
      source: 'dailydev',
      sourceName: source.name,
      publishedAt: p.createdAt,
      engagement: (p.numUpvotes ?? 0) + 2 * (p.numComments ?? 0),
      categoryHint: source.categoryHint,
    });
  }).filter(Boolean);
}
