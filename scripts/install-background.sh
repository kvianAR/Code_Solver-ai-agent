#!/bin/zsh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.daily-solver.agent"
USER_PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
NODE_BIN="$(command -v node)"

if [[ "${1:-}" == "uninstall" ]]; then
  launchctl bootout "gui/$(id -u)" "$USER_PLIST" 2>/dev/null || true
  rm -f "$USER_PLIST"
  zsh "$PROJECT_DIR/scripts/install-mac-wake.sh" uninstall
  echo "Daily Solver background server, wake helper, and scheduled power events are off."
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents" "$PROJECT_DIR/data"
TMP_PLIST="$(mktemp)"
trap 'rm -f "$TMP_PLIST"' EXIT
cat >"$TMP_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${NODE_BIN}</string><string>${PROJECT_DIR}/server/index.mjs</string></array>
<key>WorkingDirectory</key><string>${PROJECT_DIR}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${HOME}/.docker/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ProcessType</key><string>Background</string><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${PROJECT_DIR}/data/launch-agent.log</string>
<key>StandardErrorPath</key><string>${PROJECT_DIR}/data/launch-agent-error.log</string>
</dict></plist>
PLIST
plutil -lint "$TMP_PLIST" >/dev/null
cp "$TMP_PLIST" "$USER_PLIST"
launchctl bootout "gui/$(id -u)" "$USER_PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$USER_PLIST"
zsh "$PROJECT_DIR/scripts/install-mac-wake.sh"
echo "Daily Solver is installed in the background and will remain on until background:uninstall is run."
