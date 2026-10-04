# Writing rules, grounding check, and independent-source buzz

Date: 2026-10-04. Status: approved in chat. Inspired by
[AIHOT](https://github.com/KKKKhazix/AIHOT) (`industry/prompts/rules-*.md`,
`docs/selection.md`, `packages/backend/src/events/hot.ts`).

## Goal

1. Vietnamese summaries and details lead with the answer, never invent
   names or numbers, and titles name their subject.
2. A scripted check rejects details that mention several names or numbers
   absent from the source text.
3. A story discussed by several independent sources ranks higher, and a
   story we already kept is not sent to Claude again when a new source
   picks it up.

Success: `npm test` passes offline; on the current data the grounding
check flags roughly 10–15% of details and rejects only those with two or
more misses; duplicate stories across sources appear once, with every
source listed.

## 1. Writing rules (skills only)

Add a "Writing rules" section to `skills/daily-feed-curate/SKILL.md` and
`skills/daily-feed-detail/SKILL.md`:

- **Answer first.** The first sentence says who did what and what changed
  or resulted. No opener such as "Bài viết nói về…", "Tác giả cho
  rằng…", "Theo bài viết…". Then at most the one or two most important
  points: verifiable fact or number first, then impact. The detail opens
  with the same kind of answer sentence.
- **No invented facts.** Every product, feature, company name, number,
  and version must appear in the input. Relative times stay relative; no
  year unless the source states it. Do not strengthen claims ("đang thử
  nghiệm" is not "đã áp dụng") and keep exclusive words (first, only,
  fully, độc lập) only when the source says them. Do not expand an
  acronym the source does not expand. Thin source → shorter text.
- **Self-contained title.** If the original title is a teaser or a bare
  version ("v2.1.159", "Day 1"), add the subject from the source name or
  body; never invent a model or version. Keep the article type: a
  How/Why/Guide/Review/Benchmark title never becomes "ra mắt / phát
  hành / công bố".

The detail skill also states that a script checks names and numbers
against the source and rejects a detail with two or more unsupported ones.
The decision schema does not change.

## 2. Grounding check (`lib/detail.mjs`)

`ungroundedTokens(text, sourceText)` returns the claims in `text` not found
in `sourceText`:

- **Names**: split on whitespace and `/`, strip backticks/asterisks and
  leading/trailing non-alphanumerics. A token counts when it is printable
  ASCII with a letter and either has an uppercase letter after the first
  character, contains a digit, or is a capitalised word of six or more
  letters (`Kubernetes` yes, `Trung` no). Hyphen/dot alone does not make a
  token count (`hard-code` no, `GPT-5.5` yes). Tokens in `PLAIN_TERMS`
  (lowercase allowlist: ai, api, llm, qa, usd, macos, readme, …) are
  skipped. Match: case-insensitive substring of the source.
- **Numbers**: `\d+([.,]\d+)+` or `\d{3,}`; separators removed on both
  sides before a substring match, so `78,1` ≈ `78.1` and `10.000` ≈
  `10,000`.
- Duplicates reported once. A token checked as a name covers its own
  digits (`GPT-5.5` is one miss, not `GPT-5.5` + `55`).
- When at least 20% of the source's letters are Chinese, Japanese, or
  Korean, names are not checked (they get translated: 微信 → WeChat);
  numbers always are. Added after measuring: all three rejects on the
  first 55 real details were correct translations from Chinese sources.

`parseDetail(raw, sourceText)`: when `sourceText` is given and
`ungroundedTokens` returns more than `DETAIL_UNGROUNDED_MAX` (= 1), add the
error `ungrounded: a | b | …` (first 8). The detail body and title are both
checked. Without `sourceText` behaviour is unchanged.

`scripts/detail-merge.mjs` builds the source text (`sourceTextFor`) from
`data/articles/<id>.txt` (missing → empty), `title`, `sourceTitle`,
`excerpt`, `sourceName`, `url`. The curated `summary` is left out: it is
model output, so a name invented there must not count as grounded. It logs a single miss as a note;
counts rejected ones under `status.detail.counts.ungrounded`. A rejected
item keeps today's `detailTriedAt`, so `selectForDetail` retries it on a
later day as it already does.

## 3. Independent-source buzz

**Shape.** Candidates and items gain `sources: string[]` (distinct
`sourceName`s, first is the primary). Items gain `sourceTitle` (the raw
title before curation). Old items without these fields are read as
`[sourceName]` and `title` via a helper `sourcesOf(item)`.

**Dedup** (`lib/dedup.mjs`). `makeCandidate` sets `sources:
[sourceName]`. `absorb` also unions `sources`.

**Sightings** (`lib/collect.mjs`). `collect` takes `knownItems` (from
`items.json`) besides `knownIds`. After age filter and hotness, each fresh
candidate is checked in this order (kept items = those inside
`retentionDays`, `retainedItems` in `lib/merge.mjs`, so a story is never
matched to an item the same merge prunes): id of a kept item, or title Jaccard
≥ 0.8 against a kept item's `title` or `sourceTitle` → a sighting
`{ itemId, sourceName, link }` (`link` = discussionUrl ?? url), not a
candidate; id in `dropped.json` → discarded as today. Remaining candidates
go through `dedupeCandidates` as before. `collect` returns `sightings`.

**Fetch** writes `data/sightings.json` `{ generatedAt, sightings }`.

**Merge** (`lib/merge.mjs`, `applySightings`). Runs inside `mergeRun`
regardless of whether `curated.json` is stale, but only when
`sightings.generatedAt` is today in the feed timezone. For each sighting
of an existing item: add `sourceName` to `sources` and `link` to
`extraLinks` when new, then recompute `rank`. `scripts/merge.mjs` deletes
`sightings.json` after a merge. New items store `sourceTitle`.

**Score** (`lib/score.mjs`). `buzz(n, cfg) = 1 + cfg.buzzPerSource ×
min(n − 1, cfg.buzzMaxExtra)`; `config/feed.mjs` adds `buzzPerSource:
0.25`, `buzzMaxExtra: 3`. `rank = hotness × buzz × fit / 5`, computed by
one helper used by merge and sightings. `hotness` keeps its meaning.

**Render.** With two or more sources, the meta line shows them joined by
" · " in place of the single source name, plus `<span class="card__buzz">N
nguồn</span>`; all escaped. Small CSS addition in `site/assets/style.css`.

Re-seen items are not moved to today (owner decision 2026-10-04).

## Errors

- Missing or stale `sightings.json` → no-op, logged.
- A sighting for an id no longer in `items.json` → ignored.
- Grounding check never throws; bad input yields an empty list.

## Tests (offline)

- `detail.test.mjs`: grounded detail passes; one miss passes; two misses
  rejected with the tokens in the error; number separators; Vietnamese
  capitalised syllables and hyphenated words ignored; no sourceText →
  old behaviour.
- `dedup.test.mjs`: absorb unions `sources`.
- `collect.test.mjs`: known id → sighting; title match vs `sourceTitle` →
  sighting; dropped id → discarded.
- `merge.test.mjs`: sightings applied, deduped, stale ignored, rank uses
  capped buzz; new items carry `sourceTitle`.
- `score.test.mjs`: `buzz` values and cap.
- `render.test.mjs`: multi-source line escaped, single source unchanged.

## Out of scope

Resurfacing old items, double scoring, a fit rubric, calibration sets.
