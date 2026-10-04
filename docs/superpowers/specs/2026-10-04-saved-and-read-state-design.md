# Saved items and read state (browser-only)

Date: 2026-10-04. Status: approved in chat.

## Goal

1. Save an item to read later, from a bookmark button on every card.
2. Items already read stop appearing on Home, so Home fills with unread
   items, including older ones, instead of repeating what was read.
3. No accounts and no backend: state lives in the reader's browser.

Audience: the owner, a single reader, on one or more browsers.

Success: opening Home shows only unread items (newest day first), saved
items are reachable from a "Saved" pill even after they leave
`items.json`, export/import moves state between browsers, the page
behaves exactly as today when storage or JS is unavailable, and
`npm test` passes offline.

Out of scope: accounts, server sync, likes that influence curation,
"mark all as read", unread counts per pill.

## 1. Stored state

One `localStorage` key, `dailyfeed:v1`:

```json
{ "v": 1,
  "read":  { "<itemId>": { "state": "opened", "at": 1759550000000 } },
  "saved": { "<itemId>": { "savedAt": 1759550000000, "item": { } } } }
```

- `read[id].state` is `"opened"` or `"seen"`; `at` is epoch ms of the
  first time that state was reached.
- `saved[id].item` is a snapshot: `id`, `url`, `title`, `titleVi`,
  `summary`, `detail`, `category`, `sourceName`, `tags`, `addedAt`. The
  snapshot keeps a saved item viewable after `retentionDays` removes it
  from `items.json`.
- On every load, `read` entries with `at` older than 30 days are pruned
  (items expire at 14 days, so these can never be shown again). `saved`
  is never pruned automatically.
- An id is valid only if it matches `^[0-9a-f]{40}$`.

## 2. Read rules

- **Opened**: the reader expands the card's detail (`<details>` toggle
  to open) or clicks any link in the card (title, "Đọc bài gốc",
  discussion, image, extra links). Recorded immediately.
- **Seen**: at least 60% of the card (or 60% of the viewport, for cards
  taller than it) is visible continuously for 2 seconds while
  `document.visibilityState === 'visible'`. Recorded once, at the first
  occurrence.
- `opened` always wins: `markSeen` never downgrades an `opened` entry,
  and `markOpened` upgrades a `seen` entry (setting `at` to now).
- **Hidden on Home**: `opened`, or `seen` with `now - at >= 24h`.
- Hiding is evaluated **only on page load**. Cards never disappear while
  the page is open.
- Saving does not change read state: a saved card stays on Home (with a
  filled bookmark) until the read rules hide it.
- Rules apply to Home, including "Hot now"; the section disappears if all
  its cards are hidden. Archive pages show every card and add
  `card--read` (dimmed, small "đã đọc" marker) to read ones.

## 3. User interface

**Card**: a bookmark `<button class="card__save">` in the meta row,
☆ unsaved / ★ saved, `aria-pressed`, `title="Lưu"` / `"Bỏ lưu"`, tap
target at least 32px. Toggling takes effect immediately, no
confirmation.

**Filter row**: `All · AI · Testing · IT · Humor · Saved (n)`.

- Saved shows saved items newest `savedAt` first and hides "Hot now",
  date dividers, the feed, paging and the hidden-count line.
- Category pills still filter within Saved (Saved + AI = saved AI items).
- Hash `#saved` selects it, like the existing `#ai` etc.
- Empty state: "Chưa có bài đã lưu".
- A saved card whose item is on the current page reuses (clones) that
  DOM card; otherwise it is built from the snapshot (section 4).

**Home feed**:

- Unread cards grouped by date, newest date first, rank order within a
  date (as today). The first `homePageSize` (40) unread cards are shown;
  a "Xem thêm" button shows the next 40.
- A date divider is hidden when it has no visible cards.
- Bottom line: "N bài đã đọc đang ẩn · Hiện". "Hiện" shows hidden cards,
  dimmed, for this visit only; stored state is unchanged.
- All read: "Bạn đã đọc hết. Xem lưu trữ bên dưới."

**Footer**, "Dữ liệu trên trình duyệt này":

- **Xuất**: downloads `daily-feed-<YYYY-MM-DD>.json` containing the whole
  state object.
- **Nhập**: file picker. The file is merged, never replacing:
  saved = union (on conflict keep the later `savedAt`); read = per id,
  `opened` beats `seen`, and between equal states the earlier `at` wins.
  Result message: "Đã nhập: X lưu, Y đã đọc".
- Rejected (message shown, stored state untouched): not JSON, `v !== 1`,
  file larger than 5 MB. Malformed entries inside a valid file are
  skipped and counted in the message ("bỏ qua Z mục lỗi").

## 4. Code layout

**`site/assets/state.js`** (new, hand-written, ESM, no DOM, no storage
access; importable from Node because `package.json` has
`"type": "module"`):

