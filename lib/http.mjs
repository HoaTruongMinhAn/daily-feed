import https from 'node:https';
import dns from 'node:dns';

export const USER_AGENT = 'daily-feed/1.0 (+https://github.com/HoaTruongMinhAn/daily-feed)';

export async function fetchText(url, { timeoutMs = 15000, headers = {}, retries = 1, fetchImpl = fetch } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        headers: { 'user-agent': USER_AGENT, accept: '*/*', ...headers },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, { ...opts, headers: { accept: 'application/json', ...(opts.headers ?? {}) } });
  return JSON.parse(text);
}

// Node `lookup` that asks the given public resolvers and falls back to the
// system resolver. Lets one adapter get past a DNS-level block without
// changing the machine's DNS (see config/feed.mjs redditResolvers).
export function publicLookup(servers, { Resolver = dns.Resolver, fallback = dns.lookup } = {}) {
  const resolver = new Resolver();
  resolver.setServers(servers);
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    resolver.resolve4(hostname, (err, addresses) => {
      if (err || !addresses?.length) return fallback(hostname, options, callback);
      if (options?.all) return callback(null, addresses.map((address) => ({ address, family: 4 })));
      return callback(null, addresses[0], 4);
    });
  };
}

// Plain HTTPS request for callers that need a custom lookup, method or body
// (fetch() cannot take a lookup without undici). Errors carry only the
// status and url, never headers or body, so credentials cannot leak.
export function requestText(url, { method = 'GET', headers = {}, body = null, timeoutMs = 15000, lookup, request = https.request } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method,
      headers: { 'user-agent': USER_AGENT, accept: '*/*', ...(body != null ? { 'content-length': Buffer.byteLength(body) } : {}), ...headers },
      timeout: timeoutMs,
      ...(lookup ? { lookup } : {}),
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        else resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs} ms for ${url}`)));
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}
