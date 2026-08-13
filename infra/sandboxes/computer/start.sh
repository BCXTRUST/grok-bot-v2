#!/usr/bin/env bash
set -uo pipefail
export DISPLAY="${DISPLAY:-:1}"
export HOME="${HOME:-/home/rakazo}"
mkdir -p "$HOME" /tmp/rakazo /tmp/.X11-unix
cd "$HOME"

rm -f /tmp/.X1-lock /tmp/.X11-unix/X1

Xvfb :1 -screen 0 1280x800x24 -ac +extension RANDR +render -noreset >/tmp/rakazo/xvfb.log 2>&1 &
XVFB_PID=$!

ready=0
for _ in $(seq 1 100); do
  if xdpyinfo -display :1 >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.1
done
if [[ "$ready" -ne 1 ]]; then
  echo "Xvfb failed to start" >&2
  cat /tmp/rakazo/xvfb.log >&2 || true
  exit 1
fi

fluxbox >/tmp/rakazo/fluxbox.log 2>&1 &
xterm -geometry 100x28+24+24 -title "Rakazo computer" >/tmp/rakazo/xterm.log 2>&1 &

x11vnc -display :1 -forever -shared -nopw -listen 127.0.0.1 -rfbport 5900 -xkb -ncache 0 >/tmp/rakazo/x11vnc.log 2>&1 &

NOVNC_ROOT=/usr/share/novnc
if [[ ! -d "$NOVNC_ROOT" ]]; then
  echo "noVNC is missing from the computer image" >&2
  exit 1
fi
websockify --web="$NOVNC_ROOT" 0.0.0.0:6080 127.0.0.1:5900 >/tmp/rakazo/novnc.log 2>&1 &

while kill -0 "$XVFB_PID" 2>/dev/null; do
  sleep 2
done
echo "Xvfb exited" >&2
exit 1
