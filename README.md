# Daily Feed

A personal, daily-refreshed feed of AI, testing, IT, and IT-humor links
with Vietnamese titles and one-line summaries. Clicking an item expands a
10-20 line Vietnamese detail with a link to the original. Static site on GitHub Pages:
https://hoatruongminhan.github.io/daily-feed/

Design: `docs/superpowers/specs/2026-10-04-daily-feed-design.md`.

## How it works

1. `scripts/fetch.mjs` pulls candidates from Hacker News, GitHub, dev.to,
   Lobsters, and RSS feeds (`config/sources.mjs`), scores hotness, dedups,
   skips anything already seen, and writes `data/candidates.json`.
2. `claude -p "/daily-feed-curate"` (skill in `skills/daily-feed-curate/`,
   permissions scoped to one input and one output file) decides keep/drop, category, clean English title,
   Vietnamese title and summary, and fit score into `data/curated.json`.
   Uses your Claude Code login; no API key.
3. `scripts/merge.mjs` validates the decisions and merges them into
   `data/items.json` (14-day window) and `data/dropped.json` (30-day memory).
4. Detail, in batches of 12 up to 60 items a day (best rank first; see
   `config/feed.mjs`): `scripts/detail-prep.mjs` fetches each item's article
   text (cached in `data/articles/`), `claude -p "/daily-feed-detail"`
   (skill in `skills/daily-feed-detail/`) writes the Vietnamese detail, and
   `scripts/detail-merge.mjs` validates it into `data/items.json`.
5. `scripts/build.mjs` renders `site/` (index, archive pages, feed.json).
6. In scheduled mode the runner commits `data/` and `site/` and pushes;
   `.github/workflows/pages.yml` deploys `site/` to Pages.

## Run locally

```bash
npm test                 # unit tests, no network
npm run feed:stub        # fetch → stub curation → merge → build (no Claude, no commit)
npm run feed             # same but with real Claude curation (no commit); needs the skill symlinks from scripts/install-daily-feed.sh
npm run feed:detail      # only write missing Vietnamese details for items already on the feed (no fetch, no commit)
npm run serve            # http://localhost:8080 (pick another port if 8080 is busy)
```

## Schedule (macOS, opt-in)

```bash
scripts/install-daily-feed.sh
```

Installs LaunchAgent `com.dailyfeed.run`, polling every 15 minutes and
running once per day after 07:00 Asia/Ho_Chi_Minh, **every day including
weekends**. Override with `DAILY_FEED_TZ` / `DAILY_FEED_TIME` before
installing. The Mac must be awake for the run to happen; a missed day
runs at the next poll once the Mac is awake. Logs:
`~/Library/Logs/daily-feed.log`.

Uninstall:

```bash
launchctl bootout "gui/$(id -u)/com.dailyfeed.run"
rm ~/Library/LaunchAgents/com.dailyfeed.run.plist
```

## Editing sources

Edit `config/sources.mjs`. Each source needs a unique `id`, a `family`
(`hn`, `reddit`, `github`, `devto`, `rss`), a `categoryHint`
(`ai`, `testing`, `it`, `humor`), and `p90` (what "very hot" looks like
there). Low-volume sources can set `maxAgeHours` above the default 72.
`disabled: '<reason>'` keeps an entry but skips it. A failing source is
skipped, never fatal.

**Reddit** entries ship disabled: on this network the ISP DNS resolves
`reddit.com` to `127.0.0.1`. If you switch the Mac's DNS to a public
resolver (System Settings → Network → DNS, e.g. `1.1.1.1`), remove the
`disabled` field to get r/ProgrammerHumor memes and the AI subreddits.

## Rules

See `CLAUDE.md`. Short version: scripts do the deterministic work, Claude
only curates, the runner is the only committer, fetched text is untrusted.
