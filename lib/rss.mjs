// Minimal RSS 2.0 / Atom parser. Regex based on purpose: zero deps, and
// the feeds we read are small and well formed. Anything malformed just
// yields fewer items.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ent) => {
    if (ent[0] === '#') {
      const code = ent[1].toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED[ent.toLowerCase()] ?? match;
  });
}

const stripCdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

function tagText(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = block.match(re);
  return m ? decodeEntities(stripCdata(m[1]).trim()) : null;
}

function atomLink(block) {
  let fallback = null;
  for (const [, attrs] of block.matchAll(/<link\b([^>]*?)\/?>/gi)) {
    const href = attrs.match(/href="([^"]+)"/i)?.[1];
    if (!href) continue;
    const rel = attrs.match(/rel="([^"]+)"/i)?.[1];
    if (!rel || rel === 'alternate') return decodeEntities(href);
    fallback ??= decodeEntities(href);
  }
  return fallback;
}

export function stripHtml(html) {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function firstImage(html) {
  return String(html ?? '').match(/<img\b[^>]*?\ssrc="([^"]+)"/i)?.[1] ?? null;
}

function toIso(dateText) {
  if (!dateText) return null;
  const t = new Date(dateText).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function parseFeed(xml) {
  const text = String(xml);
  const isAtom = /<feed[\s>]/i.test(text) && !/<rss[\s>]/i.test(text);
  const blockRe = isAtom ? /<entry\b[\s\S]*?<\/entry>/gi : /<item\b[\s\S]*?<\/item>/gi;
  const items = [];
  for (const [block] of text.matchAll(blockRe)) {
    const title = tagText(block, 'title');
    const link = isAtom ? atomLink(block) : tagText(block, 'link');
    if (!title || !link) continue;
    const body = isAtom
      ? (tagText(block, 'content') ?? tagText(block, 'summary'))
      : (tagText(block, 'content:encoded') ?? tagText(block, 'description'));
    const date = isAtom
      ? (tagText(block, 'published') ?? tagText(block, 'updated'))
      : (tagText(block, 'pubDate') ?? tagText(block, 'dc:date'));
    items.push({
      title,
      link,
      publishedAt: toIso(date),
      description: body ? stripHtml(body).slice(0, 400) || null : null,
      imageUrl: firstImage(body),
    });
  }
  return items;
}
