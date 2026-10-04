import { USER_AGENT, fetchJson } from './http.mjs';

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

async function fetchPage(url, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' }, signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!/html|text\/plain|markdown|xml/i.test(type)) throw new Error(`unsupported content-type ${type || 'none'}`);
    const body = await res.text();
    return /html|xml/i.test(type) ? body : body.replace(/</g, '&lt;');
  } finally {
    clearTimeout(timer);
  }
}

// GitHub repos: the README says far more than the repo page HTML.
// HN self posts: the item API has the post text.
export async function fetchArticleText(url, { maxChars = 5000, fetchImpl = fetch } = {}) {
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
  return htmlToText(await fetchPage(url, { fetchImpl }), maxChars) || null;
}
