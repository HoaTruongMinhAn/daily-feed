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

node scripts/fetch.mjs

rm -f data/curated.json            # never let yesterday's decisions be re-applied
if [ "$STUB" = 1 ]; then
  node scripts/stub-curate.mjs
else
  # Read/Write only: candidates are untrusted web text; no shell, no network for the agent.
  if ! claude -p "/daily-feed-curate" --allowedTools "Read,Write" --output-format text --max-turns 20; then
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
