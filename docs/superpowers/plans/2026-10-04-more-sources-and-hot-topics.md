# More Sources and Hot Topics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Reddit (OAuth, with a public DNS resolver used only for its requests), Mastodon, Bluesky, and Lobsters JSON, plus more RSS sources. Fill a 200-candidate budget through per-topic quotas. Let the curator file script-qualified hot stories under `hot-*` categories in a new "Hot trên mạng" section. Pin the model and effort for each Claude step.

**Architecture:** Every new behaviour is a pure function in `lib/`, tested offline with fixtures:
- request and lookup in `lib/http.mjs`, the Reddit client in `lib/reddit-client.mjs`, credentials in `lib/secrets.mjs`;
- new adapters in `lib/sources/`;
- `selectByQuota` in `lib/collect.mjs`;
- `markHot`, `isHotCategory`, `hotCategoriesFrom` in `lib/hot.mjs`.

Merge validates the new `hot-*` decision shape. Render, `state.js`, and `app.js` learn the `hot` group. The runner passes `--model`, `--effort`, and `--fallback-model`.

**Tech Stack:** Node 22 ESM (`.mjs`). Built-ins only (`node:https`, `node:dns`, `node:http` in tests, `node:test`). Bash runner. Claude Code CLI 2.1.237.

**Spec:** `docs/superpowers/specs/2026-10-04-more-sources-and-hot-topics-design.md`

## Global Constraints

- No runtime npm dependencies; Node 22 built-ins only.
- `npm test` never touches the network; fixtures live in `tests/fixtures/`.
- Stage files by path; never `git add -A`; never `git push`. Do not stage pipeline output in `data/` or `site/` (except the hand-written `site/assets/app.js`, `site/assets/state.js`, `site/assets/style.css`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Secrets live only in `config/secrets.local.json` (gitignored). They never appear in logs, error messages, `data/`, `site/`, or anything Claude reads.
- The Mac's DNS settings are never changed. Only Reddit requests use the public resolvers `['1.1.1.1', '8.8.8.8']`.
- Hot topics are tech-adjacent only: no politics, celebrity, sports, or general news.
- `hot-*` slug: `/^hot-[a-z0-9]+(-[a-z0-9]+){0,2}$/`, at most 24 characters. `categoryLabelVi`: trimmed, 1–24 characters, no newline; required for `hot-*` and absent otherwise.
- `hotEligible` = 2+ independent sources, OR a source with `editorialHot: true`, OR hotness in the top 25% of candidates with a measured signal (a non-`rss` family).
- `maxCandidates: 200`; `candidateQuota: { ai: 50, testing: 50, it: 35, humor: 30, hot: 35 }`; `detailMaxPerDay: 200`.
- Engagement: HN `points + 2*num_comments`; Reddit `score + 2*num_comments`; dev.to `positive_reactions_count + 2*comments_count`; Lobsters `score + 2*comment_count`; Mastodon `reblogs + favourites + 2*replies`; Bluesky `reposts + likes + 2*replies`; Mastodon trends `sum(history[].accounts)`; RSS stays `1`.
- Runner model defaults:
  - curate: `claude-sonnet-5-5` at effort `medium`;
  - detail: `claude-sonnet-5-5` at effort `low`;
  - fallback: `claude-haiku-4-5-20251001`;
  - overrides: `DAILY_FEED_CURATE_MODEL`, `DAILY_FEED_CURATE_EFFORT`, `DAILY_FEED_DETAIL_MODEL`, `DAILY_FEED_DETAIL_EFFORT`, `DAILY_FEED_FALLBACK_MODEL`.
- The category schema is defined in four places that must agree: `skills/daily-feed-curate/SKILL.md`, `lib/merge.mjs`, `lib/render.mjs` (+ `site/assets/state.js`, `site/assets/app.js`), and `scripts/stub-curate.mjs`.

**Two small deviations from the spec, made on purpose:**
1. The public resolver list is configured once, as `feedConfig.redditResolvers`, instead of per source. All Reddit sources share one client and one token.
2. `markHot` lives in the new `lib/hot.mjs` next to the other hot-topic helpers, not in `lib/score.mjs`.

Two more:
- r/sysadmin gets hint `it`, not `humor`: it is mostly serious discussion.
- YouTube channel feeds are left out. The channel id checked on 2026-10-04 returned 404, and no verified id is available.

## Review Focus

1. **A malformed or partial `config/secrets.local.json`** (bad JSON, `{"reddit":{}}`, empty strings) should make Reddit fall back to anonymous mode, not crash fetch. Pinned in Task 2.
2. **A Reddit token endpoint that answers 200 with HTML or no `access_token`** should fail every Reddit source with a message that contains neither the client secret nor its base64 form. Pinned in Task 2.
3. **A candidate whose `categoryHint` has no quota** (e.g. a typo, or `hot` with an old config) should be counted as `it`, never silently lost. Pinned in Task 6.
4. **A day where every candidate is RSS-only** must not make every candidate `hotEligible` through the percentile rule. Pinned in Task 7.
5. **A `categoryLabelVi` containing HTML** (`<img onerror>`) from Claude must render escaped in the chip and in `data-category-label`. Pinned in Task 9.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/http.mjs` (modify) | adds `requestText` (node:https with injectable `request`, `lookup`, method, body) and `publicLookup(servers)` |
| `lib/secrets.mjs` (new) | reads `config/secrets.local.json`, returns Reddit credentials or `null` |
| `lib/reddit-client.mjs` (new) | `makeRedditClient({ creds, lookup, requestText })` → `{ mode, top(sub, t, limit) }`; one token per run |
| `lib/sources/reddit.mjs` (modify) | uses `redditClient.top`; new engagement |
| `lib/sources/{hn,devto}.mjs` (modify) | new engagement |
| `lib/sources/{mastodon,bluesky,lobsters}.mjs` (new) | new adapters |
| `lib/sources/index.mjs` (modify) | registers the new adapters |
| `lib/hot.mjs` (new) | `HOT_CATEGORY`, `HOT_LABEL_MAX`, `isHotCategory`, `markHot`, `hotCategoriesFrom` |
| `lib/collect.mjs` (modify) | per-source cap override, `signal`/`editorialHot` on candidates, `markHot`, `selectByQuota` |
| `lib/dedup.mjs` (modify) | `absorb` keeps `signal`/`editorialHot` true if any merged copy had them |
| `lib/merge.mjs` (modify) | `hot-*` validation, `categoryLabel`, strips internal fields |
| `lib/render.mjs`, `site/assets/state.js`, `site/assets/app.js`, `site/assets/style.css` (modify) | `hot` group, label chip, saved snapshot |
| `scripts/fetch.mjs` (modify) | builds the Reddit client, writes `hotCategories` |
| `scripts/stub-curate.mjs` (modify) | `hot` → `hot-general` |
| `scripts/daily-feed-run.sh` (modify) | model/effort/fallback flags |
| `skills/daily-feed-curate/SKILL.md`, `skills/daily-feed-detail/SKILL.md` (modify) | schema, hot rules, "Runs on" |
| `config/sources.mjs`, `config/feed.mjs`, `.gitignore`, `README.md`, `CLAUDE.md` (modify) | sources, tunables, secrets ignore, docs |

---

### Task 1: HTTPS request with injectable lookup

**Files:**
- Modify: `lib/http.mjs`
- Test: `tests/http.test.mjs` (append)

**Interfaces:**
- Produces:
  - `requestText(url: string, opts?: { method?: string, headers?: object, body?: string|null, timeoutMs?: number, lookup?: Function, request?: Function }) => Promise<string>`. It rejects with `Error('HTTP <status> for <url>')` on a non-2xx status. It never puts headers or body into an error message.
  - `publicLookup(servers: string[], deps?: { Resolver?, fallback? }) => (hostname, options, callback) => void`. This is a Node `lookup` that supports `options.all`.

- [ ] **Step 1: Write the failing tests** (append to `tests/http.test.mjs`)

```js
import http from 'node:http';
import { requestText, publicLookup } from '../lib/http.mjs';

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
```

If `tests/http.test.mjs` already imports `test`/`assert`, do not import them again.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/http.test.mjs`
Expected: FAIL. `requestText` / `publicLookup` are not exported.

- [ ] **Step 3: Implement** (append to `lib/http.mjs`, and add the imports at the top)

```js
import https from 'node:https';
import dns from 'node:dns';

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
      headers: { 'user-agent': USER_AGENT, accept: '*/*', ...headers },
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
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/http.test.mjs && npm test`
Expected: PASS, everything green.

- [ ] **Step 5: Commit**

```bash
git add lib/http.mjs tests/http.test.mjs
git commit -m "Add requestText and publicLookup for per-request DNS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Local secrets and the Reddit client

**Files:**
- Create: `lib/secrets.mjs`, `lib/reddit-client.mjs`
- Modify: `.gitignore`
- Test: `tests/reddit-client.test.mjs` (new)

**Interfaces:**
- Consumes: `requestText`, `USER_AGENT` from `lib/http.mjs` (Task 1); `ROOT`, `readJson` from `lib/store.mjs`.
- Produces:
  - `redditCredentials(path?: string) => { clientId, clientSecret, userAgent } | null`
  - `SECRETS_PATH: string`
  - `makeRedditClient({ creds?, lookup?, requestText? }) => { mode: 'oauth'|'anonymous', top(sub: string, t?: string, limit?: number) => Promise<object> }`. The return value is Reddit's listing JSON (`{ data: { children } }`).

- [ ] **Step 1: Write the failing tests** (`tests/reddit-client.test.mjs`)

```js
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/reddit-client.test.mjs`
Expected: FAIL with "Cannot find module '../lib/secrets.mjs'".

- [ ] **Step 3: Implement**

`lib/secrets.mjs`:

```js
import { join } from 'node:path';
import { ROOT, readJson } from './store.mjs';
import { USER_AGENT } from './http.mjs';

// Local-only credentials, gitignored. Never logged, never written to data/
// or site/, never readable by the Claude steps (they may read only their
// own input files).
export const SECRETS_PATH = join(ROOT, 'config', 'secrets.local.json');

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function redditCredentials(path = SECRETS_PATH) {
  const r = readJson(path, null)?.reddit;
  const clientId = text(r?.clientId);
  const clientSecret = text(r?.clientSecret);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, userAgent: text(r.userAgent) ?? USER_AGENT };
}
```

`lib/reddit-client.mjs`:

```js
import { USER_AGENT, requestText as defaultRequestText } from './http.mjs';

