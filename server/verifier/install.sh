#!/usr/bin/env bash
# Installs the leaderboard verifier as a systemd *user* service + timer (every 5 min).
# It does NOT enable or start anything; it prints the command for that.
#   server/verifier/install.sh            install / update the units
#   server/verifier/install.sh --remove   stop, disable and delete the units
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
NAME=core-protocol-verifier
ENV_FILE="$HERE/verifier.env"

if [[ "${1:-}" == "--remove" ]]; then
  systemctl --user disable --now "$NAME.timer" 2>/dev/null || true
  rm -f "$UNIT_DIR/$NAME.service" "$UNIT_DIR/$NAME.timer"
  systemctl --user daemon-reload
  echo "removed $NAME units"
  exit 0
fi

NODE="$(command -v node || true)"
[[ -n "$NODE" ]] || { echo "node not found in PATH" >&2; exit 1; }
[[ -x "$REPO/node_modules/.bin/tsx" ]] || { echo "missing $REPO/node_modules/.bin/tsx: run npm install in $REPO" >&2; exit 1; }

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$HERE/verifier.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "created $ENV_FILE (git-ignored): fill in LB_URL and ADMIN_TOKEN"
fi

mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/$NAME.service" <<UNIT
[Unit]
Description=Core Protocol leaderboard verifier (replays pending runs)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$REPO
EnvironmentFile=$ENV_FILE
Environment=PATH=$(dirname "$NODE"):/usr/local/bin:/usr/bin:/bin
ExecStart=$REPO/node_modules/.bin/tsx $HERE/verify.ts
Nice=10
TimeoutStartSec=50min
UNIT

cat > "$UNIT_DIR/$NAME.timer" <<UNIT
[Unit]
Description=Run the Core Protocol leaderboard verifier every 5 minutes

[Timer]
OnBootSec=2min
OnUnitInactiveSec=5min
Persistent=false

[Install]
WantedBy=timers.target
UNIT

systemctl --user daemon-reload
echo "installed $UNIT_DIR/$NAME.{service,timer} (not enabled)"
echo "try once:  systemctl --user start $NAME.service && journalctl --user -u $NAME -n 30"
echo "enable:    systemctl --user enable --now $NAME.timer"
