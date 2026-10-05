import { isIP } from 'node:net';
import { decodeEntities } from './article.mjs';

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