// One client per fetch run, shared by every Reddit source. With credentials
// it uses an app-only OAuth token (fetched once; a failure is cached so
// every source fails with the same message); without, the public .json
// listing. Messages never include the client secret.
export function makeRedditClient({ creds = null, lookup, requestText = defaultRequestText } = {}) {
  const ua = creds?.userAgent ?? USER_AGENT;
  let token = null;

  function getToken() {
    token ??= (async () => {
      try {
        const text = await requestText('https://www.reddit.com/api/v1/access_token', {
          method: 'POST',
          lookup,
          headers: {
            authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': ua,
          },
          body: 'grant_type=client_credentials',
        });
        let access;
        try { access = JSON.parse(text)?.access_token; } catch { access = null; }
        if (typeof access !== 'string' || !access) throw new Error('no access_token in response');
        return access;
      } catch (err) {
        throw new Error(`reddit token request failed: ${err.message}`);
      }
    })();
    return token;
  }

  return {
    mode: creds ? 'oauth' : 'anonymous',
    async top(sub, t = 'day', limit = 40) {
      const query = `t=${encodeURIComponent(t)}&limit=${limit}&raw_json=1`;
      const path = `r/${encodeURIComponent(sub)}`;
      if (!creds) {
        return JSON.parse(await requestText(`https://www.reddit.com/${path}/top.json?${query}`, { lookup, headers: { accept: 'application/json', 'user-agent': ua } }));
      }
      const access = await getToken();
      return JSON.parse(await requestText(`https://oauth.reddit.com/${path}/top?${query}`, { lookup, headers: { accept: 'application/json', authorization: `Bearer ${access}`, 'user-agent': ua } }));
    },
  };
}
```

Append to `.gitignore`:

```
# local credentials (Reddit app key); never committed
config/secrets.local.json
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/reddit-client.test.mjs && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/secrets.mjs lib/reddit-client.mjs tests/reddit-client.test.mjs .gitignore
git commit -m "Add local secrets loader and a Reddit client with app-only OAuth

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Reddit adapter on the client; Reddit sources re-enabled

**Files:**
- Modify: `lib/sources/reddit.mjs`, `scripts/fetch.mjs`, `config/sources.mjs` (Reddit block only), `config/feed.mjs`, `tests/fixtures/reddit.json`
- Test: `tests/sources.test.mjs`

**Interfaces:**
- Consumes: `makeRedditClient`, `redditCredentials` (Task 2), `publicLookup` (Task 1).
- Produces:
  - The Reddit adapter `reddit(source: { sub, t?, name, categoryHint, isMeme? }, ctx: { redditClient })`.
  - `feedConfig.redditResolvers: string[]`.
  - fetch.mjs passes `http.redditClient` to adapters.

- [ ] **Step 1: Update the fixture and tests**

In `tests/fixtures/reddit.json`, add `"num_comments": 300,` to the post whose `"score": 5400`.

In `tests/sources.test.mjs`, replace the reddit adapter test with:

```js
test('reddit adapter: reads through the client, memes get imageUrl, engagement counts comments (review focus 2)', async () => {
  const src = { id: 'r-humor', name: 'r/ProgrammerHumor', family: 'reddit', sub: 'ProgrammerHumor', t: 'week', categoryHint: 'humor', p90: 12000, isMeme: true };
  let asked;
  const redditClient = { top: async (sub, t) => { asked = [sub, t]; return fixture('reddit.json'); } };
  const out = await adapters.reddit(src, { redditClient, now });
  assert.deepEqual(asked, ['ProgrammerHumor', 'week']);
  assert.equal(out.length, 3);
  assert.equal(out[0].imageUrl, 'https://i.redd.it/meme1.png');
  assert.equal(out[0].isMeme, true);
  assert.equal(out[0].engagement, 5400 + 2 * 300);
  assert.equal(out[0].discussionUrl, 'https://www.reddit.com/r/ProgrammerHumor/comments/abc/when_the_test/');
  assert.equal(out[1].imageUrl, null);
  assert.equal(out[2].url, 'https://reddit.com/r/QualityAssurance/comments/jkl/flaky');
  assert.equal(out[2].excerpt, 'We cut flaky tests by 80% by...');
  assert.equal(out[2].source, 'reddit:r/QualityAssurance');
  assert.equal(out[0].publishedAt, new Date(1791072000 * 1000).toISOString());
  await assert.rejects(adapters.reddit(src, { now }), /reddit client not configured/);
});
```

In the `config/sources.mjs entries are well formed` test, replace the url/query line:

```js
    assert.ok(s.url || s.query || s.sub || s.tag || s.feed || s.mode, `${s.id} needs url, query, sub, tag, feed or mode`);
```

Add after that test:

```js
test('reddit sources are enabled and name a subreddit', () => {
  const r = sources.filter((s) => s.family === 'reddit');
  assert.ok(r.length >= 7);
  for (const s of r) {
    assert.match(s.sub, /^[A-Za-z0-9_]+$/, s.id);
    assert.equal(s.disabled, undefined, s.id);
    assert.ok(['day', 'week'].includes(s.t ?? 'day'), s.id);
  }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/sources.test.mjs`
Expected: FAIL. The adapter still calls `fetchJson(source.url)`, and the sources still have `disabled` set.

- [ ] **Step 3: Implement**

`lib/sources/reddit.mjs`: change the signature and the fetch/engagement lines:

```js
export async function reddit(source, { redditClient }) {
  if (!redditClient) throw new Error('reddit client not configured');
  const data = await redditClient.top(source.sub, source.t ?? 'day');
```

and

```js
      engagement: (p.score ?? p.ups ?? 0) + 2 * (p.num_comments ?? 0),
```

`config/feed.mjs`: add after `timezone`:

```js
  // Reddit requests (only those) resolve hostnames through these public
  // resolvers: the ISP DNS answers 127.0.0.1 for reddit.com. The Mac's DNS
  // is not changed. Empty array = system DNS.
  redditResolvers: ['1.1.1.1', '8.8.8.8'],
```

`config/sources.mjs`: delete the `reddit` URL helper, the `REDDIT_BLOCKED` comment and constant, and every `disabled: REDDIT_BLOCKED`. Replace the Reddit block with the block below. p90 values are about 1.5× the old ones, because comments now count.

```js
  // Reddit, via lib/reddit-client.mjs: app-only OAuth when
  // config/secrets.local.json has a key (see README), else the public .json
  // listing, which Reddit often answers with 403. `t` = top-of window.
  { id: 'r-artificial', name: 'r/artificial', family: 'reddit', sub: 'artificial', categoryHint: 'ai', p90: 1200 },
  { id: 'r-localllama', name: 'r/LocalLLaMA', family: 'reddit', sub: 'LocalLLaMA', categoryHint: 'ai', p90: 1200 },
  { id: 'r-claudeai', name: 'r/ClaudeAI', family: 'reddit', sub: 'ClaudeAI', categoryHint: 'ai', p90: 600 },
  { id: 'r-qualityassurance', name: 'r/QualityAssurance', family: 'reddit', sub: 'QualityAssurance', t: 'week', categoryHint: 'testing', p90: 60, maxAgeHours: 168 },
  { id: 'r-softwaretesting', name: 'r/softwaretesting', family: 'reddit', sub: 'softwaretesting', t: 'week', categoryHint: 'testing', p90: 60, maxAgeHours: 168 },
  { id: 'r-programming', name: 'r/programming', family: 'reddit', sub: 'programming', categoryHint: 'it', p90: 1200 },
  { id: 'r-programmerhumor', name: 'r/ProgrammerHumor', family: 'reddit', sub: 'ProgrammerHumor', categoryHint: 'humor', p90: 12000, isMeme: true },
```

`scripts/fetch.mjs`: add imports and build the client:

```js
import { fetchJson, fetchText, publicLookup } from '../lib/http.mjs';
import { redditCredentials } from '../lib/secrets.mjs';
import { makeRedditClient } from '../lib/reddit-client.mjs';
```

and inside `main()`, before `collect(...)`:

```js
  const redditClient = makeRedditClient({
    creds: redditCredentials(),
    lookup: cfg.redditResolvers?.length ? publicLookup(cfg.redditResolvers) : undefined,
  });
  console.error(`[fetch] reddit: ${redditClient.mode}`);
```

and change `http: { fetchJson, fetchText }` to `http: { fetchJson, fetchText, redditClient }`.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Live smoke check (network; not part of `npm test`)**

Run: `node scripts/fetch.mjs 2>&1 | grep -E '^\[fetch\] (reddit|r-)'`
Expected: `[fetch] reddit: anonymous`, then each `r-*` source either says `fresh of N` or `FAILED: HTTP 403 ...`. It must not say `ECONNREFUSED 127.0.0.1`, which would mean the resolver is not being used. Restore the data files afterwards: `git checkout -- data/candidates.json data/status.json` and `rm -f data/sightings.json`.

- [ ] **Step 6: Commit**

```bash
git add lib/sources/reddit.mjs scripts/fetch.mjs config/sources.mjs config/feed.mjs tests/sources.test.mjs tests/fixtures/reddit.json
git commit -m "Read Reddit through the shared client and public resolver; re-enable subreddits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Comments count toward engagement (HN, dev.to)

**Files:**
- Modify: `lib/sources/hn.mjs`, `lib/sources/devto.mjs`, `config/sources.mjs` (p90 of HN and dev.to entries), `tests/fixtures/hn.json`, `tests/fixtures/devto.json`
- Test: `tests/sources.test.mjs`

**Interfaces:**
- Produces: engagement formulas from Global Constraints. Adapter signatures are unchanged.

- [ ] **Step 1: Update fixtures and tests**

- `tests/fixtures/hn.json`: add `"num_comments": 50,` to the hit with `"points": 420`.
- `tests/fixtures/devto.json`: add `"comments_count": 6,` to the article with `"positive_reactions_count": 88`.
- In `tests/sources.test.mjs`:
  - change `assert.equal(out[0].engagement, 420);` to `assert.equal(out[0].engagement, 420 + 2 * 50);`
  - change `assert.equal(out[0].engagement, 88);` to `assert.equal(out[0].engagement, 88 + 2 * 6);`
  - add to the hn test: `assert.equal(out[1].engagement, 95, 'missing num_comments counts as 0');` (`out[1]` is hit 101, "Ask HN: How do you test LLM apps?", 95 points; hit 102 has no title and is skipped)

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/sources.test.mjs`
Expected: FAIL: `420 !== 520`, `88 !== 100`.

- [ ] **Step 3: Implement**

`lib/sources/hn.mjs`: `engagement: (h.points ?? 0) + 2 * (h.num_comments ?? 0),`
`lib/sources/devto.mjs`: `engagement: (a.positive_reactions_count ?? 0) + 2 * (a.comments_count ?? 0),`

`config/sources.mjs`: raise p90 by about 1.5×:
- `hn-front` 300→450
- `hn-llm`, `hn-agents`, `hn-claude` 200→300
- `hn-testing`, `hn-playwright` 100→150
- `devto-ai` 80→120, `devto-testing` 40→60, `devto-qa` 30→45, `devto-devops` 60→90

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sources/hn.mjs lib/sources/devto.mjs config/sources.mjs tests/sources.test.mjs tests/fixtures/hn.json tests/fixtures/devto.json
git commit -m "Count comments in HN and dev.to engagement; rescale their p90

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Mastodon, Bluesky and Lobsters adapters

**Files:**
- Create: `lib/sources/mastodon.mjs`, `lib/sources/bluesky.mjs`, `lib/sources/lobsters.mjs`, `tests/fixtures/mastodon-tag.json`, `tests/fixtures/mastodon-trends.json`, `tests/fixtures/bluesky-feed.json`, `tests/fixtures/lobsters.json`
- Modify: `lib/sources/index.mjs`
- Test: `tests/sources.test.mjs`

