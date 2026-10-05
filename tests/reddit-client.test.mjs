import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redditCredentials } from '../lib/secrets.mjs';
import { makeRedditClient } from '../lib/reddit-client.mjs';

const dir = mkdtempSync(join(tmpdir(), 'df-secrets-'));
const file = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };
const creds = { clientId: 'cid', clientSecret: 'SUPERSECRET', userAgent: 'daily-feed/1.0 by tester' };
const listing = { data: { children: [] } };

test('redditCredentials: missing, malformed or partial file means null; good file is trimmed', () => {
  assert.equal(redditCredentials(join(dir, 'nope.json')), null);
  assert.equal(redditCredentials(file('bad.json', '{not json')), null);
  assert.equal(redditCredentials(file('null.json', 'null')), null);
  assert.equal(redditCredentials(file('empty.json', '{"reddit":{}}')), null);
  assert.equal(redditCredentials(file('blank.json', '{"reddit":{"clientId":" ","clientSecret":"x"}}')), null);
  const ok = redditCredentials(file('ok.json', '{"reddit":{"clientId":" cid ","clientSecret":"s"}}'));
  assert.equal(ok.clientId, 'cid');
  assert.equal(ok.clientSecret, 's');
  assert.match(ok.userAgent, /^daily-feed\//);
});

test('anonymous client reads the public .json listing through the lookup', async () => {
  const calls = [];
  const lookup = () => {};
  const client = makeRedditClient({ lookup, requestText: async (url, o) => { calls.push({ url, o }); return JSON.stringify(listing); } });
  assert.equal(client.mode, 'anonymous');
  assert.deepEqual(await client.top('QualityAssurance', 'week'), listing);
  assert.equal(calls[0].url, 'https://www.reddit.com/r/QualityAssurance/top.json?t=week&limit=40&raw_json=1');
  assert.equal(calls[0].o.lookup, lookup);
});

test('oauth client gets one token per run and sends it as Bearer', async () => {
  const calls = [];
  const requestText = async (url, o) => {
    calls.push({ url, o });
    if (url.endsWith('/api/v1/access_token')) return JSON.stringify({ access_token: 'TOKEN1', token_type: 'bearer' });
    return JSON.stringify(listing);
  };
  const client = makeRedditClient({ creds, requestText });
  assert.equal(client.mode, 'oauth');
  await client.top('artificial');
  await client.top('LocalLLaMA', 'day');
  const tokenCalls = calls.filter((c) => c.url.endsWith('/access_token'));
  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].o.method, 'POST');
  assert.equal(tokenCalls[0].o.body, 'grant_type=client_credentials');
  assert.equal(tokenCalls[0].o.headers.authorization, `Basic ${Buffer.from('cid:SUPERSECRET').toString('base64')}`);
  const reads = calls.filter((c) => c.url.startsWith('https://oauth.reddit.com/'));
  assert.equal(reads[0].url, 'https://oauth.reddit.com/r/artificial/top?t=day&limit=40&raw_json=1');
  assert.equal(reads[1].o.headers.authorization, 'Bearer TOKEN1');
  assert.equal(reads[1].o.headers['user-agent'], 'daily-feed/1.0 by tester');
});

test('token failure fails every call with a message free of the secret (review focus 2)', async () => {
  let tokenCalls = 0;
  const b64 = Buffer.from('cid:SUPERSECRET').toString('base64');
  for (const reply of [async () => '<html>login</html>', async () => '{"error":"invalid_grant"}', async () => { throw new Error('HTTP 401 for https://www.reddit.com/api/v1/access_token'); }]) {
    const client = makeRedditClient({ creds, requestText: async (url) => { if (url.endsWith('/access_token')) { tokenCalls++; return reply(); } return '{}'; } });
    for (const sub of ['a', 'b']) {
      await assert.rejects(client.top(sub), (err) => {
        assert.match(err.message, /^reddit token request failed: /);
        assert.ok(!err.message.includes('SUPERSECRET') && !err.message.includes(b64), err.message);
        return true;
      });
    }
  }
  assert.equal(tokenCalls, 3, 'one token attempt per client, shared by every source');
});

test('comments() reads the permalink listing, anonymous and oauth', async () => {
  const calls = [];
  const requestText = async (url, opts) => { calls.push({ url, opts }); return url.includes('access_token') ? JSON.stringify({ access_token: 'tok' }) : '[]'; };
  const anon = makeRedditClient({ requestText });
  assert.deepEqual(await anon.comments('/r/QA/comments/x/t/'), []);
  assert.equal(calls[0].url, 'https://www.reddit.com/r/QA/comments/x/t.json?limit=50&depth=1&sort=top&raw_json=1');
  calls.length = 0;
  const auth = makeRedditClient({ creds: { clientId: 'id', clientSecret: 'sec' }, requestText });
  await auth.comments('/r/QA/comments/x');
  assert.equal(calls[1].url, 'https://oauth.reddit.com/r/QA/comments/x?limit=50&depth=1&sort=top&raw_json=1');
  assert.equal(calls[1].opts.headers.authorization, 'Bearer tok');
});
