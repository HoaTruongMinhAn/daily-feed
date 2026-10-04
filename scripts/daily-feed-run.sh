#!/usr/bin/env bash
# Daily Feed runner. Scheduled mode (no flags): called every 15 min by the
# LaunchAgent, runs once per calendar day after DAILY_FEED_TIME in
# DAILY_FEED_TZ, EVERY day including Saturday and Sunday (owner decision,
# 2026-10-04), then commits and pushes. `--now` runs immediately without
# the schedule check and without committing. `--stub` replaces the Claude
# curation step with scripts/stub-curate.mjs (offline preview).
set -euo pipefail

ROOT="${DAILY_FEED_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TZN="${DAILY_FEED_TZ:-Asia/Ho_Chi_Minh}"
TARGET_TIME="${DAILY_FEED_TIME:-07:00}"
STATE="$HOME/Library/Application Support/daily-feed.lastday"
LOG="$HOME/Library/Logs/daily-feed.log"
MODE=scheduled
STUB=0
for arg in "$@"; do
  case "$arg" in
    --now) MODE=now ;;
    --stub) STUB=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# launchd starts with a minimal PATH: add Homebrew, ~/.local, and the newest nvm node.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
export DAILY_FEED_ROOT="$ROOT"

TODAY="$(TZ="$TZN" date +%F)"
NOW_TIME="$(TZ="$TZN" date +%H:%M)"

if [ "$MODE" = scheduled ]; then
  LAST="$(cat "$STATE" 2>/dev/null || true)"
  [ "$TODAY" != "$LAST" ] || exit 0
  [[ "$NOW_TIME" > "$TARGET_TIME" || "$NOW_TIME" == "$TARGET_TIME" ]] || exit 0
  mkdir -p "$(dirname "$STATE")" "$(dirname "$LOG")"
  printf '%s' "$TODAY" > "$STATE"   # mark first, so a crash does not retry all day
  exec >>"$LOG" 2>&1
fi

cd "$ROOT"
echo "=== $(date) daily-feed run (mode=$MODE stub=$STUB today=$TODAY tz=$TZN) ==="

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
fi

node scripts/fetch.mjs

rm -f data/curated.json            # never let yesterday's decisions be re-applied
if [ "$STUB" = 1 ]; then
  node scripts/stub-curate.mjs
else
  # Candidates are untrusted web text. The agent may write exactly one file
  # (file writes are governed by Edit(...) rules), has no shell, no network,
  # no subagents and no MCP servers, and may not read the pipeline's memory
  # files. Reads inside this public repo are allowed by Claude Code's default
  # rules; reads outside the repo need a permission that headless mode never
  # grants. Verified against claude 2.1.237 on 2026-10-04.
  if ! claude -p "/daily-feed-curate" \
      --allowedTools "Read(./data/candidates.json)" "Edit(./data/curated.json)" \
      --disallowedTools "Bash" "WebFetch" "WebSearch" "Agent" "NotebookEdit" \
        "Read(./data/items.json)" "Read(./data/dropped.json)" "Read(./data/status.json)" \
      --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
      --output-format text --max-turns 20; then
    echo "[run] curate step failed; continuing with previous items"
  fi
fi

node scripts/merge.mjs
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
    echo "[run] push failed; commit kept, will retry on the next run"
  fi
fi
echo "=== $(date) done ==="
