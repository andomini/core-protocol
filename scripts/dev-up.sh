#!/usr/bin/env bash
# Idempotent local start: Vite dev server on PORT (default 5173), detached, logs in .dev/.
# Usage: scripts/dev-up.sh [up|status|stop]
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-5173}"
DEV_DIR=.dev
LOG="$DEV_DIR/vite.log"
PID_FILE="$DEV_DIR/vite.pid"
mkdir -p "$DEV_DIR"

listening() { ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; }

status() {
  if listening; then
    local lan
    lan=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
    echo "dev server: UP  → http://localhost:$PORT/${lan:+  (LAN: http://$lan:$PORT/)}"
  else
    echo "dev server: DOWN (port $PORT)"
  fi
}

up() {
  if listening; then status; return; fi
  [ -d node_modules ] || npm install
  setsid nohup npx vite --port "$PORT" --strictPort >"$LOG" 2>&1 &
  echo $! >"$PID_FILE"
  for _ in $(seq 1 60); do
    listening && break
    sleep 0.25
  done
  if ! listening; then echo "dev server failed to start; tail of $LOG:"; tail -20 "$LOG"; exit 1; fi
  status
}

stop() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    kill -- -"$(cat "$PID_FILE")" 2>/dev/null || kill "$(cat "$PID_FILE")"
  fi
  rm -f "$PID_FILE"
  sleep 0.3
  status
}

case "${1:-up}" in
  up) up ;;
  status) status ;;
  stop) stop ;;
  *) echo "usage: $0 [up|status|stop]"; exit 2 ;;
esac
