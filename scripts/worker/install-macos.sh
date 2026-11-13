#!/usr/bin/env bash
# Installs the SKOLAR Studio worker as a macOS LaunchAgent (starts at login,
# restarts if it crashes). Run from anywhere:
#   bash scripts/worker/install-macos.sh            install / update
#   bash scripts/worker/install-macos.sh --uninstall
# The project path is detected from this script's location.
set -euo pipefail

LABEL="ai.skolar.studio-worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL"
  exit 0
fi

NODE="$(command -v node || true)"
[[ -z "$NODE" ]] && { echo "Node.js not found in PATH. Install Node.js 20+ first."; exit 1; }
[[ -f "$ROOT/node_modules/tsx/dist/cli.mjs" ]] || { echo "Run 'npm install' in $ROOT first."; exit 1; }
mkdir -p "$ROOT/.studio-data/logs" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$ROOT/node_modules/tsx/dist/cli.mjs</string>
    <string>$ROOT/scripts/studio-worker.mts</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>300</integer>
  <key>StandardOutPath</key><string>$ROOT/.studio-data/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$ROOT/.studio-data/logs/launchd.err.log</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL for $ROOT (starts at login). Logs: $ROOT/.studio-data/logs/"
