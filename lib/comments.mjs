import { isIP } from 'node:net';
import { decodeEntities, publicOnlyLookup } from './article.mjs';
import { requestText } from './http.mjs';

// Comments for an item's discussion threads (HN, Lobsters, Mastodon,
// Bluesky, Reddit), fetched from public JSON endpoints and cut down to what
// Claude reads for the "discussion" section. Spec:
// docs/superpowers/specs/2026-10-05-discussion-design.md
export const SOURCE_NAME = { hn: 'Hacker News', lobsters: 'Lobsters', mastodon: 'Mastodon', bluesky: 'Bluesky' };
const MIN_COMMENT_CHARS = 40;
const REDDIT_PATH = /^\/r\/([A-Za-z0-9_]+)\/comments\/([a-z0-9]+)(?:\/[^/?#]*)?\/?$/;

// Which adapter reads a thread URL, plus the validated ids it needs. Only
// https. Mastodon is any other host with a status-shaped path; an IP
// literal host is refused because those endpoints are built from the URL.
export function classifyThread(raw) {
  let u;
  try { u = new URL(String(raw ?? '')); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname;
  if (isIP(host.replace(/^\[|\]$/g, ''))) return null;
  if (host === 'news.ycombinator.com') {
    const id = u.searchParams.get('id');
    return u.pathname === '/item' && /^\d+$/.test(id ?? '') ? { kind: 'hn', source: SOURCE_NAME.hn, id } : null;
  }
  if (host === 'lobste.rs') {
    const m = u.pathname.match(/^\/s\/([a-z0-9]+)(?:\/|$)/);
    return m ? { kind: 'lobsters', source: SOURCE_NAME.lobsters, short: m[1] } : null;
  }
  if (host === 'bsky.app') {
    const m = u.pathname.match(/^\/profile\/([A-Za-z0-9.:_-]+)\/post\/([a-z0-9]+)\/?$/);
    return m ? { kind: 'bluesky', source: SOURCE_NAME.bluesky, handle: m[1], rkey: m[2] } : null;
  }
  if (host === 'reddit.com' || host === 'www.reddit.com' || host === 'old.reddit.com') {
    const m = u.pathname.match(REDDIT_PATH);
    return m ? { kind: 'reddit', source: `r/${m[1]}`, path: u.pathname, sub: m[1] } : null;
  }
  const m = u.pathname.match(/^\/@[^/]+\/(\d+)\/?$/) ?? u.pathname.match(/^\/users\/[^/]+\/statuses\/(\d+)\/?$/);
  return m ? { kind: 'mastodon', source: SOURCE_NAME.mastodon, host, id: m[1] } : null;
}

export function htmlToPlain(html) {
  return decodeEntities(String(html ?? '').replace(/<br\s*\/?>|<\/?p>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const linkOnly = (s) => /^https?:\/\/\S+$/.test(s);
const deleted = (s) => /^\[(deleted|removed)\]$/i.test(s);

// `threads`: per thread, its comments in the order that thread ranks them
// (top-level only; adapters already dropped replies). Cleans each, drops
// the unusable, interleaves threads round-robin so a quiet one still shows,
// caps the total, and returns [] under the minimum.
export function normaliseComments(threads, cfg) {
  const lists = threads.map((t) => t.comments.map((c) => {
    const text = oneLine(c.text).slice(0, cfg.discussionCommentChars);
    if (text.length < MIN_COMMENT_CHARS || linkOnly(text) || deleted(text)) return null;
    const author = typeof c.author === 'string' && c.author.trim() ? (c.author.startsWith('@') ? c.author : `@${c.author}`) : '@unknown';
    return { author, source: t.source, score: Number.isFinite(c.score) ? c.score : null, text };
  }).filter(Boolean));
  const out = [];
  for (let i = 0; lists.some((l) => i < l.length) && out.length < cfg.discussionMaxComments; i++) {
    for (const l of lists) if (i < l.length && out.length < cfg.discussionMaxComments) out.push(l[i]);
  }
  return out.length >= cfg.discussionMinComments ? out : [];
}

export const discussionBlock = (comments) => comments.map((c) => `[${c.source}] ${c.author}${c.score != null ? ` (${c.score} pts)` : ''}: ${c.text}`);
export const commentsText = (comments) => comments.map((c) => c.text).join('\n');

const BSKY = 'https://public.api.bsky.app/xrpc';
const byScore = (a, b) => (b.score ?? 0) - (a.score ?? 0);

async function defaultGetJson(url, { lookup } = {}) {
  return JSON.parse(await requestText(url, { lookup, headers: { accept: 'application/json' } }));
}

// Each adapter: top-level comments of one thread, in the thread's own order,
// as { author, score, text }. Replies are dropped here, cleaning is
// normaliseComments' job.
export const commentAdapters = {
  async hn(t, { getJson }) {
    const data = await getJson(`https://hn.algolia.com/api/v1/items/${t.id}`);
    return (data?.children ?? []).filter((c) => typeof c?.text === 'string')
      .map((c) => ({ author: c.author, score: null, text: htmlToPlain(c.text) }));
  },
  async lobsters(t, { getJson }) {
    const data = await getJson(`https://lobste.rs/s/${t.short}.json`);
    return (data?.comments ?? []).filter((c) => c && c.parent_comment == null && (c.depth ?? 0) === 0)
      .map((c) => ({ author: typeof c.commenting_user === 'string' ? c.commenting_user : c.commenting_user?.username, score: c.score, text: c.comment_plain || htmlToPlain(c.comment) }))
      .sort(byScore);
  },
  async mastodon(t, { getJson, lookup }) {
    const data = await getJson(`https://${t.host}/api/v1/statuses/${t.id}/context`, { lookup: publicOnlyLookup(lookup) });
    return (data?.descendants ?? []).filter((s) => s && String(s.in_reply_to_id) === t.id)
      .map((s) => ({ author: s.account?.acct, score: (s.favourites_count ?? 0) + (s.reblogs_count ?? 0), text: htmlToPlain(s.content) }))
      .sort(byScore);
  },
  async bluesky(t, { getJson }) {
    const did = t.handle.startsWith('did:') ? t.handle : (await getJson(`${BSKY}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(t.handle)}`))?.did;
    if (typeof did !== 'string' || !did.startsWith('did:')) return [];
    const uri = `at://${did}/app.bsky.feed.post/${t.rkey}`;
    const data = await getJson(`${BSKY}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=1`);
    return (data?.thread?.replies ?? []).map((r) => r?.post).filter((p) => typeof p?.record?.text === 'string')
      .map((p) => ({ author: p.author?.handle, score: (p.likeCount ?? 0) + (p.repostCount ?? 0), text: p.record.text }))
      .sort(byScore);
  },
  async reddit(t, { redditClient }) {
    if (!redditClient) return [];
    const data = await redditClient.comments(t.path);
    return (data?.[1]?.data?.children ?? []).filter((c) => c?.kind === 't1' && (c.data?.depth ?? 0) === 0 && typeof c.data?.body === 'string')
      .map((c) => ({ author: c.data.author, score: c.data.score, text: c.data.body }))
      .sort(byScore);
  },
};

// The item's recognised threads, discussionUrl first, each URL once.
export function threadsOf(item) {
  const seen = new Set();
  const out = [];
  for (const url of [item?.discussionUrl, ...(item?.extraLinks ?? [])]) {
    const t = classifyThread(url);
    if (!t || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, ...t });
  }
  return out;
}

// Fetches every recognised thread (a failing one is logged and skipped) and
// returns what is written to data/comments/<id>.json.
export async function fetchComments(item, { getJson = defaultGetJson, redditClient = null, lookup, cfg, log = () => {} }) {
  const threads = threadsOf(item);
  const results = await Promise.all(threads.map(async (t) => {
    try {
      return { source: t.source, comments: await commentAdapters[t.kind](t, { getJson, redditClient, lookup }) };
    } catch (err) {
      log(`[comments] ${t.url}: ${err?.message ?? err}`);
      return null;
    }
  }));
  return { fetchedAt: new Date().toISOString(), threads: threads.map((t) => t.url), comments: normaliseComments(results.filter(Boolean), cfg) };
}
