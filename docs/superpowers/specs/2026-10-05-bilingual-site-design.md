# Bilingual site: Vietnamese and English

Date: 2026-10-05. Status: approved in chat.

## Goal

1. Every item reads fully in Vietnamese or in English: title, summary,
   and the expandable detail.
2. A dropdown in the header switches language instantly, on every page,
   and the choice is remembered in the browser.
3. The default language follows the reader's region, detected in the
   browser: Vietnamese for a Vietnamese browser language or a Vietnam
   time zone, English otherwise.

Audience: the owner (Vietnamese first language) and English-reading
visitors. The site stays static on GitHub Pages with no backend.

Success: a new visitor from Vietnam sees Vietnamese, a visitor from
elsewhere sees English, the dropdown flips every string on the page
without a reload, saved cards and archive pages follow the same
language, the page still works in Vietnamese without JS, and `npm test`
passes offline.

Out of scope: an English version of hot-topic labels in the curation
schema (derived from the slug instead), translating date headings and the
site title (language neutral already), IP-based geolocation, per-language
URLs.

Decisions taken in chat: full English content written by Claude (not
source excerpts), region from browser language plus time zone (no
third-party service), one page with both languages embedded (not two
build trees).

## 1. Item schema and pipeline

Two new optional string fields on an item, flat beside the existing ones:

- `summaryEn`: 1-2 English sentences, max 220 chars, written by the
  curation skill in the same pass as `summary`.
- `detailEn`: the English detail, 200-4000 chars, written by the detail
  skill in the same file as the Vietnamese detail.

Flat fields keep saved snapshots in readers' browsers, `feed.json`, and
items already in `items.json` valid without migration. The English title
is the existing `title`; nothing new is needed for it.

### Curation

`skills/daily-feed-curate/SKILL.md` adds `summaryEn` to the decision
schema with the same rules as `summary`: answer first, only what the input
says, no claim upgrades, no markdown. `validateDecision` in
`lib/merge.mjs` requires `summaryEn` on a kept decision: non-empty string,
max 220 chars. `mergeRun` copies it to the item. `scripts/stub-curate.mjs`
writes `[stub] <excerpt or title>` as `summaryEn`.

### Detail

The per-item output file `data/details/<id>.txt` becomes:

```
<Vietnamese title, one line, max 140 chars>

<Vietnamese detail: paragraphs, "- " lists>

===== EN =====

<English detail: same shape>
```

The marker is exactly `===== EN =====` on its own line (`DETAIL_EN_MARKER`
in `lib/detail.mjs`). `parseDetail`:

- rejects a file with no marker (`no english detail`), so a half-written
  item is retried on a later day like any invalid detail;
- applies `DETAIL_MIN`/`DETAIL_MAX` to each half separately;
- runs `ungroundedTokens` over title + both halves together against the
  same source text, with the existing `DETAIL_UNGROUNDED_MAX` threshold;
- returns `{ titleVi, detail, detailEn, ungrounded, errors }`.

`scripts/detail-merge.mjs` sets `titleVi`, `detail`, and `detailEn`
together. `selectForDetail` treats an item with `detail` but no `detailEn`
as missing, so items already on the feed are re-queued once within the
normal daily budget and get both halves rewritten. `queueFile` is
unchanged. `scripts/stub-detail.mjs` writes both halves.

`skills/daily-feed-detail/SKILL.md` documents the marker, states that the
English detail covers the same points as the Vietnamese one (not a
word-for-word translation, same grounding rules, same length band), and
that both halves are checked by the script.

### Render-time fallbacks

Only items added before this change hit these; they age out after
`retentionDays`.

- No `summaryEn`: the English view shows `excerpt`, or `summary` when
  there is no excerpt.
- No `detailEn` on an item with `detail`: the English view shows the
  Vietnamese detail preceded by a short note, "Detail available in
  Vietnamese only."

## 2. Rendering and the browser

### Shared strings

New `site/assets/strings.js`: a plain ESM module with no DOM access,
imported by `lib/render.mjs` at build time and by `site/assets/app.js` in
the browser (the same pattern as `state.js`). It exports:

- `STRINGS`: every UI string keyed by name, each `{ vi, en }`: filter
  pills, "Saved", "Hot now", "Archive", "Show more", the read-hidden
  notice, "You have read everything", "No saved items", "Read the
  original", "N sources", "Save"/"Saved"/"Unsave", "Export"/"Import",
  storage and import error messages, the "Vietnamese only" note, and the
  curation-failed notice.
- `GROUP_LABEL`: `{ ai, testing, it, humor, hot }` each `{ vi, en }`
  (moves out of `lib/render.mjs`; `CATEGORY_LABEL` stays English-only
  since those labels are already English terms in both views).
- `hotLabelEn(category)`: `hot-cloud-outage` becomes `Cloud outage`
  (strip `hot-`, replace `-` with space, capitalise the first letter).
- `LANGS = ['vi', 'en']`.

### Static markup

A bilingual text renders as a pair:

