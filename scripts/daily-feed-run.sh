#!/usr/bin/env bash
# Daily Feed runner. Scheduled mode (no flags): called every 15 min by the
# LaunchAgent, runs after DAILY_FEED_TIME in DAILY_FEED_TZ, EVERY day
# including Saturday and Sunday (owner decision, 2026-10-04), then commits
# and pushes. A failed run (curate, push, or any hard error) is retried on
# the next poll, up to DAILY_FEED_MAX_ATTEMPTS a day; after one success the
# rest of the day's polls do nothing. `--now` runs immediately without
# the schedule check and without committing. `--stub` replaces the Claude
# curation and detail steps with scripts/stub-curate.mjs and
# scripts/stub-detail.mjs (offline preview). `--detail-only` (with --now)
# skips fetch/curate/merge and only writes missing Vietnamese details for
# the items already on the feed, then rebuilds.
set -euo pipefail

ROOT="${DAILY_FEED_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TZN="${DAILY_FEED_TZ:-Asia/Ho_Chi_Minh}"
TARGET_TIME="${DAILY_FEED_TIME:-07:00}"
# Model and effort per Claude step (spec 2026-10-04-more-sources-and-hot-topics).
# Curation judges ~200 items: Sonnet at medium effort. Details mostly
# summarise fetched text and are checked by parseDetail: Sonnet at low.
# Haiku takes over only when the main model is overloaded.
CURATE_MODEL="${DAILY_FEED_CURATE_MODEL:-claude-sonnet-5-5}"
CURATE_EFFORT="${DAILY_FEED_CURATE_EFFORT:-medium}"
DETAIL_MODEL="${DAILY_FEED_DETAIL_MODEL:-claude-sonnet-5-5}"
DETAIL_EFFORT="${DAILY_FEED_DETAIL_EFFORT:-low}"
FALLBACK_MODEL="${DAILY_FEED_FALLBACK_MODEL:-claude-haiku-4-5-20251001}"
MAX_ATTEMPTS="${DAILY_FEED_MAX_ATTEMPTS:-4}"
STATE="$HOME/Library/Application Support/daily-feed.lastday"       # date of the last successful run
ATTEMPTS="$HOME/Library/Application Support/daily-feed.attempts"   # "<date> <count>"
LOG="$HOME/Library/Logs/daily-feed.log"
FAILED=0
MODE=scheduled
STUB=0
DETAIL_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --now) MODE=now ;;
    --stub) STUB=1 ;;
    --detail-only) DETAIL_ONLY=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# launchd starts with a minimal PATH: add Homebrew, ~/.local, and the newest nvm node.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
export DAILY_FEED_ROOT="$ROOT"

[ "$DETAIL_ONLY" = 0 ] || [ "$MODE" = now ] || { echo "--detail-only needs --now" >&2; exit 2; }

TODAY="$(TZ="$TZN" date +%F)"
NOW_TIME="$(TZ="$TZN" date +%H:%M)"

if [ "$MODE" = scheduled ]; then
  LAST="$(cat "$STATE" 2>/dev/null || true)"
  [ "$TODAY" != "$LAST" ] || exit 0
  [[ "$NOW_TIME" > "$TARGET_TIME" || "$NOW_TIME" == "$TARGET_TIME" ]] || exit 0
  read -r ATT_DAY ATT_COUNT < "$ATTEMPTS" 2>/dev/null || true
  [ "${ATT_DAY:-}" = "$TODAY" ] || ATT_COUNT=0
  [ "${ATT_COUNT:-0}" -lt "$MAX_ATTEMPTS" ] || exit 0   # gave up for today
  mkdir -p "$(dirname "$STATE")" "$(dirname "$LOG")"
  exec >>"$LOG" 2>&1
fi

cd "$ROOT"
echo "=== $(date) daily-feed run (mode=$MODE stub=$STUB today=$TODAY tz=$TZN curate=$CURATE_MODEL/$CURATE_EFFORT detail=$DETAIL_MODEL/$DETAIL_EFFORT) ==="