**Interfaces:**
- Consumes: `makeCandidate` from `lib/candidate.mjs`.
- Produces:
  - `mastodon(source: { instance, tag } | { instance, mode: 'trendsLinks' }, { fetchJson, now })`
  - `bluesky(source: { feed }, { fetchJson })`
  - `lobsters(source: { tag }, { fetchJson })`
  - All three are registered in `adapters`.
  - `tootText(html) => string` is exported from `mastodon.mjs`.

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/mastodon-tag.json`:

```json
[
  {
    "id": "1", "created_at": "2026-10-03T20:00:00.000Z", "url": "https://hachyderm.io/@ana/1",
    "content": "<p>New post on flaky tests &amp; retries</p>",
    "reblogs_count": 12, "favourites_count": 30, "replies_count": 4,
    "card": { "url": "https://blog.example.com/flaky", "title": "Taming flaky tests", "description": "Retries are not a fix." }
  },
  {
    "id": "2", "created_at": "2026-10-03T21:00:00.000Z", "url": "https://hachyderm.io/@bo/2",
    "content": "<p>Hot take: <a href=\"https://x\">#qa</a> is a role, not a phase<br>more text</p><script>alert(1)</script>",
    "reblogs_count": 1, "favourites_count": 2, "replies_count": 0, "card": null
  },
  { "id": "3", "created_at": "2026-10-03T22:00:00.000Z", "url": null, "content": "", "reblogs_count": 0, "favourites_count": 0, "replies_count": 0, "card": null }
]
```

`tests/fixtures/mastodon-trends.json`:

```json
[
  { "url": "https://www.theverge.com/x/outage", "title": "Big cloud outage takes down half the web", "description": "A config push.", "history": [ { "day": "1791072000", "uses": "40", "accounts": "35" }, { "day": "1790985600", "uses": "5", "accounts": "5" } ] },
  { "url": "", "title": "no url", "history": [] }
]
```

`tests/fixtures/bluesky-feed.json`:

```json
{
  "feed": [
    { "post": {
      "uri": "at://did:plc:abc/app.bsky.feed.post/3kx1", "author": { "handle": "ana.bsky.social" },
      "record": { "text": "Worth reading", "createdAt": "2026-10-03T20:00:00.000Z" },
      "embed": { "$type": "app.bsky.embed.external#view", "external": { "uri": "https://example.com/llm-evals", "title": "LLM evals in CI", "description": "How we gate releases." } },
      "likeCount": 40, "repostCount": 10, "replyCount": 5, "indexedAt": "2026-10-03T20:00:01.000Z" } },
    { "post": {
      "uri": "at://did:plc:def/app.bsky.feed.post/3kx2", "author": { "handle": "bo.dev" },
      "record": { "text": "\nWhen the test passes on the first try\nsuspicious", "createdAt": "2026-10-03T21:00:00.000Z" },
      "likeCount": 3, "repostCount": 0, "replyCount": 1 } },
    { "post": { "uri": "garbage", "record": { "text": "" } } }
  ]
}
```

`tests/fixtures/lobsters.json`:

```json
[
  { "short_id": "2r2sg8", "created_at": "2026-09-30T14:57:54.701-05:00", "title": "Finding Bugs", "url": "https://matklad.github.io/2026/09/19/finding-bugs.html", "score": 38, "comment_count": 14, "comments_url": "https://lobste.rs/s/2r2sg8/finding_bugs", "description_plain": "" },
  { "short_id": "ab12cd", "created_at": "2026-10-03T10:00:00.000-05:00", "title": "Ask: how do you test migrations?", "url": "", "score": 9, "comment_count": 20, "comments_url": "https://lobste.rs/s/ab12cd/ask_how_do_you_test", "description_plain": "We run them twice." }
]
```

- [ ] **Step 2: Write the failing tests** (append to `tests/sources.test.mjs`)

```js
import { tootText } from '../lib/sources/mastodon.mjs';

test('mastodon tag mode: card link wins, toot is the discussion, HTML stripped, empty posts skipped', async () => {
  let asked;
  const src = { id: 'm', name: 'Mastodon', family: 'mastodon', instance: 'hachyderm.io', tag: 'softwaretesting', categoryHint: 'testing', p90: 20 };
  const out = await adapters.mastodon(src, { fetchJson: async (u) => { asked = u; return fixture('mastodon-tag.json'); }, now });
  assert.equal(asked, 'https://hachyderm.io/api/v1/timelines/tag/softwaretesting?limit=40');
  assert.equal(out.length, 2);
  assert.equal(out[0].url, 'https://blog.example.com/flaky');
  assert.equal(out[0].discussionUrl, 'https://hachyderm.io/@ana/1');
  assert.equal(out[0].title, 'Taming flaky tests');
  assert.equal(out[0].engagement, 12 + 30 + 2 * 4);
  assert.equal(out[0].source, 'mastodon:hachyderm.io');
  assert.equal(out[1].url, 'https://hachyderm.io/@bo/2');
  assert.equal(out[1].discussionUrl, null);
  assert.equal(out[1].title, 'Hot take: #qa is a role, not a phase');
  assert.ok(!out[1].excerpt.includes('<'), out[1].excerpt);
});

test('tootText decodes entities after stripping tags, so markup cannot be re-created', () => {
  assert.equal(tootText('<p>a &amp; b</p><p>c</p>'), 'a & b\nc');
  assert.equal(tootText('<p>&lt;img src=x onerror=1&gt;</p>'), '<img src=x onerror=1>', 'decoded text is plain data; render escapes it');
});

test('mastodon trendsLinks: engagement sums accounts, publishedAt is now, url-less links skipped', async () => {
  const src = { id: 'mt', name: 'Mastodon trends', family: 'mastodon', instance: 'hachyderm.io', mode: 'trendsLinks', categoryHint: 'hot', p90: 50 };
  let asked;
  const out = await adapters.mastodon(src, { fetchJson: async (u) => { asked = u; return fixture('mastodon-trends.json'); }, now });
  assert.equal(asked, 'https://hachyderm.io/api/v1/trends/links?limit=40');
  assert.equal(out.length, 1);
  assert.equal(out[0].engagement, 40);
  assert.equal(out[0].publishedAt, new Date(now).toISOString());
  assert.equal(out[0].categoryHint, 'hot');
});

test('bluesky adapter: external embed becomes the link, text posts link to bsky.app, broken posts skipped', async () => {
  let asked;
  const feed = 'at://did:plc:x/app.bsky.feed.generator/whats-llm';
  const out = await adapters.bluesky({ id: 'b', name: 'Bluesky', family: 'bluesky', feed, categoryHint: 'ai', p90: 30 }, { fetchJson: async (u) => { asked = u; return fixture('bluesky-feed.json'); }, now });
  assert.equal(asked, `https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=${encodeURIComponent(feed)}&limit=50`);
  assert.equal(out.length, 2);
  assert.equal(out[0].url, 'https://example.com/llm-evals');
  assert.equal(out[0].discussionUrl, 'https://bsky.app/profile/ana.bsky.social/post/3kx1');
  assert.equal(out[0].engagement, 10 + 40 + 2 * 5);
  assert.equal(out[1].url, 'https://bsky.app/profile/bo.dev/post/3kx2');
  assert.equal(out[1].title, 'When the test passes on the first try');
});

