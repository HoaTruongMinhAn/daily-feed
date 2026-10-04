import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchText, fetchJson } from '../lib/http.mjs';

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
