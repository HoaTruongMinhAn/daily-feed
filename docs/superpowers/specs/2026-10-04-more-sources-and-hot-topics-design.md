# More community sources, topic quotas, and hot topics

Date: 2026-10-04. Status: approved in chat, section by section.

## Goal

The feed has too few items, too little testing/QA and humor, and no room
for tech stories that fit none of the fixed categories. Owner answers:

- "Poor" means too few topics and items, especially testing and humor.
  The curator may expand topics a little to cover what is very hot on the
  internet, limited to **tech-adjacent** stories (launches, outages,
  security incidents, business of tech, science, gadgets, dev drama; no
  politics, celebrity, or sports).
- Sources: **Reddit** (with a free app key) and **Mastodon/Bluesky**
  without login. **No Facebook or X**: Facebook has no groups API and
  scraping it needs a logged-in account and breaks its terms; X reads
  need a paid API tier. Both rejected by the owner.
- **Do not change the Mac's DNS**: it is a work machine. Only the
  pipeline's Reddit requests use a public resolver.
- **Hotness comes from platform numbers** (upvotes, points, stars,
  boosts, comments), never from Claude's guess.
- Token use is set explicitly per skill: curate on Sonnet 5.5 at medium
  effort, detail on Sonnet 5.5 at low effort.

Facts checked on 2026-10-04 from this network: the ISP DNS answers
`127.0.0.1` for reddit.com, while 1.1.1.1 returns the real Fastly
addresses; connecting to those addresses works and Reddit answers 403 to
anonymous requests. Mastodon tag timelines and `trends/links` work
without login. Bluesky `getFeed` works without login; `searchPosts`
returns 403. Techmeme RSS and Lobsters JSON (`/t/<tag>.json`, with
`score` and `comment_count`) work. Medium timed out.

Success:

- `npm test` passes offline, with new tests for everything below.
- A real `npm run fetch` reaches ~200 candidates, with at least 40
  testing and 20 humor candidates on a normal day once Reddit has a key.
- `npm run feed:stub` renders a "Hot trên mạng" section.
- No secret appears in logs, `data/`, `site/`, or git.

## 1. Sources and adapters

### Reddit (existing adapter, OAuth and per-request resolver)

- `config/secrets.local.json` (gitignored, never read by Claude):
  `{ "reddit": { "clientId": "...", "clientSecret": "...", "userAgent": "daily-feed/1.0 by <username>" } }`.
  Loaded by `lib/secrets.mjs`; a missing file returns `{}`.
- With a key, `lib/sources/reddit.mjs` gets an app-only token once per
  run (`POST https://www.reddit.com/api/v1/access_token`,
  `grant_type=client_credentials`, HTTP Basic auth) and reads
  `https://oauth.reddit.com/r/<sub>/top?t=<t>&limit=40`. The token is
  cached in memory for the run only. Without a key, it uses today's
  anonymous `.json` URL.
- Reddit sources carry `resolver: ['1.1.1.1', '8.8.8.8']`. The adapter
  then makes its requests with `node:https` and a `lookup` function
  built on `node:dns` `Resolver#setServers`. Only these requests use
  the public resolver; the system DNS is untouched. If the resolver
  fails, fall back to the normal lookup.
- Error text never includes the client secret or the token.
- Engagement becomes `score + 2 * num_comments`.
- `REDDIT_BLOCKED` is removed. Subreddits:
  - existing: r/artificial, r/LocalLLaMA, r/ClaudeAI, r/QualityAssurance,
    r/softwaretesting, r/programming, r/ProgrammerHumor;
  - testing: r/Playwright, r/selenium, r/devops, r/ExperiencedDevs;
  - humor: r/programmingmemes, r/techhumor, r/sysadmin (`isMeme` only on
    the meme subs);
  - hot: r/technology (`categoryHint: 'hot'`); AI: r/OpenAI,
    r/singularity.

### Mastodon (new family `mastodon`, no login)

- `lib/sources/mastodon.mjs`, two modes by source field:
  - `tag`: `GET https://<instance>/api/v1/timelines/tag/<tag>?limit=40`.
    A post with a `card.url` becomes a candidate for that URL, with the
    toot URL as `discussionUrl` and `card.title` as the title. A post
    without a card uses the toot URL and the first line of its text with
    the HTML stripped. Posts with neither a title nor a usable text line
    are skipped. Engagement = `reblogs_count + favourites_count +
    2 * replies_count`.
  - `trendsLinks`: `GET https://<instance>/api/v1/trends/links?limit=40`.
    Engagement = sum of `history[].accounts`. `categoryHint: 'hot'`.
- Sources: hachyderm.io and fosstodon.org tags #softwaretesting,
  #testautomation, #playwright, #qa, #llm, #programminghumor, #devhumor;
  hachyderm.io `trendsLinks`. `perSourceCap: 15` each.

### Bluesky (new family `bluesky`, no login)

