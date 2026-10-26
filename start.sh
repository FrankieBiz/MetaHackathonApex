#!/usr/bin/env bash
# Apex OS local stack: the FastAPI backend on :8000 and the Next.js terminal on :3000.
#
#   ./start.sh            install anything missing, then run both; Ctrl+C stops both
#   ./start.sh install    install backend and frontend dependencies, then exit
#
# API_PORT and WEB_PORT change the ports. Canvas, Llama, and Supabase variables exported in
# your shell (backend/README.md#configuration) pass through to the backend; with no Canvas
# token it serves the deterministic sandbox. Portable to macOS's bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source root .env if present (automatically exports Meta keys, Canvas token, ports, etc.)
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-3000}"
VENV="$ROOT/backend/.venv"
PY="$VENV/bin/python"
PIDS=""

# Checked once here: inside the server subshells stdout is already the log pipe.
TTY=""
[ -t 1 ] && TTY=1
if [ -n "$TTY" ]; then
  BOLD=$'\033[1m' AMBER=$'\033[33m' CYAN=$'\033[36m' MAGENTA=$'\033[35m' OFF=$'\033[0m'
else
  BOLD="" AMBER="" CYAN="" MAGENTA="" OFF=""
fi

say() { printf '%s[apex]%s %s\n' "$AMBER" "$OFF" "$*"; }
die() {
  say "error: $*" >&2
  exit 1
}

install_backend() {
  local stamp="$VENV/.apex-requirements"
  if [ -x "$PY" ] && [ -f "$stamp" ] && cmp -s "$ROOT/backend/requirements.txt" "$stamp"; then
    return
  fi
  say "Installing backend dependencies into backend/.venv"
  if command -v uv >/dev/null 2>&1; then
    [ -x "$PY" ] || uv venv "$VENV" --python 3.12 --quiet
    uv pip install --quiet --python "$PY" -r "$ROOT/backend/requirements.txt"
  else
    if [ ! -x "$PY" ]; then
      local base
      base="$(command -v python3.12 || command -v python3 || true)"
      [ -n "$base" ] || die "Python 3.12+ not found. Install uv (https://docs.astral.sh/uv/) or Python 3.12."
      "$base" -c 'import sys; sys.exit(sys.version_info < (3, 12))' ||
        die "Python 3.12+ is required; $base is $("$base" -V 2>&1). Install uv to fetch 3.12 automatically."
      "$base" -m venv "$VENV"
    fi
    "$PY" -m pip install --quiet --disable-pip-version-check -r "$ROOT/backend/requirements.txt"
  fi
  cp "$ROOT/backend/requirements.txt" "$stamp"
}

install_frontend() {
  command -v node >/dev/null 2>&1 || die "Node.js not found. Install Node 24 (see .node-version); Next.js needs 20.9+."
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] ||
    die "Node.js 20.9+ is required (found $(node -v)); 24 is the tested version."
  local lock="$ROOT/frontend/package-lock.json" installed="$ROOT/frontend/node_modules/.package-lock.json"
  if [ -f "$installed" ] && [ ! "$lock" -nt "$installed" ]; then
    return
  fi
  say "Installing frontend dependencies (npm ci)"
  (cd "$ROOT/frontend" && npm ci --no-audit --no-fund --loglevel=error)
}

# Something already listening on 127.0.0.1 or ::1 (another Apex backend, an old dev server).
port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null || (exec 3<>"/dev/tcp/::1/$1") 2>/dev/null
}

# Prefixes each line from one server. Ignores Ctrl+C so shutdown logs still get through.
prefix() {
  trap '' INT
  exec awk -v tag="$1" '{ print tag $0; fflush() }'
}

descendants() {
  local child
  command -v pgrep >/dev/null 2>&1 || return 0
  for child in $(pgrep -P "$1" 2>/dev/null); do
    echo "$child"
    descendants "$child"
  done
}

running() {
  local pid
  for pid in "$@"; do
    kill -0 "$pid" 2>/dev/null && return 0
  done
  return 1
}