test('lobsters adapter: score + 2*comments, text posts use the comments page', async () => {
  let asked;
  const out = await adapters.lobsters({ id: 'l', name: 'Lobsters', family: 'lobsters', tag: 'testing', categoryHint: 'testing', p90: 60 }, { fetchJson: async (u) => { asked = u; return fixture('lobsters.json'); }, now });
  assert.equal(asked, 'https://lobste.rs/t/testing.json');
  assert.equal(out[0].engagement, 38 + 28);
  assert.equal(out[0].discussionUrl, 'https://lobste.rs/s/2r2sg8/finding_bugs');
  assert.equal(out[1].url, 'https://lobste.rs/s/ab12cd/ask_how_do_you_test');
  assert.equal(out[1].excerpt, 'We run them twice.');
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `node --test tests/sources.test.mjs`
Expected: FAIL. The module `../lib/sources/mastodon.mjs` cannot be found.

- [ ] **Step 4: Implement**

`lib/sources/mastodon.mjs`:

```js
import { makeCandidate } from '../candidate.mjs';

// Toot HTML → plain text. Tags go first, entities are decoded last, so a
// decoded "<" is plain text that render escapes again.
export function tootText(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>|<\/p>/gi, '\n')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

const firstLine = (s) => s.split('\n').find(Boolean) ?? '';

function fromStatus(s, source) {
  if (!s || typeof s !== 'object') return null;
  const text = tootText(s.content);
  const card = s.card?.url && s.card?.title ? s.card : null;
  const url = card ? card.url : s.url;
  const title = card ? card.title : firstLine(text).slice(0, 200);
  if (!url || !title) return null;
  return makeCandidate({
    url,
    discussionUrl: card ? s.url ?? null : null,
    title,
    excerpt: (card ? card.description : '') || text || null,
    source: `mastodon:${source.instance}`,
    sourceName: source.name,
    publishedAt: s.created_at,
    engagement: (s.reblogs_count ?? 0) + (s.favourites_count ?? 0) + 2 * (s.replies_count ?? 0),
    categoryHint: source.categoryHint,
  });
}

// Trending links carry no publish date; they trend now.
function fromTrendLink(l, source, now) {
  if (!l?.url || !l?.title) return null;
  return makeCandidate({
    url: l.url,
    title: l.title,
    excerpt: l.description || null,
    source: `mastodon:${source.instance}`,
    sourceName: source.name,
    publishedAt: new Date(now).toISOString(),
    engagement: (l.history ?? []).reduce((n, h) => n + (Number(h?.accounts) || 0), 0),
    categoryHint: source.categoryHint,
  });
}

export async function mastodon(source, { fetchJson, now = Date.now() }) {
  const base = `https://${source.instance}/api/v1`;
  if (source.mode === 'trendsLinks') {
    const data = await fetchJson(`${base}/trends/links?limit=40`);
    return (Array.isArray(data) ? data : []).map((l) => fromTrendLink(l, source, now)).filter(Boolean);
  }
  const data = await fetchJson(`${base}/timelines/tag/${encodeURIComponent(source.tag)}?limit=40`);
  return (Array.isArray(data) ? data : []).map((s) => fromStatus(s, source)).filter(Boolean);
}
```

`lib/sources/bluesky.mjs`:

```js
import { makeCandidate } from '../candidate.mjs';

// Public custom feeds only: anonymous search returns 403 (checked 2026-10-04).
const POST_URI = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/;

export function postUrl(post) {
  const m = POST_URI.exec(post?.uri ?? '');
  if (!m) return null;
  return `https://bsky.app/profile/${post.author?.handle || m[1]}/post/${m[2]}`;
}

export async function bluesky(source, { fetchJson }) {
  const data = await fetchJson(`https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=${encodeURIComponent(source.feed)}&limit=50`);
  return (data?.feed ?? []).map((f) => f?.post).filter(Boolean).map((p) => {
    const self = postUrl(p);
    const ext = p.embed?.external?.uri && p.embed?.external?.title ? p.embed.external : null;
    const text = typeof p.record?.text === 'string' ? p.record.text.trim() : '';
    const url = ext ? ext.uri : self;
    const title = ext ? ext.title : (text.split('\n').map((l) => l.trim()).find(Boolean) ?? '');
    if (!url || !title) return null;
    return makeCandidate({
      url,
      discussionUrl: ext ? self : null,
      title: title.slice(0, 200),
      excerpt: (ext ? ext.description : '') || text || null,
      source: 'bluesky',
      sourceName: source.name,
      publishedAt: p.record?.createdAt ?? p.indexedAt,
      engagement: (p.repostCount ?? 0) + (p.likeCount ?? 0) + 2 * (p.replyCount ?? 0),
      categoryHint: source.categoryHint,
    });
  }).filter(Boolean);
}
```

`lib/sources/lobsters.mjs`:

```js
import { makeCandidate } from '../candidate.mjs';

export async function lobsters(source, { fetchJson }) {
  const data = await fetchJson(`https://lobste.rs/t/${encodeURIComponent(source.tag)}.json`);
  return (Array.isArray(data) ? data : []).filter((s) => s?.title && (s.url || s.comments_url)).map((s) => makeCandidate({
    url: s.url || s.comments_url,
    discussionUrl: s.comments_url ?? null,
    title: s.title,
    excerpt: s.description_plain || null,
    source: 'lobsters',
    sourceName: source.name,
    publishedAt: s.created_at,
    engagement: (s.score ?? 0) + 2 * (s.comment_count ?? 0),
    categoryHint: source.categoryHint,
  }));
}
```

`lib/sources/index.mjs`:

```js
import { hn } from './hn.mjs';
import { reddit } from './reddit.mjs';
import { github } from './github.mjs';
import { devto } from './devto.mjs';
import { rss } from './rss.mjs';
import { mastodon } from './mastodon.mjs';
import { bluesky } from './bluesky.mjs';
import { lobsters } from './lobsters.mjs';

export const adapters = { hn, reddit, github, devto, rss, mastodon, bluesky, lobsters };
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/sources/mastodon.mjs lib/sources/bluesky.mjs lib/sources/lobsters.mjs lib/sources/index.mjs tests/sources.test.mjs tests/fixtures/mastodon-tag.json tests/fixtures/mastodon-trends.json tests/fixtures/bluesky-feed.json tests/fixtures/lobsters.json
git commit -m "Add Mastodon, Bluesky and Lobsters JSON adapters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Per-topic quotas and per-source caps

**Files:**
- Modify: `lib/collect.mjs`, `config/feed.mjs`
- Test: `tests/collect.test.mjs`, `tests/sources.test.mjs`

**Interfaces:**
- Produces:
  - `selectByQuota(candidates: object[], quota: Record<string, number>, max: number) => object[]`. The result is sorted by hotness, descending. A hint missing from `quota` counts as `it`.
  - `cfg.candidateQuota`.
  - `source.perSourceCap` overrides `cfg.perSourceCap`.

- [ ] **Step 1: Write the failing tests** (append to `tests/collect.test.mjs`)

```js
import { selectByQuota } from '../lib/collect.mjs';
import { feedConfig } from '../config/feed.mjs';

const h = (title, categoryHint, hotness) => ({ id: title, title, categoryHint, hotness });

test('selectByQuota fills each topic hottest-first, refills spare slots, never exceeds max', () => {
  const cands = [
    h('ai1', 'ai', 0.9), h('ai2', 'ai', 0.8), h('ai3', 'ai', 0.7), h('ai4', 'ai', 0.6),
    h('t1', 'testing', 0.2),
    h('hu1', 'humor', 0.1),
  ];
  const out = selectByQuota(cands, { ai: 2, testing: 2, humor: 1 }, 5);
  assert.deepEqual(out.map((c) => c.title), ['ai1', 'ai2', 'ai3', 't1', 'hu1'], 'testing used 1 of 2 slots; the spare went to ai3');
  assert.equal(selectByQuota(cands, { ai: 2, testing: 2, humor: 1 }, 3).length, 3);
});

test('selectByQuota counts a hint with no quota as it (review focus 3)', () => {
  const cands = [h('x', 'typo', 0.9), h('i', 'it', 0.5), h('a', 'ai', 0.4)];
  const out = selectByQuota(cands, { it: 1, ai: 1 }, 2);
  assert.deepEqual(out.map((c) => c.title), ['x', 'a'], '"typo" took the it slot, so "i" waits for a spare that never comes');
});

test('collect applies candidateQuota and a source-level perSourceCap', async () => {
  // Titles must differ in word tokens (digits are dropped by titleTokens), or dedup merges them.
  const many = (prefix, n, hint) => Array.from({ length: n }, (_, i) => makeCandidate({ url: `https://a.com/${prefix}${i}`, title: `${prefix} ${'w'.repeat(i + 2)} story`, source: 's', sourceName: prefix, publishedAt: '2026-10-03T20:00:00Z', engagement: 100 - i, categoryHint: hint }));
  const adapters = { f: async (s) => many(s.id, 10, s.categoryHint) };
  const sources = [
    { id: 'aa', family: 'f', p90: 100, categoryHint: 'ai', perSourceCap: 3 },
    { id: 'tt', family: 'f', p90: 100, categoryHint: 'testing' },
  ];
  const out = await collect({ sources, adapters, http: {}, now, cfg: { ...cfg, perSourceCap: 10, maxCandidates: 6, candidateQuota: { ai: 3, testing: 3 } }, knownIds: new Set(), log: () => {} });
  assert.equal(out.candidates.length, 6);
  assert.equal(out.candidates.filter((c) => c.categoryHint === 'ai').length, 3);
});

test('feed config quotas sum to maxCandidates and cover every hint', () => {
  const q = feedConfig.candidateQuota;
  assert.equal(Object.values(q).reduce((a, b) => a + b, 0), feedConfig.maxCandidates);
  assert.deepEqual(Object.keys(q).sort(), ['ai', 'hot', 'humor', 'it', 'testing']);
  assert.equal(feedConfig.detailMaxPerDay, feedConfig.maxCandidates);
});
```

In `tests/sources.test.mjs`, change the hint check in `config/sources.mjs entries are well formed` to:

```js
    assert.ok(['ai', 'testing', 'it', 'humor', 'hot'].includes(s.categoryHint), `${s.id} bad hint`);
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/collect.test.mjs`
Expected: FAIL. `selectByQuota` is not exported.

- [ ] **Step 3: Implement**

In `lib/collect.mjs`:
- change `.slice(0, cfg.perSourceCap)` to `.slice(0, source.perSourceCap ?? cfg.perSourceCap)`;
- replace the `candidates` line with:

```js
  const deduped = dedupeCandidates(filterKnown(unseen, knownIds));
  const candidates = cfg.candidateQuota
    ? selectByQuota(deduped, cfg.candidateQuota, cfg.maxCandidates)
    : deduped.slice(0, cfg.maxCandidates);
```

and add:

```js
// Hottest-first within each topic's quota, so busy AI/IT sources cannot
// crowd out testing and humor; slots a topic leaves empty go to the
// hottest leftovers of any topic. A hint without a quota counts as `it`.
export function selectByQuota(candidates, quota, max) {
  const sorted = [...candidates].sort((a, b) => b.hotness - a.hotness);
  const used = {};
  const picked = new Set();
  for (const c of sorted) {
    const g = Object.hasOwn(quota, c.categoryHint) ? c.categoryHint : 'it';
    if ((used[g] ?? 0) < (quota[g] ?? 0) && picked.size < max) {
      used[g] = (used[g] ?? 0) + 1;
      picked.add(c);
    }
  }
  for (const c of sorted) {
    if (picked.size >= max) break;
    picked.add(c);
  }
  return sorted.filter((c) => picked.has(c));
}
```

In `config/feed.mjs`, set `maxCandidates: 200` and `detailMaxPerDay: 200` (update both comments). After `maxCandidates`, add:

```js
  // Candidates per source categoryHint, hottest first; unused slots go to
  // the hottest leftovers. Must sum to maxCandidates (tests check).
  candidateQuota: { ai: 50, testing: 50, it: 35, humor: 30, hot: 35 },
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/collect.mjs config/feed.mjs tests/collect.test.mjs tests/sources.test.mjs
git commit -m "Select candidates by per-topic quota; allow per-source caps; budget 200

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Script-decided hot eligibility and known hot topics

**Files:**
- Create: `lib/hot.mjs`
- Modify: `lib/collect.mjs`, `lib/dedup.mjs`, `scripts/fetch.mjs`
- Test: `tests/hot.test.mjs` (new), `tests/collect.test.mjs`, `tests/dedup.test.mjs`

**Interfaces:**
- Consumes: `sourcesOf` from `lib/candidate.mjs`.
- Produces (`lib/hot.mjs`):
  - `HOT_CATEGORY: RegExp`
  - `HOT_SLUG_MAX = 24`
  - `HOT_LABEL_MAX = 24`
  - `isHotCategory(c: unknown) => boolean`
  - `markHot(candidates, { topShare = 0.25 }?) => candidates`, each with `hotEligible: boolean`
  - `hotCategoriesFrom(items) => [{ slug, label, count }]`, sorted by count descending, then slug
- Also produces:
  - candidates carry `signal: boolean` (source family is not `rss`) and `editorialHot: boolean` (set in collect);
  - `data/candidates.json` gains top-level `hotCategories`.

- [ ] **Step 1: Write the failing tests**

`tests/hot.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHotCategory, markHot, hotCategoriesFrom } from '../lib/hot.mjs';

test('isHotCategory: hot- prefix, 1-3 lowercase words, at most 24 chars', () => {
  for (const ok of ['hot-security', 'hot-launch', 'hot-cloud-outage', 'hot-a-b-c', 'hot-chips2']) assert.ok(isHotCategory(ok), ok);
  for (const bad of ['hot-', 'hot', 'hot-Security', 'hot-a-b-c-d', 'hot-' + 'x'.repeat(21), 'it-general', 'hot-sec urity', 'hot_x', null, 42]) assert.ok(!isHotCategory(bad), String(bad));
});

const c = (id, hotness, extra = {}) => ({ id, hotness, signal: true, sourceName: id, sources: [id], ...extra });

test('markHot: top 25% of measured candidates, any 2+ source story, any editorialHot story', () => {
  const out = markHot([
    c('a', 1.8), c('b', 1.2), c('c', 0.5), c('d', 0.4), c('e', 0.3), c('f', 0.2), c('g', 0.1), c('h', 0.05),
    c('multi', 0.01, { sources: ['HN', 'Lobsters'] }),
    c('tm', 1, { signal: false, editorialHot: true }),
  ]);
  const hot = out.filter((x) => x.hotEligible).map((x) => x.id);
  assert.deepEqual(hot, ['a', 'b', 'c', 'multi', 'tm'], '9 measured → top ceil(2.25)=3: a, b, c');
});

test('markHot: RSS-only candidates never qualify through the percentile (review focus 4)', () => {
  const out = markHot([c('r1', 1, { signal: false }), c('r2', 1, { signal: false }), c('r3', 0.9, { signal: false })]);
  assert.deepEqual(out.map((x) => x.hotEligible), [false, false, false]);
  assert.equal(markHot([c('z', 0)])[0].hotEligible, false, 'zero hotness never qualifies');
});

test('hotCategoriesFrom lists hot-* slugs with the latest label, most used first', () => {
  const items = [
    { category: 'hot-security', categoryLabel: 'Bảo mật' },
    { category: 'hot-launch', categoryLabel: 'Ra mắt' },
    { category: 'hot-security', categoryLabel: 'An ninh mạng' },
    { category: 'ai-trend' },
    { category: 'hot-bad slug', categoryLabel: 'x' },
  ];
  assert.deepEqual(hotCategoriesFrom(items), [
    { slug: 'hot-security', label: 'An ninh mạng', count: 2 },
    { slug: 'hot-launch', label: 'Ra mắt', count: 1 },
  ]);
});
```

