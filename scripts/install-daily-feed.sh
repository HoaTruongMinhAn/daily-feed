#!/usr/bin/env bash
# Opt-in: installs the LaunchAgent that polls scripts/daily-feed-run.sh
# every 15 minutes and symlinks the curation and detail skills into ~/.claude/skills.
# Override DAILY_FEED_TZ / DAILY_FEED_TIME in the environment before running.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.dailyfeed.run"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
TZN="${DAILY_FEED_TZ:-Asia/Ho_Chi_Minh}"
TARGET_TIME="${DAILY_FEED_TIME:-07:00}"

command -v claude >/dev/null || { echo "claude CLI not found on PATH" >&2; exit 1; }
command -v node >/dev/null || { echo "node not found on PATH" >&2; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.claude/skills" "$HOME/Library/Logs"
ln -sfn "$ROOT/skills/daily-feed-curate" "$HOME/.claude/skills/daily-feed-curate"
ln -sfn "$ROOT/skills/daily-feed-detail" "$HOME/.claude/skills/daily-feed-detail"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT/scripts/daily-feed-run.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DAILY_FEED_ROOT</key><string>$ROOT</string>
    <key>DAILY_FEED_TZ</key><string>$TZN</string>
    <key>DAILY_FEED_TIME</key><string>$TARGET_TIME</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/daily-feed.launchd.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/daily-feed.launchd.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL: daily after $TARGET_TIME $TZN, every day incl. weekends."
echo "Log: ~/Library/Logs/daily-feed.log"
echo "Uninstall: launchctl bootout gui/$(id -u)/$LABEL && rm \"$PLIST\""
