import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import http from 'node:http';
import { fetchText, fetchJson, requestText, publicLookup } from '../lib/http.mjs';

function serve(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('fetchText retries once after a 500 and returns the body', async () => {
  let calls = 0;
  const { server, url } = await serve((req, res) => {
    calls++;
    if (calls === 1) { res.statusCode = 500; res.end('boom'); return; }
    res.setHeader('x-ua', req.headers['user-agent']);
    res.end('hello');
  });
  try {
    assert.equal(await fetchText(url), 'hello');
    assert.equal(calls, 2);
  } finally { server.close(); }
});

test('fetchText throws after retries are exhausted', async () => {
  const { server, url } = await serve((req, res) => { res.statusCode = 503; res.end(); });
  try {
    await assert.rejects(fetchText(url, { retries: 1 }), /HTTP 503/);
  } finally { server.close(); }
});

test('fetchText aborts on timeout', async () => {
  const { server, url } = await serve(() => { /* never respond */ });
  try {
    await assert.rejects(fetchText(url, { timeoutMs: 100, retries: 0 }));
  } finally { server.closeAllConnections?.(); server.close(); }
});

test('fetchJson parses JSON and sends the daily-feed user agent', async () => {
  let ua;
  const { server, url } = await serve((req, res) => { ua = req.headers['user-agent']; res.end('{"ok":true}'); });
  try {
    assert.deepEqual(await fetchJson(url), { ok: true });
    assert.match(ua, /^daily-feed\/1\.0/);
  } finally { server.close(); }
});

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

test('requestText sends method, headers and body, and returns the text', async () => {
  await withServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => res.end(JSON.stringify({ method: req.method, auth: req.headers.authorization, ua: req.headers['user-agent'], body })));
  }, async (base) => {
    const text = await requestText(`${base}/x`, { method: 'POST', headers: { authorization: 'Basic abc' }, body: 'grant_type=client_credentials', request: http.request });
    const got = JSON.parse(text);
    assert.equal(got.method, 'POST');
    assert.equal(got.auth, 'Basic abc');
    assert.equal(got.body, 'grant_type=client_credentials');
    assert.match(got.ua, /^daily-feed\//);
  });
});

test('requestText rejects non-2xx with status and url only, never headers', async () => {
  await withServer((req, res) => { res.statusCode = 401; res.end('nope'); }, async (base) => {
    await assert.rejects(
      requestText(`${base}/t`, { headers: { authorization: 'Basic SECRET123' }, request: http.request }),
      (err) => err.message === `HTTP 401 for ${base}/t` && !err.message.includes('SECRET123'),
    );
  });
});

test('publicLookup resolves through the given servers, supports all:true, falls back on error', async () => {
  class OkResolver { setServers(s) { OkResolver.servers = s; } resolve4(h, cb) { cb(null, ['151.101.1.140', '151.101.65.140']); } }
  const lookup = publicLookup(['1.1.1.1'], { Resolver: OkResolver, fallback: () => assert.fail('no fallback') });
  assert.deepEqual(OkResolver.servers, ['1.1.1.1']);
  const one = await new Promise((r) => lookup('www.reddit.com', {}, (e, a, f) => r([e, a, f])));
  assert.deepEqual(one, [null, '151.101.1.140', 4]);
  const all = await new Promise((r) => lookup('www.reddit.com', { all: true }, (e, a) => r([e, a])));
  assert.deepEqual(all, [null, [{ address: '151.101.1.140', family: 4 }, { address: '151.101.65.140', family: 4 }]]);

  class BadResolver { setServers() {} resolve4(h, cb) { cb(new Error('ECONNREFUSED')); } }
  const fb = publicLookup(['1.1.1.1'], { Resolver: BadResolver, fallback: (h, o, cb) => cb(null, '127.0.0.1', 4) });
  const got = await new Promise((r) => fb('www.reddit.com', {}, (e, a) => r(a)));
  assert.equal(got, '127.0.0.1');
});