- `parseState(raw)` → valid v1 state; empty state on any invalid input.
- `prune(state, now)`.
- `markOpened(state, id, now)`, `markSeen(state, id, now)`.
- `isHiddenOnHome(state, id, now)`.
- `save(state, snapshot, now)`, `unsave(state, id)`.
- `sanitizeSnapshot(obj)` → snapshot or `null`: id format, strings only,
  length caps (title/titleVi/summary 500, detail 8000, tags 10 × 40),
  `url` must be `http:`/`https:`.
- `mergeImport(state, imported)` → `{ state, saved, read, skipped }`.

Functions return new state objects; `now` is always passed in.

**`site/assets/app.js`** (new, ESM, DOM wiring, imports `state.js`):

- Load: read the key with try/catch → `parseState` → `prune` → write back.
  If the raw value was present but invalid, copy it to
  `dailyfeed:v1:corrupt` first.
- Writes: try/catch; on failure keep state in memory and show the footer
  notice "Không lưu được trên trình duyệt này".
- Applies Home hiding, paging, the hidden-count toggle, archive dimming.
- IntersectionObserver for seen; `toggle` and link `click` listeners for
  opened.
- Bookmark buttons, the Saved view, export/import.
- Takes over the category filter from the current inline script, since
  Saved and the categories combine.
- Snapshot from a DOM card: `data-*` attributes plus `textContent` of
  `.card__title`, `.card__orig`, `.card__summary`, `.card__detail`
  (paragraphs joined by blank lines, the source line excluded), `.tag`.
- Snapshot cards are built with `createElement` and `textContent` only;
  `href` is set only after an `http:`/`https:` check. Nothing from storage
  or an imported file ever goes through `innerHTML`.

**`lib/render.mjs`**:

- `<article>` gains `data-id`, `data-url` (after `safeUrl`, empty if
  unsafe), `data-category`, `data-added`, all escaped.
- The bookmark button in `.card__meta`.
- The Saved pill; `#feed` gets `data-page-size`; placeholders for the
  "Xem thêm" button, hidden-count line and empty states; footer
  export/import controls with a hidden `<input type="file"
  accept="application/json">`.
- The inline `<script>` is replaced by
  `<script type="module" src="${basePath}assets/app.js"></script>`.

**`config/feed.mjs`**: `feedDays: 2` is replaced by `hotNowDays: 2`
("Hot now" picks from the last 2 days, unchanged freshness),
`homeDays: 7` (Home feed renders items added in the last 7 days) and
`homePageSize: 40`.

**`scripts/build.mjs`**: "Hot now" from `hotNowDays`, feed from
`homeDays` minus hot ids; passes `homePageSize` to `renderPage`.
Expected Home size: about 2 MB raw, about 0.5 MB gzipped.

**Docs**: CLAUDE.md architecture gains a "client state" paragraph
(`site/assets/state.js` and `app.js` are hand-written source, not build
output; state is per browser). README gains "Saved and read state":
per-browser, how export/import works.

## 5. Error handling

| Case | Behaviour |
|---|---|
| `localStorage` throws (private mode, blocked) | in-memory state for the visit, footer notice, page otherwise as today |
| Stored value corrupt | raw value copied to `dailyfeed:v1:corrupt`, start from empty state |
| Quota exceeded on write | in-memory state, footer notice |
| Import invalid / too large | message, state untouched |
| Import has some bad entries | valid ones merged, bad ones counted |
| JS disabled | every rendered card shown, bookmark and pills inert |

## 6. Testing

Offline, `node --test`:

- `tests/state.test.mjs`: `parseState` fallbacks (garbage, wrong `v`,
  bad ids); seen hides only after 24h; opened hides on next load; opened
  never downgraded; prune at 30 days keeps saved; save/unsave; merge
  rules (union, later `savedAt`, opened beats seen, earlier `at`);
  `sanitizeSnapshot` rejects `javascript:` URLs, bad ids, non-strings,
  over-long strings.
- `tests/render.test.mjs`: card data attributes escaped (`"` and `<` in
  values), `data-url` empty for unsafe URLs, bookmark button present,
  Saved pill present, module script path correct for index (`assets/`)
  and archive (`../assets/`), no inline filter script left.
- Build/smoke test: Home includes items up to `homeDays` old and
  excludes older; "Hot now" only from `hotNowDays`.

Manual check in a browser with `npm run serve`: opened hides after
reload; seen hides after 24h (shift time via devtools or edit `at`);
save/unsave; Saved view and Saved + category; snapshot card for an item
not on the page; export then import into a private window; private
window with storage blocked; "Xem thêm" and "Hiện". `app.js` DOM wiring
has no automated test (no browser test tooling, no npm deps); accepted.
