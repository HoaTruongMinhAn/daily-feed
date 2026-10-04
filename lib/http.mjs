import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';

export const USER_AGENT = 'daily-feed/1.0 (+https://github.com/HoaTruongMinhAn/daily-feed)';

export async function fetchText(url, { timeoutMs = 15000, headers = {}, retries = 1, method = 'GET', body = undefined, fetchImpl = fetch } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method,
        body,
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
  // Short and single-try: when the public resolvers are unreachable, fall
  // back to the system resolver quickly instead of stalling each request.
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
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

// Plain HTTP(S) request for callers that need a custom lookup, method or
// body (fetch() cannot take a lookup without undici). Errors carry only the
// status and url, never headers or body, so credentials cannot leak.
// `timeoutMs` bounds the whole request, not just idle time, and the body
// is capped at `maxBytes`.
export async function requestText(url, opts = {}) {
  const res = await requestRaw(url, opts);
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text;
}

// Same request, resolving with { status, headers, text } for any status,
// and never following redirects (callers that do must check each hop).
export function requestRaw(url, { method = 'GET', headers = {}, body = null, timeoutMs = 15000, maxBytes = 5 * 1024 * 1024, lookup, request } = {}) {
  request ??= String(url).startsWith('http:') ? http.request : https.request;
  return new Promise((resolve, reject) => {
    let settled = false;
    let deadline;
    // Settle once, then tear the request down without an error, so no
    // second error is emitted where nobody listens.
    const finish = (err, text) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (err) { reject(err); req.destroy(); } else resolve(text);
    };
    const req = request(url, {
      method,
      headers: { 'user-agent': USER_AGENT, accept: '*/*', ...(body != null ? { 'content-length': Buffer.byteLength(body) } : {}), ...headers },
      timeout: timeoutMs,
      ...(lookup ? { lookup } : {}),
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        if (settled) return;
        size += c.length;
        if (size > maxBytes) finish(new Error(`response too large (> ${maxBytes} bytes) for ${url}`));
        else chunks.push(c);
      });
      res.on('error', (err) => finish(err));
      res.on('end', () => finish(null, { status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => finish(new Error(`timeout after ${timeoutMs} ms for ${url}`)));
    req.on('error', (err) => finish(err));
    deadline = setTimeout(() => finish(new Error(`timeout after ${timeoutMs} ms for ${url}`)), timeoutMs);
    if (body != null) req.write(body);
    req.end();
  });
}
