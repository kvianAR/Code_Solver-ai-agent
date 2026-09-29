#!/bin/zsh
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.daily-solver.wake"
INSTALL_DIR="/Library/Application Support/Daily Solver Wake"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"
EVENTS_PATH="$INSTALL_DIR/events.json"
NODE_BIN="$(command -v node)"
if [[ "${1:-}" == "uninstall" ]]; then
  sudo launchctl bootout system "$PLIST" 2>/dev/null || true
  HELPER="$PROJECT_DIR/scripts/mac-wake-helper.mjs"
  [[ -f "$HELPER" ]] || HELPER="$INSTALL_DIR/mac-wake-helper.mjs"
  sudo env DAILY_SOLVER_PROJECT="$PROJECT_DIR" DAILY_SOLVER_EVENTS_PATH="$EVENTS_PATH" "$NODE_BIN" "$HELPER" --cancel || true
  sudo env DAILY_SOLVER_PROJECT="$PROJECT_DIR" DAILY_SOLVER_EVENTS_PATH="$PROJECT_DIR/data/mac-wake-events.json" "$NODE_BIN" "$HELPER" --cancel || true
  sudo rm -f "$PLIST"
  sudo rm -rf "$INSTALL_DIR"
  echo "Daily Solver wake helper and its scheduled power events were removed."
  exit 0
fi
# Remove schedules recorded by releases that stored their event file inside the
# project. The freshly bootstrapped helper recreates the current events below.
sudo env DAILY_SOLVER_PROJECT="$PROJECT_DIR" DAILY_SOLVER_EVENTS_PATH="$PROJECT_DIR/data/mac-wake-events.json" "$NODE_BIN" "$PROJECT_DIR/scripts/mac-wake-helper.mjs" --cancel || true
TMP_PLIST="$(mktemp)"
trap 'rm -f "$TMP_PLIST"' EXIT
cat >"$TMP_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${NODE_BIN}</string><string>${INSTALL_DIR}/mac-wake-helper.mjs</string></array>
<key>EnvironmentVariables</key><dict><key>DAILY_SOLVER_PROJECT</key><string>${PROJECT_DIR}</string><key>DAILY_SOLVER_EVENTS_PATH</key><string>${EVENTS_PATH}</string></dict>
<key>RunAtLoad</key><true/><key>StartInterval</key><integer>3600</integer>
<key>WatchPaths</key><array><string>${PROJECT_DIR}/data/state.json</string></array>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${PROJECT_DIR}/data/mac-wake.log</string>
<key>StandardErrorPath</key><string>${PROJECT_DIR}/data/mac-wake-error.log</string>
</dict></plist>
PLIST
sudo install -d -m 755 "$INSTALL_DIR"
sudo install -o root -g wheel -m 755 "$PROJECT_DIR/scripts/mac-wake-helper.mjs" "$INSTALL_DIR/mac-wake-helper.mjs"
sudo install -o root -g wheel -m 644 "$TMP_PLIST" "$PLIST"
sudo launchctl bootout system "$PLIST" 2>/dev/null || true
sudo launchctl bootstrap system "$PLIST"
echo "Wake helper installed. It refreshes when settings change and checks LeetCode contests hourly."