- `lib/sources/bluesky.mjs`:
  `GET https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=<at-uri>&limit=50`.
  A post with an `embed.external` becomes a candidate for that link, with
  the post as `discussionUrl`. Otherwise the post URL
  (`https://bsky.app/profile/<handle>/post/<rkey>`) and the first line of
  its text. Engagement = `repostCount + likeCount + 2 * replyCount`.
- Feed URIs (tech, AI, testing, dev humor) are chosen during
  implementation and kept only if they return posts. `perSourceCap: 15`.

### Lobsters (RSS → JSON)

- New family `lobsters` (`lib/sources/lobsters.mjs`) reading
  `https://lobste.rs/t/<tag>.json`. Engagement = `score + 2 *
  comment_count`; `discussionUrl` = `comments_url`. The existing ai and
  testing entries move to it; add programming, security, devops,
  practices.

### More RSS

- Techmeme (`https://www.techmeme.com/feed.xml`, `categoryHint: 'hot'`,
  `editorialHot: true`, see section 3).
- Testing: Ministry of Testing, testing YouTube channel RSS
  (`https://www.youtube.com/feeds/videos.xml?channel_id=...`), other
  testing blogs. Humor: more dev comics.
- Every new URL is checked live before it is added to
  `config/sources.mjs`. Unreachable URLs are left out, not added
  disabled.

### Engagement for existing adapters

- HN: `points + 2 * num_comments`. dev.to: `positive_reactions_count +
  2 * comments_count`. GitHub unchanged (stars on recently created
  repos). RSS unchanged (`engagement: 1`, no signal).
- `p90` values in `config/sources.mjs` are raised to match the new
  formula (roughly x1.5 for HN, Reddit, dev.to), then checked against one
  real fetch.

## 2. Volume and quotas

- `config/feed.mjs`:
  ```js
  maxCandidates: 200,
  candidateQuota: { ai: 50, testing: 50, it: 35, humor: 30, hot: 35 }, // sums to maxCandidates
  detailMaxPerDay: 200,
  ```
  A source may set its own `perSourceCap` (default stays 25).
- `selectByQuota(candidates, quota, max)` in `lib/collect.mjs`, pure:
  1. group by `categoryHint` (an unknown hint counts as `it`);
  2. in each group take the hottest, up to that group's quota;
  3. fill any remaining slots up to `max` with the hottest leftovers from
     any group;
  4. return them sorted by hotness.
- Order in `collect()`: fetch → age filter → hotness → per-source cap →
  `splitSightings` → `filterKnown` → `dedupeCandidates` → `markHot`
  (section 3) → `selectByQuota`. Only the last step changes how the cap
  is applied (today it is `.slice(0, maxCandidates)`).
- Curation stays one `claude -p` call. If a real 200-candidate run turns
  out too long, splitting into two passes is a follow-up. It is not built
  now.

## 3. Hot topics (`hot-*` categories)

### Eligibility (scripted)

`markHot(candidates, sourcesById)` in `lib/score.mjs` sets
`hotEligible: true` when any of these holds:

- the candidate has 2+ independent sources (`sourcesOf(c).length >= 2`);
- one of its sources has `editorialHot: true` (Techmeme);
- its hotness is in the top 25% of the candidates that have a measured
  signal. Measured means at least one of its sources is a family other
  than `rss`. RSS-only candidates are not counted when computing the
  75th-percentile threshold, and cannot qualify through it, because
  their hotness is a constant 1.0 by design. They can still qualify
  through the first two rules.

All other candidates get `hotEligible: false`.

### Decision schema

Kept in sync between `skills/daily-feed-curate/SKILL.md` and
`lib/merge.mjs`:

- `category`: one of `CATEGORIES` (unchanged) **or** matches
  `HOT_CATEGORY = /^hot-[a-z0-9]+(-[a-z0-9]+){0,2}$/`, at most 24
  characters.
- `categoryLabelVi`: required for `hot-*` (trimmed, 1–24 characters, no
  newline). It must be absent for core categories.
- `validateDecision(d, candidateIds, hotEligibleIds = new Set())` gets a
  third argument, built by merge from candidates with `hotEligible:
  true`. It rejects a `hot-*` decision (`'not hot-eligible'`) whose id is
  not in that set. Existing callers keep working.
- Merge stores `categoryLabel` on kept `hot-*` items.

### Topics stay stable

- Fetch writes `hotCategories: [{ slug, label, count }]` into
  `data/candidates.json`, taken from `hot-*` items in `items.json` over
  `retentionDays`.
- SKILL.md tells Claude to:
  - use `hot-*` only for a `hotEligible` candidate that is tech-adjacent
    and fits no core category; a hot AI or testing story keeps its
    `ai-*`/`test-*` category;
  - reuse an existing slug and label when one fits, and coin a new slug
    only for a distinct topic;
  - keep slugs short and in English, and labels in Vietnamese;
  - drop politics, celebrity, sports, and general news not about
    technology.