if [ "$MODE" = scheduled ]; then
  # The published site is built from main. An interactive session may have
  # left another branch checked out; do not commit there, and do not sweep
  # unrelated uncommitted edits into the daily commit.
  BRANCH="$(git branch --show-current)"
  if [ "$BRANCH" != "main" ]; then
    echo "[run] branch is '$BRANCH', not main; skipping today's run"
    exit 0
  fi
  if ! git diff --quiet -- data site || ! git diff --cached --quiet -- data site; then
    echo "[run] data/ or site/ has uncommitted changes; skipping today's run so they are not swept into the feed commit"
    exit 0
  fi
  ATT_COUNT=$(( ${ATT_COUNT:-0} + 1 ))
  printf '%s %s' "$TODAY" "$ATT_COUNT" > "$ATTEMPTS"   # counted first, so a crash still uses up an attempt
  echo "[run] attempt $ATT_COUNT of $MAX_ATTEMPTS today"
fi

if [ "$DETAIL_ONLY" = 0 ]; then
  node scripts/fetch.mjs

  rm -f data/curated.json            # never let yesterday's decisions be re-applied
  if [ "$STUB" = 1 ]; then
    node scripts/stub-curate.mjs
  else
    # Candidates are untrusted web text. The agent may write exactly one file
    # (file writes are governed by Edit(...) rules), has no shell, no network,
    # no subagents and no MCP servers, and may not read the pipeline's memory
    # files. Reads inside this repo are allowed by Claude Code's default
    # rules; reads outside the repo need a permission that headless mode never
    # grants. Verified against claude 2.1.237 on 2026-10-04.
    if ! claude -p "/daily-feed-curate" \
        --allowedTools "Read(./data/candidates.json)" "Edit(./data/curated.json)" \
        --disallowedTools "Bash" "WebFetch" "WebSearch" "Agent" "NotebookEdit" \
          "Read(./data/items.json)" "Read(./data/dropped.json)" "Read(./data/status.json)" \
          "Read(./config/**)" "Grep" "Glob" \
        --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
        --model "$CURATE_MODEL" --effort "$CURATE_EFFORT" --fallback-model "$FALLBACK_MODEL" \
        --output-format text --max-turns 20; then
      echo "[run] curate step failed; continuing with previous items, will retry on the next poll"
      FAILED=1
    fi
  fi

  node scripts/merge.mjs
fi

# Vietnamese detail, in batches so each claude call keeps a small context.
# detail-prep fetches article text (scripted, cached) and queues one file per
# item; the agent reads only the queue and writes only data/details/; the
# merge validates every file before it touches items.json. Bounded by
# detailMaxPerDay in config/feed.mjs; the loop limit is a backstop.
for _ in $(seq 1 20); do
  QUEUED="$(node scripts/detail-prep.mjs)"
  [ "${QUEUED:-0}" -gt 0 ] 2>/dev/null || break
  if [ "$STUB" = 1 ]; then
    node scripts/stub-detail.mjs
  elif ! claude -p "/daily-feed-detail" \
      --allowedTools "Read(./data/detail-queue/**)" "Edit(./data/details/**)" \
      --disallowedTools "Bash" "WebFetch" "WebSearch" "Agent" "NotebookEdit" \
        "Read(./data/items.json)" "Read(./data/dropped.json)" "Read(./data/status.json)" \
          "Read(./config/**)" "Grep" "Glob" \
      --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
      --model "$DETAIL_MODEL" --effort "$DETAIL_EFFORT" --fallback-model "$FALLBACK_MODEL" \
      --output-format text --max-turns 40; then
    echo "[run] detail step failed; keeping what was written"
    node scripts/detail-merge.mjs
    break
  fi
  node scripts/detail-merge.mjs
done

node scripts/build.mjs

if [ "$MODE" = scheduled ]; then
  git add data site
  if git diff --cached --quiet; then
    echo "[run] nothing to commit"
  else
    git commit -q -m "feed: $TODAY"
    echo "[run] committed feed: $TODAY"
  fi
  if git push -q origin main; then
    echo "[run] pushed"
  else
    echo "[run] push failed; commit kept, will retry on the next poll"
    FAILED=1
  fi
  if [ "$FAILED" = 0 ]; then
    printf '%s' "$TODAY" > "$STATE"   # success: the rest of today's polls do nothing
    echo "[run] success; done for $TODAY"
  fi
fi
echo "=== $(date) done (failed=$FAILED) ==="