Append to `tests/dedup.test.mjs` (`dedupeCandidates` is already imported there; if not, import it from `../lib/dedup.mjs`):

```js
test('dedup keeps signal/editorialHot if any merged copy had them, without adding them otherwise', () => {
  const a = { id: 'a', url: 'https://a.com/1', title: 'Big cloud outage takes down the web', hotness: 1, sourceName: 'Techmeme', sources: ['Techmeme'], editorialHot: true, signal: false, extraLinks: [] };
  const b = { id: 'b', url: 'https://b.com/2', title: 'Big cloud outage takes down the web', hotness: 0.5, sourceName: 'HN', sources: ['HN'], signal: true, extraLinks: [] };
  const [m] = dedupeCandidates([a, b]);
  assert.equal(m.signal, true);
  assert.equal(m.editorialHot, true);
  assert.deepEqual(m.sources, ['Techmeme', 'HN']);
  const { signal: _s, ...noSignal } = b;
  const [plain] = dedupeCandidates([noSignal, { ...noSignal, id: 'c', url: 'https://c.com/3' }]);
  assert.equal('signal' in plain, false, 'absorb adds nothing when neither copy had the field');
});
```

Append to `tests/collect.test.mjs`:

```js
test('collect marks signal/editorialHot per source family and sets hotEligible', async () => {
  const adapters = {
    rss: async () => [mk('https://t.com/1', 'Editorial pick of the day')],
    hn: async () => [mk('https://h.com/1', 'Measured story with points')],
  };
  const sources = [
    { id: 'tm', family: 'rss', p90: 1, categoryHint: 'hot', editorialHot: true },
    { id: 'h', family: 'hn', p90: 100, categoryHint: 'it' },
  ];
  const { candidates } = await collect({ sources, adapters, http: {}, now, cfg: { ...cfg, perSourceCap: 5 }, knownIds: new Set(), log: () => {} });
  const tm = candidates.find((x) => x.url === 'https://t.com/1');
  const hn = candidates.find((x) => x.url === 'https://h.com/1');
  assert.deepEqual([tm.signal, tm.editorialHot, tm.hotEligible], [false, true, true]);
  assert.deepEqual([hn.signal, hn.editorialHot, hn.hotEligible], [true, false, true], 'only measured candidate → top 25%');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/hot.test.mjs tests/dedup.test.mjs tests/collect.test.mjs`
Expected: FAIL. `../lib/hot.mjs` cannot be found.

- [ ] **Step 3: Implement**

`lib/hot.mjs`:

```js
import { sourcesOf } from './candidate.mjs';

// `hot-*` categories: topics the curator may open for tech stories that are
// measurably hot and fit no core category. Schema mirrored in
// skills/daily-feed-curate/SKILL.md.
export const HOT_CATEGORY = /^hot-[a-z0-9]+(-[a-z0-9]+){0,2}$/;
export const HOT_SLUG_MAX = 24;
export const HOT_LABEL_MAX = 24;

export function isHotCategory(c) {
  return typeof c === 'string' && c.length <= HOT_SLUG_MAX && HOT_CATEGORY.test(c);
}

// Hot is decided by numbers, not by Claude: 2+ independent sources, an
// editor-ranked source (Techmeme), or the top `topShare` by hotness among
// candidates with a measured signal. RSS-only candidates have a constant
// hotness, so they never count toward or through the percentile.
export function markHot(candidates, { topShare = 0.25 } = {}) {
  const measured = candidates.filter((c) => c.signal).map((c) => c.hotness).sort((a, b) => b - a);
  const threshold = measured.length ? measured[Math.max(Math.ceil(measured.length * topShare), 1) - 1] : Infinity;
  return candidates.map((c) => ({
    ...c,
    hotEligible: sourcesOf(c).length >= 2 || Boolean(c.editorialHot) || (Boolean(c.signal) && c.hotness > 0 && c.hotness >= threshold),
  }));
}

// Hot topics already on the feed, so the curator reuses slugs instead of
// coining near-duplicates. The newest label wins.
export function hotCategoriesFrom(items) {
  const bySlug = new Map();
  for (const i of items) {
    if (!isHotCategory(i?.category)) continue;
    const e = bySlug.get(i.category) ?? { slug: i.category, label: '', count: 0 };
    e.count++;
    if (typeof i.categoryLabel === 'string' && i.categoryLabel.trim()) e.label = i.categoryLabel.trim();
    bySlug.set(i.category, e);
  }
  return [...bySlug.values()].sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}
```

`lib/dedup.mjs`, at the end of `absorb`:

```js
  if (other.signal) target.signal = true;
  if (other.editorialHot) target.editorialHot = true;
```

`lib/collect.mjs`:
- import `markHot` from `./hot.mjs`;
- in the `.map((c) => ({ ...c, hotness: ... }))`, add `signal: source.family !== 'rss', editorialHot: Boolean(source.editorialHot)`;
- change `const deduped = dedupeCandidates(...)` to `const deduped = markHot(dedupeCandidates(filterKnown(unseen, knownIds)));`.

`scripts/fetch.mjs`:
- import `hotCategoriesFrom` from `../lib/hot.mjs`;
- keep the retained items in a variable: `const retained = retainedItems(items, todayIn(cfg.timezone, now), cfg);`, then pass `knownItems: retained`;
- write `writeJson(dataFile('candidates.json'), { generatedAt: new Date(now).toISOString(), hotCategories: hotCategoriesFrom(retained), candidates });`.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hot.mjs lib/collect.mjs lib/dedup.mjs scripts/fetch.mjs tests/hot.test.mjs tests/collect.test.mjs tests/dedup.test.mjs
git commit -m "Mark hot-eligible candidates from platform numbers; list known hot topics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Validate and merge `hot-*` decisions; stub curation

**Files:**
- Modify: `lib/merge.mjs`, `scripts/stub-curate.mjs`
- Test: `tests/merge.test.mjs`, `tests/stub-curate.test.mjs`

**Interfaces:**
- Consumes: `isHotCategory`, `HOT_LABEL_MAX` (Task 7); candidate `hotEligible` (Task 7).
- Produces:
  - `validateDecision(d, candidateIds: Set, hotEligibleIds: Set = new Set()) => string[]`, with the new errors `'bad categoryLabelVi'`, `'unexpected categoryLabelVi'`, `'not hot-eligible'`.
  - Kept `hot-*` items carry `categoryLabel: string`.
  - Kept items no longer carry `signal`, `editorialHot` or `hotEligible`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/merge.test.mjs` (reuse the file's existing `keep(...)` helper and candidate builder; the snippet assumes `keep(c, overrides)` returns a valid keep decision for candidate `c`, as in the first test of that file):

```js
test('validateDecision: hot-* needs eligibility and a short Vietnamese label; core categories must not carry one', () => {
  const c = cand('https://a.com/hot');
  const ids = new Set([c.id]);
  const hotIds = new Set([c.id]);
  const hot = keep(c, { category: 'hot-security', categoryLabelVi: 'Bảo mật' });
  assert.deepEqual(validateDecision(hot, ids, hotIds), []);
  assert.ok(validateDecision(hot, ids).includes('not hot-eligible'), 'default: nobody is eligible');
  assert.ok(validateDecision(keep(c, { category: 'hot-security' }), ids, hotIds).includes('bad categoryLabelVi'));
  for (const label of ['', '   ', 'x'.repeat(25), 'a\nb', 42]) {
    assert.ok(validateDecision(keep(c, { category: 'hot-x', categoryLabelVi: label }), ids, hotIds).includes('bad categoryLabelVi'), JSON.stringify(label));
  }
  assert.ok(validateDecision(keep(c, { category: 'hot-Bad', categoryLabelVi: 'x' }), ids, hotIds).includes('bad category'));
  assert.ok(validateDecision(keep(c, { category: 'ai-trend', categoryLabelVi: 'x' }), ids, hotIds).includes('unexpected categoryLabelVi'));
});

test('mergeRun keeps the hot label and strips internal candidate fields', () => {
  const c = { ...cand('https://a.com/h2'), signal: true, editorialHot: false, hotEligible: true };
  const curated = { generatedAt: '2026-10-04T01:00:00.000Z', decisions: [keep(c, { category: 'hot-launch', categoryLabelVi: ' Ra mắt ' })] };
  const out = mergeRun({ candidates: [c], curated, items: [], dropped: [], today: '2026-10-04', cfg: mcfg, timezone: 'UTC' });
  assert.equal(out.counts.kept, 1);
  const [item] = out.items;
  assert.equal(item.category, 'hot-launch');
  assert.equal(item.categoryLabel, 'Ra mắt');
  for (const k of ['signal', 'editorialHot', 'hotEligible']) assert.equal(k in item, false, k);
});

