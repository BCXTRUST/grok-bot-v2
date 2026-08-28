#!/usr/bin/env bash
# Single Railway replica: migrate, API, worker, and Vite preview on $PORT.
set -euo pipefail

export DATA_DIR="${DATA_DIR:-/data}"
if ! mkdir -p "$DATA_DIR" || ! touch "$DATA_DIR/.write-test" 2>/dev/null; then
  export DATA_DIR=/tmp/rakazo-data
  mkdir -p "$DATA_DIR"
fi
rm -f "$DATA_DIR/.write-test"

export API_PORT="${API_PORT:-3100}"
export API_PROXY_TARGET="${API_PROXY_TARGET:-http://127.0.0.1:${API_PORT}}"
export WEB_PORT="${PORT:-${WEB_PORT:-5173}}"

pnpm --filter @rakazo/db exec prisma migrate deploy

pnpm --filter @rakazo/api start &
api_pid=$!
pnpm --filter @rakazo/worker start &
worker_pid=$!

ready=0
for _ in $(seq 1 90); do
  if node -e "fetch('http://127.0.0.1:${API_PORT}/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "API did not become healthy on ${API_PORT}" >&2
  kill "$api_pid" "$worker_pid" 2>/dev/null || true
  wait || true
  exit 1
fi

pnpm --filter @rakazo/web preview --host 0.0.0.0 --port "$WEB_PORT" &
web_pid=$!

term() {
  kill "$api_pid" "$worker_pid" "$web_pid" 2>/dev/null || true
}
trap term INT TERM

wait -n "$api_pid" "$worker_pid" "$web_pid"
term
wait || true
exit 1
