import { createHash } from 'node:crypto';

const TRACKING_PARAM = /^(utm_.*|ref|ref_.*|fbclid|gclid|mc_cid|mc_eid|source)$/i;

export function canonicalUrl(raw) {
  const text = String(raw ?? '').trim();
  let u;
  try { u = new URL(text); } catch { return text; }
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
  }
  u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  let out = u.toString();
  if ([...u.searchParams.keys()].length === 0) out = out.replace(/\?$/, '');
  return out.replace(/\/$/, '');
}

export function idFor(url) {
  return createHash('sha1').update(canonicalUrl(url)).digest('hex');
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'for', 'and', 'or', 'on', 'with', 'is', 'are', 'at', 'by', 'from', 'vs', 'your', 'you', 'how', 'why', 'what', 'show', 'hn', 'ask']);

export function titleTokens(title) {
  return new Set(
    String(title).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function absorb(target, other) {
  const links = new Set(target.extraLinks ?? []);
  for (const l of [other.discussionUrl, other.url, ...(other.extraLinks ?? [])]) {
    if (l && l !== target.url && l !== target.discussionUrl) links.add(l);
  }
  target.extraLinks = [...links];
  target.discussionUrl ??= other.discussionUrl;
  target.imageUrl ??= other.imageUrl;
}

export function dedupeCandidates(candidates, threshold = 0.8) {
  const sorted = [...candidates].sort((x, y) => y.hotness - x.hotness);
  const kept = [];
  const byId = new Map();
  for (const original of sorted) {
    const c = { ...original, extraLinks: [...(original.extraLinks ?? [])] };
    const sameId = byId.get(c.id);
    if (sameId) { absorb(sameId, c); continue; }
    const tokens = titleTokens(c.title);
    const near = kept.find((k) => jaccard(k._tokens, tokens) >= threshold);
    if (near) { absorb(near, c); continue; }
    c._tokens = tokens;
    kept.push(c);
    byId.set(c.id, c);
  }
  return kept.map(({ _tokens, ...rest }) => rest);
}

export function filterKnown(candidates, knownIds) {
  return candidates.filter((c) => !knownIds.has(c.id));
}