test('mergeRun counts hot-* on an ineligible candidate as invalid', () => {
  const c = { ...cand('https://a.com/h3'), hotEligible: false };
  const curated = { generatedAt: '2026-10-04T01:00:00.000Z', decisions: [keep(c, { category: 'hot-launch', categoryLabelVi: 'Ra mắt' })] };
  const out = mergeRun({ candidates: [c], curated, items: [], dropped: [], today: '2026-10-04', cfg: mcfg, timezone: 'UTC' });
  assert.deepEqual([out.counts.kept, out.counts.invalid], [0, 1]);
});
```

Before writing these, read the top of `tests/merge.test.mjs`. Then either (a) reuse its existing candidate builder and cfg under the names `cand` and `mcfg`, or (b) define them right above the new tests:

```js
const cand = (url) => makeCandidate({ url, title: `Story ${url}`, source: 's', sourceName: 's', publishedAt: '2026-10-03T20:00:00Z', engagement: 10, categoryHint: 'hot' });
const mcfg = { retentionDays: 14, droppedMemoryDays: 30, buzzPerSource: 0.25, buzzMaxExtra: 3 };
```

Also import `makeCandidate` from `../lib/candidate.mjs` if the file does not already. If `keep` does not exist under that name, write it:

```js
const keep = (c, o = {}) => ({ id: c.id, keep: true, category: 'ai-trend', title: 'T', titleVi: 'TV', summary: 'S', tags: ['x'], fit: 3, ...o });
```

Replace the body of the existing test in `tests/stub-curate.test.mjs` with:

```js
test('stubCurate produces schema-valid decisions for every candidate', () => {
  const cands = ['ai', 'testing', 'it', 'humor', 'hot', 'hot'].map((hint, i) =>
    ({ ...makeCandidate({ url: `https://a.com/${i}`, title: `Title ${i}`, excerpt: 'x'.repeat(500), source: 's', sourceName: 's', publishedAt: '2026-10-03T00:00:00Z', categoryHint: hint }), hotness: 1 - i * 0.1, hotEligible: i === 4 }));
  const out = stubCurate(cands, '2026-10-04T00:00:00.000Z');
  assert.equal(out.generatedAt, '2026-10-04T00:00:00.000Z');
  assert.equal(out.decisions.length, 6);
  const ids = new Set(cands.map((c) => c.id));
  const hotIds = new Set(cands.filter((c) => c.hotEligible).map((c) => c.id));
  for (const d of out.decisions) assert.deepEqual(validateDecision(d, ids, hotIds), []);
  assert.deepEqual(out.decisions.map((d) => d.category), ['ai-trend', 'test-automation', 'it-general', 'humor', 'hot-general', 'it-general']);
  assert.equal(out.decisions[4].categoryLabelVi, 'Tin nóng');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/merge.test.mjs tests/stub-curate.test.mjs`
Expected: FAIL: `'bad category'` for `hot-security`; stub category mismatch.

- [ ] **Step 3: Implement**

`lib/merge.mjs`:
- import `{ isHotCategory, HOT_LABEL_MAX }` from `./hot.mjs`;
- replace `validateDecision` with:

```js
export function validateDecision(d, candidateIds, hotEligibleIds = new Set()) {
  if (!d || typeof d !== 'object') return ['not an object'];
  const errors = [];
  if (!candidateIds.has(d.id)) errors.push('unknown id');
  if (typeof d.keep !== 'boolean') errors.push('keep must be boolean');
  if (d.keep === true) {
    const hot = isHotCategory(d.category);
    if (!CATEGORIES.includes(d.category) && !hot) errors.push('bad category');
    if (hot) {
      const label = typeof d.categoryLabelVi === 'string' ? d.categoryLabelVi.trim() : '';
      if (!label || label.length > HOT_LABEL_MAX || /\n/.test(d.categoryLabelVi)) errors.push('bad categoryLabelVi');
      if (!hotEligibleIds.has(d.id)) errors.push('not hot-eligible');
    } else if (d.categoryLabelVi !== undefined) {
      errors.push('unexpected categoryLabelVi');
    }
    if (typeof d.title !== 'string' || !d.title.trim() || d.title.length > 110) errors.push('bad title');
    if (typeof d.titleVi !== 'string' || !d.titleVi.trim() || d.titleVi.length > TITLE_VI_MAX || /\n/.test(d.titleVi)) errors.push('bad titleVi');
    if (typeof d.summary !== 'string' || !d.summary.trim() || d.summary.length > 220) errors.push('bad summary');
    if (!Array.isArray(d.tags) || d.tags.length < 1 || d.tags.length > 3 || !d.tags.every((t) => typeof t === 'string' && t.trim())) errors.push('bad tags');
    if (!Number.isInteger(d.fit) || d.fit < 1 || d.fit > 5) errors.push('bad fit');
  }
  return errors;
}
```

- in `mergeRun`, after `const ids = new Set(byId.keys());`, add `const hotIds = new Set(candidates.filter((c) => c.hotEligible === true).map((c) => c.id));`;
- change the call to `validateDecision(d, ids, hotIds)`;
- replace `const c = byId.get(id);` and the `keptItems.push({ ...c,` opening with:

```js
    const { signal, editorialHot, hotEligible, ...c } = byId.get(id);
    keptItems.push({
      ...c,
      ...(isHotCategory(d.category) ? { categoryLabel: d.categoryLabelVi.trim() } : {}),
```

(the rest of the object is unchanged).

`scripts/stub-curate.mjs`: update the header comment ("maps the category hint to a category; hot-eligible `hot` candidates become `hot-general`"), and in the keep branch:

```js
    ? {
      id: c.id,
      keep: true,
      ...stubCategory(c),
```

replacing the `category:` line, with:

```js
function stubCategory(c) {
  if (c.categoryHint === 'hot' && c.hotEligible === true) return { category: 'hot-general', categoryLabelVi: 'Tin nóng' };
  return { category: CATEGORY_FOR_HINT[c.categoryHint] ?? 'it-general' };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/merge.mjs scripts/stub-curate.mjs tests/merge.test.mjs tests/stub-curate.test.mjs
git commit -m "Accept hot-* decisions for hot-eligible candidates with a Vietnamese label

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Render the "Hot trên mạng" group

**Files:**
- Modify: `lib/render.mjs`, `site/assets/state.js`, `site/assets/app.js`, `site/assets/style.css`
- Test: `tests/render.test.mjs`, `tests/state.test.mjs`

**Interfaces:**
- Consumes: item `categoryLabel` (Task 8).
- Produces:
  - `groupOf('hot-…') === 'hot'`, in both `lib/render.mjs` and `site/assets/state.js`.
  - `GROUP_LABEL.hot = 'Hot trên mạng'`.
  - A card with a label gets `data-category-label`.
  - `LIMITS.categoryLabel = 40` in `state.js`; saved snapshots carry `categoryLabel`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/render.test.mjs` (`renderCard`, `renderPage`, `groupOf`, `GROUP_LABEL` come from `../lib/render.mjs`; add any missing names to the existing import):

```js
test('hot-* items render in the hot group with an escaped Vietnamese label (review focus 5)', () => {
  const item = { id: 'a'.repeat(40), url: 'https://a.com/x', title: 'T', titleVi: 'TV', summary: 'S', category: 'hot-security', categoryLabel: '<img src=x onerror=alert(1)>', sourceName: 'Techmeme', tags: ['x'], fit: 3, hotness: 1, addedAt: '2026-10-04' };
  assert.equal(groupOf('hot-security'), 'hot');
  assert.equal(GROUP_LABEL.hot, 'Hot trên mạng');
  const html = renderCard(item);
  assert.ok(html.includes('data-group="hot"'));
  assert.ok(html.includes('<span class="chip chip--hot">&lt;img src=x onerror=alert(1)&gt;</span>'), html);
  assert.ok(html.includes('data-category-label="&lt;img src=x onerror=alert(1)&gt;"'));
  assert.ok(!html.includes('<img src=x'));
  const plain = renderCard({ ...item, category: 'ai-tip', categoryLabel: undefined });
  assert.ok(plain.includes('<span class="chip chip--ai">AI tip</span>'));
  assert.ok(!plain.includes('data-category-label'));
});

test('the filter bar has a Hot trên mạng pill', () => {
  const html = renderPage({ title: 't', heading: 'h', items: [], hotNow: [], archiveDates: [], status: {}, sourceNames: [], generatedAt: '2026-10-04T00:00:00Z', basePath: './', isArchive: false, pageSize: 40 });
  assert.ok(html.includes('<button class="pill" data-filter="hot" type="button">Hot trên mạng</button>'));
});
```

If `renderPage` needs more arguments than shown, copy the argument object from an existing `renderPage` test in this file and add only what is missing.

In `tests/state.test.mjs`:
- in the `sanitizeSnapshot keeps known fields` test, add `'categoryLabel'` to the sorted key list (`['addedAt', 'category', 'categoryLabel', 'detail', ...]`) and `categoryLabel: ''` to the `gaps` expected object;
- in the `isHttpUrl and groupOf` test, change the loop to `for (const c of [...Object.keys(CATEGORY_LABEL), 'hot-security', 'hot-x', 'weird', ''])`;
- add:

```js
test('sanitizeSnapshot keeps a hot label and caps it', () => {
  assert.equal(sanitizeSnapshot(snap(A, { category: 'hot-launch', categoryLabel: 'Ra mắt' })).categoryLabel, 'Ra mắt');
  assert.equal(sanitizeSnapshot(snap(A, { categoryLabel: 'x'.repeat(41) })), null);
  assert.equal(groupOf('hot-launch'), 'hot');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/render.test.mjs tests/state.test.mjs`
Expected: FAIL. `groupOf('hot-security')` returns `'it'`.

- [ ] **Step 3: Implement**

`lib/render.mjs`:

```js
export const GROUP_LABEL = { ai: 'AI', testing: 'Testing', it: 'IT', humor: 'Humor', hot: 'Hot trên mạng' };
```

In `groupOf`, add as the first line of the body: `if (category.startsWith('hot-')) return 'hot';`

In `renderCard`:

```js
  const label = (typeof item.categoryLabel === 'string' && item.categoryLabel.trim()) || CATEGORY_LABEL[item.category] || item.category;
  const labelAttr = typeof item.categoryLabel === 'string' && item.categoryLabel.trim() ? ` data-category-label="${escapeHtml(item.categoryLabel.trim())}"` : '';
  const data = `data-group="${group}" data-id="${escapeHtml(item.id)}" data-url="${escapeHtml(safeUrl(item.url) ?? '')}" data-category="${escapeHtml(item.category)}"${labelAttr} data-added="${escapeHtml(item.addedAt)}"`;
```

and the chip becomes `<span class="chip chip--${group}">${escapeHtml(label)}</span>`.

`site/assets/state.js`:
- `LIMITS` gets `categoryLabel: 40` (after `category: 40`);
- `groupOf` gets the same first line as render: `if (category.startsWith('hot-')) return 'hot';`.

`site/assets/app.js`:
- `const GROUPS = ['ai', 'testing', 'it', 'humor', 'hot'];`
- in `buildCard`, after `card.dataset.category = item.category;`: `if (item.categoryLabel) card.dataset.categoryLabel = item.categoryLabel;`
- in `buildCard`, change the chip text argument to `item.categoryLabel || ($(`[data-filter="${g}"]`)?.textContent ?? g)`
- in `snapshotFromCard`, after the `category:` line: `categoryLabel: clip('categoryLabel', card.dataset.categoryLabel || ''),`

`site/assets/style.css`:
The colour token is named `--hot-color`, **not** `--hot`. Each card already sets `--hot` inline as its hotness percentage (`style="--hot: N%"`), and a colour token with that name would collide with it.
- Next to every `--humor:` definition (run `grep -n -- '--humor:' site/assets/style.css`; there is one per theme block), add `--hot-color: #ef4444;`. In a dark-theme block, use `--hot-color: #f87171;` instead.
- After `.chip--humor`, add `.chip--hot { background: var(--hot-color); }`.
- After the `.card[data-group="humor"] .hot` rule, add `.card[data-group="hot"] .hot { background: linear-gradient(90deg, var(--hot-color) var(--hot), transparent var(--hot)); }`.
- If the pills have per-group active colours (`grep -n 'data-filter=' site/assets/style.css`), add a matching `hot` rule using `var(--hot-color)`.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Visual check**

Run: `npm run feed:stub` (offline-safe for curation; fetch uses the network) and then `npm run serve`. Open http://localhost:8080. Check:
- the "Hot trên mạng" pill filters to hot cards;
- the chip reads "Tin nóng" in red;
- saving a hot card and opening Saved still shows "Tin nóng".

Then restore the generated output: `git checkout -- data site/index.html site/archive site/feed.json`, and `rm -f data/sightings.json` if it is present.

- [ ] **Step 6: Commit**

```bash
git add lib/render.mjs site/assets/state.js site/assets/app.js site/assets/style.css tests/render.test.mjs tests/state.test.mjs
git commit -m "Render hot-* items in a Hot trên mạng group with their label

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Skill rules and per-step model/effort in the runner

**Files:**
- Modify: `skills/daily-feed-curate/SKILL.md`, `skills/daily-feed-detail/SKILL.md`, `scripts/daily-feed-run.sh`
- Test: `tests/runner.test.mjs` (new)

**Interfaces:**
- Consumes: the schema from Task 8 (`hot-*`, `categoryLabelVi`, `hotEligible`, `hotCategories`).
- Produces: env vars `DAILY_FEED_CURATE_MODEL`, `DAILY_FEED_CURATE_EFFORT`, `DAILY_FEED_DETAIL_MODEL`, `DAILY_FEED_DETAIL_EFFORT`, `DAILY_FEED_FALLBACK_MODEL`.

- [ ] **Step 1: Write the failing test** (`tests/runner.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const path = new URL('../scripts/daily-feed-run.sh', import.meta.url);
const sh = readFileSync(path, 'utf8');
const skill = readFileSync(new URL('../skills/daily-feed-curate/SKILL.md', import.meta.url), 'utf8');

test('runner is valid bash', () => {
  execFileSync('bash', ['-n', path.pathname]);
});

test('runner pins model, effort and fallback per claude step, overridable by env', () => {
  assert.ok(sh.includes('CURATE_MODEL="${DAILY_FEED_CURATE_MODEL:-claude-sonnet-5-5}"'));
  assert.ok(sh.includes('CURATE_EFFORT="${DAILY_FEED_CURATE_EFFORT:-medium}"'));
  assert.ok(sh.includes('DETAIL_MODEL="${DAILY_FEED_DETAIL_MODEL:-claude-sonnet-5-5}"'));
  assert.ok(sh.includes('DETAIL_EFFORT="${DAILY_FEED_DETAIL_EFFORT:-low}"'));
  assert.ok(sh.includes('FALLBACK_MODEL="${DAILY_FEED_FALLBACK_MODEL:-claude-haiku-4-5-20251001}"'));
  const block = (name) => sh.slice(sh.indexOf(`claude -p "/${name}"`), sh.indexOf('--max-turns', sh.indexOf(`claude -p "/${name}"`)));
  assert.match(block('daily-feed-curate'), /--model "\$CURATE_MODEL" --effort "\$CURATE_EFFORT" --fallback-model "\$FALLBACK_MODEL"/);
  assert.match(block('daily-feed-detail'), /--model "\$DETAIL_MODEL" --effort "\$DETAIL_EFFORT" --fallback-model "\$FALLBACK_MODEL"/);
});

test('curate skill documents the hot-* schema the validator enforces', () => {
  for (const s of ['hot-<slug>', 'categoryLabelVi', 'hotEligible', 'hotCategories', '24', 'Runs on']) assert.ok(skill.includes(s), s);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/runner.test.mjs`
Expected: FAIL on the `CURATE_MODEL` assertion.

- [ ] **Step 3: Implement the runner**

In `scripts/daily-feed-run.sh`, after the `TARGET_TIME=` line:

```bash
# Model and effort per Claude step (spec 2026-10-04-more-sources-and-hot-topics).
# Curation judges ~200 items: Sonnet at medium effort. Details mostly
# summarise fetched text and are checked by parseDetail: Sonnet at low.
# Haiku takes over only when the main model is overloaded.
CURATE_MODEL="${DAILY_FEED_CURATE_MODEL:-claude-sonnet-5-5}"
CURATE_EFFORT="${DAILY_FEED_CURATE_EFFORT:-medium}"
DETAIL_MODEL="${DAILY_FEED_DETAIL_MODEL:-claude-sonnet-5-5}"
DETAIL_EFFORT="${DAILY_FEED_DETAIL_EFFORT:-low}"
FALLBACK_MODEL="${DAILY_FEED_FALLBACK_MODEL:-claude-haiku-4-5-20251001}"
```

Add to the `=== ... daily-feed run` echo line: ` curate=$CURATE_MODEL/$CURATE_EFFORT detail=$DETAIL_MODEL/$DETAIL_EFFORT`.

In the curate `claude -p` call, add a line before `--output-format text --max-turns 20; then`:

```bash
        --model "$CURATE_MODEL" --effort "$CURATE_EFFORT" --fallback-model "$FALLBACK_MODEL" \
```

In the detail `claude -p` call, add a line before `--output-format text --max-turns 40; then`:

```bash
      --model "$DETAIL_MODEL" --effort "$DETAIL_EFFORT" --fallback-model "$FALLBACK_MODEL" \
```

- [ ] **Step 4: Implement the curate skill text**

In `skills/daily-feed-curate/SKILL.md`:

1. After the `**Invoke:**` / `**Reads:**` lines near the top (or right after the frontmatter if those don't exist), add:

```markdown
**Runs on:** `claude-sonnet-5-5` at effort `medium`, set by `scripts/daily-feed-run.sh` (`DAILY_FEED_CURATE_MODEL` / `DAILY_FEED_CURATE_EFFORT` override). Keep reasoning proportionate: one pass over the candidates, no re-reading.
```

2. In the "Agent contract" table, change the Input row so it also says: "`candidates.json` has `candidates` (each with `categoryHint` and `hotEligible`) and `hotCategories` (hot topics already on the feed: `slug`, `label`, `count`)."

3. In the "Decision schema" JSON, replace the `category` line and add `categoryLabelVi`:

```json
      "category": "ai-trend | ai-product-idea | ai-tip | test-automation | test-manual | test-db | test-api | test-perf | it-general | humor | hot-<slug>",
      "categoryLabelVi": "<only for hot-<slug>: nhãn tiếng Việt ngắn, 1-24 ký tự, một dòng, e.g. \"Bảo mật\">",
```

4. Add this section after "Keep / drop rules":

```markdown
## Hot topics (`hot-<slug>`)

A fifth area, **Hot trên mạng**, holds tech-adjacent stories that are hot right now and fit no core category: big launches, outages, security incidents, the business of tech, science and gadgets, dev-community drama.

- Use `hot-<slug>` **only** on a candidate with `"hotEligible": true`. The script sets that flag from platform numbers (upvotes, points, boosts, several sources, Techmeme). Merge rejects `hot-*` on any other candidate, which counts as a drop.
- A hot story about AI or testing keeps its `ai-*` / `test-*` category. Hot is for what the core categories cannot hold.
- Slug: `hot-` plus 1–3 lowercase English words joined by `-`, at most 24 characters in total (e.g. `hot-security`, `hot-launch`, `hot-cloud-outage`).
- Reuse a slug from `hotCategories` whenever one fits, with its `label`. Coin a new slug only for a clearly different topic. Aim for at most 5 distinct hot slugs per run.
- `categoryLabelVi` is required for `hot-*` (1–24 characters, Vietnamese, one line). Never add `categoryLabelVi` to a core category.
- Still drop politics, celebrity, sports, crime, and general news not about technology, however hot it is.
```

5. In "Keep / drop rules", change "Keep only items in these four areas" to "Keep only items in these five areas (the fifth is Hot topics below)", and "anything you cannot place in the four areas" to "anything you cannot place in the five areas".

- [ ] **Step 5: Implement the detail skill text**

In `skills/daily-feed-detail/SKILL.md`, after the `**Reads:** ... **Writes:** ...` line, add:

```markdown
**Runs on:** `claude-sonnet-5-5` at effort `low`, set by `scripts/daily-feed-run.sh` (`DAILY_FEED_DETAIL_MODEL` / `DAILY_FEED_DETAIL_EFFORT` override). Summarise what the source says; do not deliberate beyond it.
```

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Check the CLI accepts the flags (live; one tiny call)**

Run: `claude -p "Reply with the single word ok." --model claude-sonnet-5-5 --effort low --fallback-model claude-haiku-4-5-20251001 --max-turns 1 --output-format text`
Expected: `ok`. If the CLI rejects a flag or a model id, stop and report the exact error; do not change the defaults without asking.

- [ ] **Step 8: Commit**

```bash
git add scripts/daily-feed-run.sh skills/daily-feed-curate/SKILL.md skills/daily-feed-detail/SKILL.md tests/runner.test.mjs
git commit -m "Teach curation the hot-* schema; pin model and effort per Claude step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: New sources, live verification, p90 calibration, docs

**Files:**
- Modify: `config/sources.mjs`, `README.md`, `CLAUDE.md`
- Test: `tests/sources.test.mjs` (existing config checks), plus the live scripts below (run once; not committed)

**Interfaces:**
- Consumes: all adapters (Tasks 3–5); `editorialHot` (Task 7); `perSourceCap` (Task 6).

- [ ] **Step 1: Add the candidate sources to `config/sources.mjs`**

Append to the Reddit block:

```js
  { id: 'r-playwright', name: 'r/Playwright', family: 'reddit', sub: 'Playwright', t: 'week', categoryHint: 'testing', p90: 40, maxAgeHours: 168 },
  { id: 'r-selenium', name: 'r/selenium', family: 'reddit', sub: 'selenium', t: 'week', categoryHint: 'testing', p90: 30, maxAgeHours: 168 },
  { id: 'r-devops', name: 'r/devops', family: 'reddit', sub: 'devops', categoryHint: 'it', p90: 300 },
  { id: 'r-experienceddevs', name: 'r/ExperiencedDevs', family: 'reddit', sub: 'ExperiencedDevs', categoryHint: 'it', p90: 600 },
  { id: 'r-sysadmin', name: 'r/sysadmin', family: 'reddit', sub: 'sysadmin', categoryHint: 'it', p90: 900 },
  { id: 'r-programmingmemes', name: 'r/programmingmemes', family: 'reddit', sub: 'programmingmemes', categoryHint: 'humor', p90: 1500, isMeme: true },
  { id: 'r-techhumor', name: 'r/techhumor', family: 'reddit', sub: 'techhumor', t: 'week', categoryHint: 'humor', p90: 300, isMeme: true, maxAgeHours: 168 },
  { id: 'r-technology', name: 'r/technology', family: 'reddit', sub: 'technology', categoryHint: 'hot', p90: 15000, perSourceCap: 15 },
  { id: 'r-openai', name: 'r/OpenAI', family: 'reddit', sub: 'OpenAI', categoryHint: 'ai', p90: 1500 },
  { id: 'r-singularity', name: 'r/singularity', family: 'reddit', sub: 'singularity', categoryHint: 'ai', p90: 1500, perSourceCap: 15 },
```

Replace the two Lobsters RSS entries with:

```js
  // Lobsters JSON (real score + comments)
  { id: 'lobsters-ai', name: 'Lobsters', family: 'lobsters', tag: 'ai', categoryHint: 'ai', p90: 60, maxAgeHours: 168 },
  { id: 'lobsters-testing', name: 'Lobsters', family: 'lobsters', tag: 'testing', categoryHint: 'testing', p90: 60, maxAgeHours: 168 },
  { id: 'lobsters-programming', name: 'Lobsters', family: 'lobsters', tag: 'programming', categoryHint: 'it', p90: 80 },
  { id: 'lobsters-security', name: 'Lobsters', family: 'lobsters', tag: 'security', categoryHint: 'it', p90: 60, maxAgeHours: 168 },
  { id: 'lobsters-devops', name: 'Lobsters', family: 'lobsters', tag: 'devops', categoryHint: 'it', p90: 50, maxAgeHours: 168 },
  { id: 'lobsters-practices', name: 'Lobsters', family: 'lobsters', tag: 'practices', categoryHint: 'it', p90: 60, maxAgeHours: 168 },
```

Add new blocks:

```js
  // Mastodon (public API, no login). sourceName 'Mastodon' for all, so one
  // link boosted on two instances is one source, not buzz.
  { id: 'mstdn-softwaretesting', name: 'Mastodon', family: 'mastodon', instance: 'hachyderm.io', tag: 'softwaretesting', categoryHint: 'testing', p90: 20, perSourceCap: 15, maxAgeHours: 168 },
  { id: 'mstdn-testautomation', name: 'Mastodon', family: 'mastodon', instance: 'hachyderm.io', tag: 'testautomation', categoryHint: 'testing', p90: 20, perSourceCap: 15, maxAgeHours: 168 },
  { id: 'mstdn-playwright', name: 'Mastodon', family: 'mastodon', instance: 'hachyderm.io', tag: 'playwright', categoryHint: 'testing', p90: 20, perSourceCap: 15, maxAgeHours: 168 },
  { id: 'mstdn-qa', name: 'Mastodon', family: 'mastodon', instance: 'hachyderm.io', tag: 'qa', categoryHint: 'testing', p90: 20, perSourceCap: 15, maxAgeHours: 168 },
  { id: 'mstdn-llm', name: 'Mastodon', family: 'mastodon', instance: 'fosstodon.org', tag: 'llm', categoryHint: 'ai', p90: 30, perSourceCap: 15 },
  { id: 'mstdn-programminghumor', name: 'Mastodon', family: 'mastodon', instance: 'fosstodon.org', tag: 'programminghumor', categoryHint: 'humor', p90: 40, perSourceCap: 15, maxAgeHours: 168 },
  { id: 'mstdn-devhumor', name: 'Mastodon', family: 'mastodon', instance: 'hachyderm.io', tag: 'devhumor', categoryHint: 'humor', p90: 40, perSourceCap: 15, maxAgeHours: 168 },
  { id: 'mstdn-trends', name: 'Mastodon trends', family: 'mastodon', instance: 'hachyderm.io', mode: 'trendsLinks', categoryHint: 'hot', p90: 50, perSourceCap: 15 },

  // Bluesky public custom feeds (found via getPopularFeedGenerators on 2026-10-04)
  { id: 'bsky-tech-news', name: 'Bluesky', family: 'bluesky', feed: 'at://did:plc:ke6e3skfhjdsnky5d3ojauh3/app.bsky.feed.generator/news-tech', categoryHint: 'hot', p90: 30, perSourceCap: 15 },
  { id: 'bsky-llm', name: 'Bluesky', family: 'bluesky', feed: 'at://did:plc:3x2yyg4s6c6n26caev222yv3/app.bsky.feed.generator/whats-llm', categoryHint: 'ai', p90: 30, perSourceCap: 15 },
  { id: 'bsky-softdev', name: 'Bluesky', family: 'bluesky', feed: 'at://did:plc:pmyqirafcp3jqdhrl7crpq7t/app.bsky.feed.generator/aaao5gbpi7evg', categoryHint: 'it', p90: 30, perSourceCap: 15 },
  { id: 'bsky-programmer-humor', name: 'Bluesky', family: 'bluesky', feed: 'at://did:plc:brwvwcp2x6oj3gq7odlfq5qf/app.bsky.feed.generator/aaacqpol2uw5w', categoryHint: 'humor', p90: 20, perSourceCap: 15, maxAgeHours: 168 },
  { id: 'bsky-agile-testing-days', name: 'Bluesky', family: 'bluesky', feed: 'at://did:plc:egwtm62hp4lxnr5z7nathgab/app.bsky.feed.generator/atd-feed', categoryHint: 'testing', p90: 10, perSourceCap: 15, maxAgeHours: 168 },

  // Hot-topic signal: Techmeme's front page is editor-ranked, so its items
  // are hot-eligible without engagement numbers (lib/hot.mjs markHot).
  { id: 'techmeme', name: 'Techmeme', family: 'rss', url: 'https://www.techmeme.com/feed.xml', categoryHint: 'hot', p90: 1, editorialHot: true },
```

Append to the testing/engineering RSS block:

```js
  { id: 'ministryoftesting', name: 'Ministry of Testing', family: 'rss', url: 'https://www.ministryoftesting.com/feed', categoryHint: 'testing', p90: 1, maxAgeHours: 168 },
  { id: 'angiejones', name: 'Angie Jones', family: 'rss', url: 'https://angiejones.tech/feed/', categoryHint: 'testing', p90: 1, maxAgeHours: 336 },
  { id: 'satisfice', name: 'Satisfice (James Bach)', family: 'rss', url: 'https://www.satisfice.com/feed', categoryHint: 'testing', p90: 1, maxAgeHours: 336 },
  { id: 'developsense', name: 'DevelopSense (Michael Bolton)', family: 'rss', url: 'https://www.developsense.com/feed/', categoryHint: 'testing', p90: 1, maxAgeHours: 336 },
  { id: 'pragmatic-engineer', name: 'The Pragmatic Engineer', family: 'rss', url: 'https://blog.pragmaticengineer.com/rss/', categoryHint: 'it', p90: 1, maxAgeHours: 168 },
```

- [ ] **Step 2: Run the config tests**

Run: `npm test`
Expected: PASS: unique ids, known families, valid hints, and each source has url, query, sub, tag, feed or mode.

- [ ] **Step 3: Live-verify every source (network)**

Write this to `./.verify-sources.mjs` at the repo root (its relative imports resolve from there). Run it with `node ./.verify-sources.mjs`, then `rm ./.verify-sources.mjs`. Never commit it.

```js
import { sources } from './config/sources.mjs';
import { feedConfig as cfg } from './config/feed.mjs';
import { adapters } from './lib/sources/index.mjs';
import { fetchJson, fetchText, publicLookup } from './lib/http.mjs';
import { redditCredentials } from './lib/secrets.mjs';
import { makeRedditClient } from './lib/reddit-client.mjs';
import { isTooOld } from './lib/score.mjs';

const now = Date.now();
const redditClient = makeRedditClient({ creds: redditCredentials(), lookup: publicLookup(cfg.redditResolvers) });
for (const s of sources) {
  try {
    const got = await adapters[s.family](s, { fetchJson, fetchText, redditClient, now });
    const fresh = got.filter((c) => !isTooOld(c.publishedAt, now, s.maxAgeHours ?? cfg.maxAgeHours));
    const eng = fresh.map((c) => c.engagement).sort((a, b) => a - b);
    const p90 = eng.length ? eng[Math.floor(eng.length * 0.9)] : 0;
    console.log(`${fresh.length ? 'OK  ' : 'EMPTY'} ${s.id.padEnd(28)} fresh=${String(fresh.length).padStart(3)} of ${String(got.length).padStart(3)}  observed_p90=${p90}  config_p90=${s.p90}`);
  } catch (e) {
    console.log(`FAIL ${s.id.padEnd(28)} ${String(e.message).slice(0, 100)}`);
  }
}
```

Then act on the output:
- **FAIL** with a 404, DNS error, or non-feed content: remove the entry. Reddit sources are the exception. If they FAIL with `HTTP 403` and the owner has not created a key yet, they are expected to fail until then: keep them.
- **EMPTY** for a non-Reddit source: remove it, unless it is a weekly/low-volume source whose `got` count is above 0 (it simply had nothing fresh today).
- Each Mastodon, Bluesky, Lobsters, and Reddit source with 10+ fresh items: set `p90` to its `observed_p90`, rounded to 2 significant figures.

- [ ] **Step 4: Re-run tests and a full stub pipeline**

Run: `npm test && npm run feed:stub`
Expected:
- tests PASS;
- the runner log shows `[fetch] wrote N candidates`, with N close to 200 when enough sources answer;
- curate (stub), merge, detail (stub) and build all complete;
- `site/index.html` contains `data-filter="hot"`, and at least one `chip--hot` card if any Techmeme or trending item was eligible.

Check the topic mix with:

```bash
node -e 'const {candidates,hotCategories}=require("./data/candidates.json");const n={};for(const c of candidates)n[c.categoryHint]=(n[c.categoryHint]||0)+1;console.log(n, "hotEligible:", candidates.filter(c=>c.hotEligible).length, "hotCategories:", hotCategories.length)'
```

Record the numbers in the final report. Then restore generated output: `git checkout -- data site/index.html site/archive site/feed.json`, and `rm -f data/sightings.json`.

- [ ] **Step 5: Update docs**

`README.md`: add a section "Reddit access":

```markdown
## Reddit access

Reddit answers anonymous requests with 403, and this network's ISP DNS sends reddit.com to 127.0.0.1. The pipeline handles the DNS part itself: Reddit requests, and only those, resolve through 1.1.1.1 / 8.8.8.8 (`redditResolvers` in `config/feed.mjs`). Your Mac's DNS is never changed.

For the 403, create a free app key:

1. Sign in at https://www.reddit.com/prefs/apps → "create another app…".
2. Type **script**, any name, redirect uri `http://localhost:8080` (unused).
3. Create `config/secrets.local.json` (gitignored):

   ```json
   { "reddit": { "clientId": "<under the app name>", "clientSecret": "<secret>", "userAgent": "daily-feed/1.0 by <your reddit username>" } }
   ```

4. `npm run fetch` should log `[fetch] reddit: oauth` and the `r-*` sources should no longer fail.
```

Also add a "Model and effort" paragraph listing the five env vars and their defaults (copy them from Global Constraints).

`CLAUDE.md`:
- in Architecture step 1, list the families as `lib/sources/{hn,reddit,github,devto,rss,mastodon,bluesky,lobsters}.mjs`;
- add after the per-source cap sentence: "Reddit goes through `lib/reddit-client.mjs` (OAuth key from gitignored `config/secrets.local.json`, public resolvers from `redditResolvers`). Candidates get `signal`/`editorialHot`, then `markHot` (`lib/hot.mjs`) sets `hotEligible`, and `selectByQuota` fills `candidateQuota` per `categoryHint` up to `maxCandidates`. `candidates.json` also carries `hotCategories`.";
- in step 2, add: "The runner passes `--model`/`--effort`/`--fallback-model` (defaults and env overrides at the top of the runner).";
- in the schema paragraph, change "so a category change touches all four" to: "so a category change touches all four. `hot-*` categories (`lib/hot.mjs`: slug format, label limit, `hotEligible` rule) are part of that schema, and `site/assets/state.js` `groupOf` must match `lib/render.mjs`."

- [ ] **Step 6: Commit**

```bash
git add config/sources.mjs README.md CLAUDE.md
git commit -m "Add Reddit, Mastodon, Bluesky, Lobsters, Techmeme and testing sources; document Reddit key and model settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Final check**

Run: `npm test && git status --short`
Expected: all tests pass. Only pipeline output (`data/`, `site/index.html`, `site/archive/`, `site/feed.json`) may show as modified, and nothing under `config/secrets.local.json` appears (it's ignored). Report to the owner:
- the source verification table (OK/EMPTY/FAIL per source);
- the candidate mix by hint;
- the reminder to create the Reddit key (README "Reddit access").