```html
<span class="l l-vi" lang="vi">…</span><span class="l l-en" lang="en">…</span>
```

A helper `pair(vi, en)` in `lib/render.mjs` produces it, escaping both.
`renderCard` uses pairs for: the card title (Vietnamese side shows
`titleVi` with the English original beneath, English side shows `title`
alone), the summary, the detail body (each side through `renderDetail`),
the "read the original" link text, the source count, the chip label for
hot categories (`categoryLabel` vs `hotLabelEn`), and the save button's
visible text. Buttons keep a single `aria-label` and `title`, set by JS,
with the Vietnamese value in the markup as the no-JS default.

`renderPage` uses pairs for filter pills, section headings, the feed
tools, the saved section, the footer, and the notice. The `<html>`
element keeps `lang="vi"`. The header gets:

```html
<select id="lang" class="lang" aria-label="Language">
  <option value="vi">Tiếng Việt</option>
  <option value="en">English</option>
</select>
```

`<head>` loads `<script src="…assets/lang.js"></script>` synchronously
before the stylesheet so the attribute is set before first paint. CSP is
unchanged: the file is same-origin.

### Language resolution

`site/assets/lang.js` is a classic (non-module) script with two parts:

1. A pure function `detectLang(languages, timeZone, stored)` that returns
   `'vi'` or `'en'`: `stored` wins when it is one of `LANGS`; otherwise
   `'vi'` when any entry of `languages` starts with `vi` (case
   insensitive) or `timeZone` is `Asia/Ho_Chi_Minh` or `Asia/Saigon`;
   otherwise `'en'`. It is attached to `window.DailyFeedLang` for `app.js`;
   `tests/lang.test.mjs` runs the file with `node:vm` against a fake
   document, which also covers the on-load wiring.
2. On load: read `localStorage` key `dailyfeed:lang` (try/catch), call
   `detectLang(navigator.languages, Intl.DateTimeFormat().resolvedOptions().timeZone, stored)`,
   and set `document.documentElement.dataset.lang` and `lang`.

CSS in `style.css`: `html[data-lang="vi"] .l-en, html[data-lang="en"] .l-vi { display: none }`
and `html:not([data-lang]) .l-en { display: none }`, so a page without JS
shows Vietnamese.

### Switching

`app.js` on load sets the dropdown to the current language. On `change`:
set `data-lang` and `lang` on the root, write `dailyfeed:lang` (try/catch,
failure ignored), and call `applyDynamicStrings()`, which refreshes the
texts JS sets directly: save button `aria-label`/`title`, the saved count,
and the current status message if one is showing. Everything else is pure
CSS. The language key is separate from `dailyfeed:v1`, so export/import
of saved state is unaffected.

### Saved cards

`buildCard` in `app.js` builds the same pair markup as `renderCard`,
including the English fallbacks. The detail body renders as two blocks, `.card__detail.l-vi` and
`.card__detail.l-en`, each through `renderDetail`, so the existing
`detailText` reconstruction in `app.js` takes the block to read and
`snapshotFromCard` captures `detail` and `detailEn` from them and
`summaryEn` from the English summary span. A fallback block (excerpt or
Vietnamese-only note) is marked `data-fallback` and is not captured as
`summaryEn`/`detailEn`.
`state.js` `LIMITS` gains `summaryEn: 500` and `detailEn: 8000`;
`sanitizeSnapshot` treats them like the other optional text fields, so
old snapshots stay valid.

## 3. Testing

All offline, under `tests/`:

- `merge.test.mjs`: kept decision without `summaryEn` or over 220 chars is
  invalid; a valid one lands on the item.
- `detail.test.mjs`: `parseDetail` returns both halves; rejects no marker;
  rejects an English half outside the length band; rejects when the
  English half adds ungrounded names; `selectForDetail` picks an item with
  `detail` but no `detailEn`.
- `render.test.mjs`: card has both language spans for title and summary;
  English fallback to excerpt; "Vietnamese only" note when `detailEn` is
  missing; dropdown and `lang.js` tag present; `hotLabelEn` derivation;
  no inline script or `on*=` attributes (existing CSP check still passes).
- `state.test.mjs`: snapshot with the new fields round-trips; a snapshot
  without them is accepted; `groupOf` still matches `lib/render.mjs`.
- New `lang.test.mjs`: `detectLang` with a stored value, a Vietnamese
  browser language, a Vietnam time zone, an invalid stored value, and the
  English default.
- `stub-curate.test.mjs`: stub decisions pass `validateDecision`; the
  stub detail output passes `parseDetail`.

## 4. Documentation

- `CLAUDE.md`: list `summaryEn`/`detailEn`, the detail marker, and
  `site/assets/strings.js` and `lang.js` as hand-written source that
  `render.mjs` and `app.js` share.
- Both skill docs: the English rules above.
- `README.md`: one line on the language dropdown and region default.

The runner `scripts/daily-feed-run.sh` does not change: the detail loop
already re-queues whatever `selectForDetail` returns.