# Stops both servers: TERM to each server, a 5s grace period, then KILL for anything left in
# their process trees. The servers stop their own workers, and the log prefixers (also in the
# trees) exit once their server's output closes, so shutdown logs still print.
cleanup() {
  trap - EXIT INT TERM
  [ -n "$PIDS" ] || return 0
  say "Stopping Apex OS"
  local pid all=""
  for pid in $PIDS; do
    all="$all $pid $(descendants "$pid")"
  done
  # shellcheck disable=SC2086 # word splitting is intended: these are PID lists
  kill -TERM $PIDS 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    # shellcheck disable=SC2086
    running $all || break
    sleep 0.5
  done
  # shellcheck disable=SC2086
  kill -KILL $all 2>/dev/null || true
  # shellcheck disable=SC2086
  wait $PIDS 2>/dev/null || true
}

wait_until_up() {
  local url="$1" pid="$2"
  command -v curl >/dev/null 2>&1 || return 0
  for _ in $(seq 1 240); do
    curl --silent --fail --output /dev/null --max-time 30 "$url" && return 0
    kill -0 "$pid" 2>/dev/null || return 1
    sleep 0.5
  done
  return 1
}

case "${1:-}" in
  "") ;;
  install)
    install_backend
    install_frontend
    say "Dependencies installed. Run ./start.sh to launch."
    exit 0
    ;;
  -h | --help)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *) die "unknown command '$1' (try ./start.sh --help)" ;;
esac

install_backend
install_frontend

for port in "$API_PORT" "$WEB_PORT"; do
  if port_busy "$port"; then
    die "port $port is already in use. Stop that process, or pick other ports: API_PORT=8001 WEB_PORT=3001 ./start.sh"
  fi
done

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

API_URL="http://127.0.0.1:$API_PORT"
WEB_URL="http://localhost:$WEB_PORT"
# The backend always allows :3000 and :5173; this also covers a custom WEB_PORT.
CORS_ORIGINS="${CORS_ORIGINS:+$CORS_ORIGINS,}http://localhost:$WEB_PORT,http://127.0.0.1:$WEB_PORT"
COLOR_FLAG=""
[ -n "$TTY" ] && COLOR_FLAG="--use-colors"

say "Starting the API on $API_URL and the terminal on $WEB_URL"
(
  cd "$ROOT"
  # One worker, like Render: the backend's cache and working state are per process.
  # shellcheck disable=SC2086 # COLOR_FLAG is empty or one flag
  CORS_ORIGINS="$CORS_ORIGINS" PYTHONUNBUFFERED=1 exec "$PY" -m uvicorn backend.main:app \
    --host 127.0.0.1 --port "$API_PORT" --workers 1 $COLOR_FLAG
) > >(prefix "${CYAN}api │${OFF} ") 2>&1 &
API_PID=$!
PIDS="$API_PID"

(
  cd "$ROOT/frontend"
  if [ -n "$TTY" ]; then export FORCE_COLOR=1; fi
  # The terminal talks to this script's backend, overriding any frontend/.env.local value.
  NEXT_PUBLIC_API_URL="$API_URL" exec ./node_modules/.bin/next dev --port "$WEB_PORT"
) > >(prefix "${MAGENTA}web │${OFF} ") 2>&1 &
WEB_PID=$!
PIDS="$PIDS $WEB_PID"

if wait_until_up "$API_URL/openapi.json" "$API_PID" && wait_until_up "$WEB_URL" "$WEB_PID"; then
  say "${BOLD}Apex OS is up${OFF}"
  say "  Terminal   $WEB_URL"
  say "  API docs   $API_URL/docs"
  say "  Ctrl+Shift+D in the terminal pins the offline simulation desk · Ctrl+C here stops both"
fi

while kill -0 "$API_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 1
done
if kill -0 "$API_PID" 2>/dev/null; then
  status=0
  wait "$WEB_PID" || status=$?
  say "The terminal (Next.js) exited with status $status; stopping the API."
else
  status=0
  wait "$API_PID" || status=$?
  say "The API (uvicorn) exited with status $status; stopping the terminal."
fi
exit 1
