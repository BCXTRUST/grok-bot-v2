#!/usr/bin/env bash
# Publish the Vite app on a Cloudflare quick tunnel and point local .env at it.
set -euo pipefail

WEB_PORT="${WEB_PORT:-5173}"
METRICS_PORT="${CLOUDFLARED_METRICS_PORT:-20241}"
ORIGIN="${TUNNEL_ORIGIN:-http://127.0.0.1:${WEB_PORT}}"
LOG="${CLOUDFLARED_LOG:-/tmp/rakazo-cloudflared.log}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed" >&2
  exit 1
fi

pkill -f "cloudflared tunnel --url ${ORIGIN}" >/dev/null 2>&1 || true
sleep 0.5

: >"$LOG"
nohup cloudflared tunnel --url "$ORIGIN" --metrics "127.0.0.1:${METRICS_PORT}" --no-autoupdate \
  >>"$LOG" 2>&1 &
echo $! > /tmp/rakazo-cloudflared.pid

hostname=""
for _ in $(seq 1 60); do
  hostname="$(curl -fsS "http://127.0.0.1:${METRICS_PORT}/quicktunnel" 2>/dev/null \
    | sed -n 's/.*"hostname":"\([^"]*\)".*/\1/p' || true)"
  if [[ -z "$hostname" ]]; then
    hostname="$(grep -Eo '[a-z0-9-]+\.trycloudflare\.com' "$LOG" | tail -1 || true)"
  fi
  if [[ -n "$hostname" ]]; then
    break
  fi
  sleep 0.5
done

if [[ -z "$hostname" ]]; then
  echo "cloudflared did not publish a hostname" >&2
  tail -n 40 "$LOG" >&2 || true
  exit 1
fi

url="https://${hostname}"
ready_ok=0
dns_ok=0
for _ in $(seq 1 40); do
  ready="$(curl -fsS "http://127.0.0.1:${METRICS_PORT}/ready" 2>/dev/null || true)"
  if [[ "$ready" == *'"readyConnections":'* && "$ready" != *'"readyConnections":0'* ]]; then
    ready_ok=1
  fi
  if getent ahosts "$hostname" >/dev/null 2>&1 \
    || dig @1.1.1.1 +short "$hostname" A 2>/dev/null | grep -Eq '^[0-9]'; then
    dns_ok=1
  fi
  if [[ "$ready_ok" -eq 1 && "$dns_ok" -eq 1 ]]; then
    break
  fi
  sleep 0.5
done

if [[ "$ready_ok" -eq 0 ]]; then
  echo "cloudflared tunnel is not connected: ${hostname}" >&2
  tail -n 40 "$LOG" >&2 || true
  exit 1
fi

echo "$url"

if [[ -f "$ROOT/.env" ]]; then
  python3 - "$ROOT/.env" "$url" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
url = sys.argv[2]
keys = {"BETTER_AUTH_URL", "API_URL", "WEB_ORIGIN"}
lines = path.read_text().splitlines(keepends=True)
seen = set()
out = []
for line in lines:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        out.append(line)
        continue
    key, _ = stripped.split("=", 1)
    if key in keys:
        out.append(f"{key}={url}\n")
        seen.add(key)
    else:
        out.append(line)
for key in keys - seen:
    out.append(f"{key}={url}\n")
path.write_text("".join(out))
PY
fi