### Rendering

- `lib/render.mjs`: `groupOf` returns `'hot'` for `hot-*`.
  `GROUP_LABEL` gains `hot: 'Hot trên mạng'` (new filter pill). Chip text
  is `escapeHtml(item.categoryLabel ?? CATEGORY_LABEL[cat] ?? cat)`.
  Cards carry `data-category-label` (escaped).
- `site/assets/app.js`: `snapshotFromCard` and `buildCard` carry
  `categoryLabel`, so a saved `hot-*` card shows its label in the Saved
  view. Read counts per group already key on the group.
- `site/assets/style.css`: `.chip--hot` and the pill colour, in both
  themes.
- The "Hot now" strip is unchanged.

### Stub curation

`scripts/stub-curate.mjs` maps hint `hot` to `hot-general` with
`categoryLabelVi: 'Tin nóng'` when the candidate is `hotEligible`, and to
`it-general` otherwise.

## 4. Model and effort per skill

- `scripts/daily-feed-run.sh` passes `--model`, `--effort`, and
  `--fallback-model` to both `claude -p` calls:

  | Step   | Env override                                           | Default                       |
  |--------|--------------------------------------------------------|-------------------------------|
  | curate | `DAILY_FEED_CURATE_MODEL`, `DAILY_FEED_CURATE_EFFORT`  | `claude-sonnet-5-5`, `medium` |
  | detail | `DAILY_FEED_DETAIL_MODEL`, `DAILY_FEED_DETAIL_EFFORT`  | `claude-sonnet-5-5`, `low`    |
  | both   | `DAILY_FEED_FALLBACK_MODEL`                            | `claude-haiku-4-5-20251001`   |

- Each SKILL.md gets a "Runs on" line naming its defaults and saying the
  runner sets them. The setting is not put in skill frontmatter, because
  support for that could not be verified on claude 2.1.237.
- If the CLI rejects a flag, the step fails and records it in
  `status.json`. It never silently runs on a different model.

## 5. Error handling

- Per-source failure rules are unchanged: log, add to `failedSources`,
  continue. Only "all sources failed" exits non-zero.
- Reddit: no key means anonymous requests, which today fail with 403 as
  normal failures. A token failure fails every Reddit source with one
  message that contains no secret. If the resolver is unreachable, fall
  back to system DNS.
- Mastodon/Bluesky: a 429 or 5xx is a source failure, with no retry
  loop. Malformed posts are skipped.
- All new post text is untrusted. It is escaped when rendered, validated
  before merging, and never treated as instructions.
- An invalid `hot-*` decision counts as invalid and therefore dropped,
  and is reported in merge's status counts.

## 6. Testing (offline, `tests/fixtures/`)

- Adapters: `mastodon` (tag and trendsLinks), `bluesky`, `lobsters`, and
  `reddit` OAuth with a fake token endpoint. Also a test that the secret
  is absent from error messages, and that the Reddit `lookup` is wired
  through an injected fake resolver.
- New engagement formulas for HN, Reddit, and dev.to.
- `selectByQuota`: respects quotas, refills spare slots, never exceeds
  `max`, treats an unknown hint as `it`.
- `markHot`: the 2+ sources rule, the `editorialHot` rule, the top 25%
  of measured candidates, and RSS-only candidates kept out of the
  percentile.
- `validateDecision`: slug format and length, label required for `hot-*`
  and absent for core categories, rejection when not eligible.
- Render: the hot pill and chip, label escaping, `data-category-label`.
  `state.test.mjs` / app snapshot: the label survives save and restore.
- Runner: the assembled `claude -p` commands contain the model, effort,
  and fallback flags, and env overrides win.
- `npm run feed:stub` end to end, then one live `npm run fetch` before
  the source config is committed.

## Files touched

`config/sources.mjs`, `config/feed.mjs`, `.gitignore`
(`config/secrets.local.json`), `lib/secrets.mjs` (new),
`lib/sources/{reddit,hn,devto,index}.mjs`,
`lib/sources/{mastodon,bluesky,lobsters}.mjs` (new), `lib/collect.mjs`,
`lib/score.mjs`, `lib/merge.mjs`, `lib/render.mjs`, `site/assets/app.js`,
`site/assets/style.css`, `scripts/fetch.mjs` (`hotCategories`),
`scripts/stub-curate.mjs`, `scripts/daily-feed-run.sh`,
`skills/daily-feed-curate/SKILL.md`, `skills/daily-feed-detail/SKILL.md`,
`tests/*` and fixtures, `README.md` (Reddit key setup), `CLAUDE.md`
(category change now also covers the `hot-*` rule; new families).

## Owner setup (after implementation)

1. At https://www.reddit.com/prefs/apps, create a "script" app. Copy its
   client id and secret into `config/secrets.local.json`.
2. Nothing else. No DNS or system settings change.
