import { makeCandidate } from '../candidate.mjs';

// The GraphQL API daily.dev's own web app uses: no login, but undocumented
// (the documented Public API needs a paid plan; custom feeds need a login).
// `feed` is spliced into the query, so only these names are allowed;
// everything else goes in as variables. The vote-ranked feeds take no tag
// worth using (too sparse, checked 2026-10-04), so topics use `tagFeed`:
// the newest posts of each tag, which carry few votes.
const FEEDS = new Set(['mostUpvotedFeed', 'mostDiscussedFeed', 'tagFeed']);
const NODE = 'id type title url summary createdAt numUpvotes numComments commentsPermalink sharedPost { title url summary }';
const EDGES = `edges { node { ${NODE} } }`;

function request(source) {
  if (!FEEDS.has(source.feed)) throw new Error(`unknown daily.dev feed ${source.feed}`);
  if (source.feed !== 'tagFeed') {
    return {
      query: `query($first: Int, $period: Int) { feed: ${source.feed}(first: $first, period: $period) { ${EDGES} } }`,
      variables: { first: 50, period: source.period ?? 3 },
    };
  }
  const tags = Array.isArray(source.tags) ? source.tags.filter((t) => typeof t === 'string' && t) : [];
  if (!tags.length) throw new Error(`daily.dev tagFeed needs tags (${source.id})`);
  const keys = tags.map((_, i) => `t${i}`);
  return {
    query: `query($first: Int, ${keys.map((k) => `$${k}: String!`).join(', ')}) { ${keys.map((k) => `${k}: tagFeed(tag: $${k}, first: $first, ranking: TIME) { ${EDGES} }`).join(' ')} }`,
    variables: { first: 50, ...Object.fromEntries(keys.map((k, i) => [k, tags[i]])) },
  };
}

export async function dailydev(source, { fetchJson }) {
  const data = await fetchJson('https://api.daily.dev/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request(source)),
  });
  if (data?.errors?.length && !data.data) throw new Error(`daily.dev: ${data.errors[0]?.message ?? 'GraphQL error'}`);
  // One post can carry several of the requested tags.
  const nodes = new Map();
  for (const list of Object.values(data?.data ?? {})) {
    for (const e of list?.edges ?? []) if (e?.node?.id && !nodes.has(e.node.id)) nodes.set(e.node.id, e.node);
  }
  return [...nodes.values()].map((p) => {
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
      // At least 1, as for RSS: unvoted tag posts still rank by recency.
      engagement: Math.max(1, (p.numUpvotes ?? 0) + 2 * (p.numComments ?? 0)),
      categoryHint: source.categoryHint,
    });
  }).filter(Boolean);
}
