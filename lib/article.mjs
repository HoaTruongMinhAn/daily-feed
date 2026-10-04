import dns from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { fetchJson, requestRaw } from './http.mjs';

// Readable text for an item's link, used as source material for the
// Vietnamese detail. Deterministic: no judgement, just fetch and strip.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return ''; }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const DROP_ELEMENTS = ['script', 'style', 'noscript', 'svg', 'nav', 'header', 'footer', 'aside', 'form', 'iframe', 'template', 'button'];
const BLOCK = /<\/?(p|div|section|article|main|h[1-6]|ul|ol|table|tr|pre|blockquote|figure|figcaption|dl|dt|dd|hr)\b[^>]*>/gi;

function inner(html, tag) {
  const m = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)</${tag}>`, 'i'));
  return m ? m[1] : null;
}

// Pages without <article>/<main> (many WordPress themes): keep only the
// blocks that look like prose, which drops menus, signup forms and footers.
function proseBlocks(h) {
  const blocks = h.match(/<(p|h[23]|li|pre)\b[^>]*>[\s\S]*?<\/\1>/gi) ?? [];
  return blocks.filter((b) => {
    const len = b.replace(/<[^>]+>/g, '').trim().length;
    return /^<(h|pre)/i.test(b) ? len > 0 : /^<li/i.test(b) ? len >= 40 : len >= 60;
  }).join('\n');
}

export function htmlToText(html, maxChars = 5000) {
  let h = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of DROP_ELEMENTS) h = h.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'gi'), ' ');
  const article = inner(h, 'article');
  const main = inner(h, 'main');
  const body = inner(h, 'body') ?? h;
  const plain = (s) => s.replace(/<[^>]+>/g, '').trim().length;
  const prose = proseBlocks(body);
  h = article && plain(article) > 500 ? article : main && plain(main) > 500 ? main : plain(prose) > 300 ? prose : body;
  const text = decodeEntities(h
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(BLOCK, '\n\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t\f\v\r ]+/g, ' ')
    .split('\n').map((l) => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.slice(0, maxChars);
}

// Item links come from strangers' posts and the fetch runs on the owner's
// machine, so a link (or a redirect) must never reach loopback, the LAN,
// link-local/metadata or other non-public addresses: what is fetched here
// ends up summarised on the public site.
const NON_PUBLIC = new BlockList();
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) NON_PUBLIC.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 96], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) NON_PUBLIC.addSubnet(net, prefix, 'ipv6');

export function isPublicAddress(ip) {
  const family = isIP(ip);
  return family !== 0 && !NON_PUBLIC.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

// dns.lookup that refuses to hand the socket a non-public address. Checked
// at connect time, so DNS rebinding between a check and the fetch is moot.
export function publicOnlyLookup(lookup = dns.lookup) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const bad = addresses.find((a) => !isPublicAddress(a.address));
      if (bad || !addresses.length) return callback(new Error(`non-public address for ${hostname}`));
      return options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

const PAGE_MAX_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 5;

// http(s) URL whose host is not a non-public IP literal (the socket skips
// the lookup for literals, so they are checked here), else null.
function publicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  return isIP(host) && !isPublicAddress(host) ? null : u;
}

async function fetchPage(url, { getPage = requestRaw, timeoutMs = 15000 } = {}) {
  let current = url;
  for (let hop = 0; ; hop++) {
    const u = publicUrl(current);
    if (!u) throw new Error(`refusing non-public url ${current}`);
    const res = await getPage(u.href, {
      headers: { accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
      timeoutMs,
      maxBytes: PAGE_MAX_BYTES,
      lookup: publicOnlyLookup(),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      if (hop >= MAX_REDIRECTS) throw new Error(`too many redirects for ${url}`);
      current = new URL(res.headers.location, u).href;
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    const type = res.headers['content-type'] ?? '';
    if (!/html|text\/plain|markdown|xml/i.test(type)) throw new Error(`unsupported content-type ${type || 'none'}`);
    return /html|xml/i.test(type) ? res.text : res.text.replace(/</g, '&lt;');
  }
}

// GitHub repos: the README says far more than the repo page HTML.
// HN self posts: the item API has the post text.
export async function fetchArticleText(url, { maxChars = 5000, fetchImpl = fetch, getPage = requestRaw } = {}) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const repo = u.hostname === 'github.com' && u.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
  if (repo) {
    const readme = await fetchJson(`https://api.github.com/repos/${repo[1]}/${repo[2]}/readme`, { fetchImpl, retries: 0 });
    const md = Buffer.from(readme?.content ?? '', 'base64').toString('utf8');
    return md.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars) || null;
  }
  const hnId = u.hostname === 'news.ycombinator.com' && u.searchParams.get('id');
  if (hnId) {
    const item = await fetchJson(`https://hn.algolia.com/api/v1/items/${encodeURIComponent(hnId)}`, { fetchImpl, retries: 0 });
    return htmlToText(`<body>${item?.text ?? ''}</body>`, maxChars) || null;
  }
  return htmlToText(await fetchPage(url, { getPage }), maxChars) || null;
}
