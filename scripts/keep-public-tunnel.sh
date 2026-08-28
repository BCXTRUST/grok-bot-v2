#!/usr/bin/env bash
# Recreate the Cloudflare quick tunnel when QUIC/DNS dies so the public app
# and E2B noVNC proxy keep working. Reloads the API after a hostname change
# so WEB_ORIGIN / Better Auth match the live tunnel.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INTERVAL="${TUNNEL_WATCH_INTERVAL_SEC:-15}"
METRICS_PORT="${CLOUDFLARED_METRICS_PORT:-20241}"
URL_FILE="${RAKAZO_PUBLIC_URL_FILE:-/tmp/rakazo-public-url}"

tunnel_healthy() {
  local ready hostname
  ready="$(curl -fsS --max-time 2 "http://127.0.0.1:${METRICS_PORT}/ready" 2>/dev/null || true)"
  if [[ -z "$ready" || "$ready" == *'"readyConnections":0'* ]]; then
    return 1
  fi
  hostname="$(curl -fsS --max-time 2 "http://127.0.0.1:${METRICS_PORT}/quicktunnel" 2>/dev/null \
    | sed -n 's/.*"hostname":"\([^"]*\)".*/\1/p' || true)"
  if [[ -z "$hostname" ]]; then
    return 1
  fi
  getent ahosts "$hostname" >/dev/null 2>&1 \
    || dig @1.1.1.1 +short "$hostname" A 2>/dev/null | grep -Eq '^[0-9]'
}

reload_api() {
  local pid
  pid="$(ss -tlnp 2>/dev/null | sed -n 's/.*:3100 .*pid=\([0-9]*\).*/\1/p' | head -1)"
  if [[ -n "$pid" ]]; then
    kill "$pid" 2>/dev/null || true
  fi
}

previous=""
if [[ -f "$URL_FILE" ]]; then
  previous="$(cat "$URL_FILE" 2>/dev/null || true)"
fi

while true; do
  if tunnel_healthy; then
    hostname="$(curl -fsS --max-time 2 "http://127.0.0.1:${METRICS_PORT}/quicktunnel" 2>/dev/null \
      | sed -n 's/.*"hostname":"\([^"]*\)".*/\1/p' || true)"
    if [[ -n "$hostname" ]]; then
      echo "https://${hostname}" >"$URL_FILE"
    fi
    sleep "$INTERVAL"
    continue
  fi
  echo "public tunnel unhealthy — recreating" >&2
  url="$(bash "$ROOT/scripts/dev-public-tunnel.sh")"
  echo "$url" | tee "$URL_FILE"
  if [[ "$url" != "$previous" ]]; then
    reload_api
    previous="$url"
  fi
  sleep "$INTERVAL"
done
