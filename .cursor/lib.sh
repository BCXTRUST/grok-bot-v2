#!/usr/bin/env bash
# Shared helpers for Cloud Agent environment scripts.
# Sourced by install.sh, start.sh, and dev.sh.

# Rakazo pins Node >= 22.22.2 (see root package.json "engines"). The base image
# ships nvm with this version, but a shim earlier on PATH can shadow it, so we
# select it explicitly.
RAKAZO_NODE_VERSION="22.22.2"

use_node() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  if ! nvm use "$RAKAZO_NODE_VERSION" >/dev/null 2>&1; then
    nvm install "$RAKAZO_NODE_VERSION" >/dev/null
    nvm use "$RAKAZO_NODE_VERSION" >/dev/null
  fi
  export PATH="$NVM_DIR/versions/node/v$RAKAZO_NODE_VERSION/bin:$PATH"
  hash -r
}

# Start the Docker daemon if it is not already running. Nested Cloud Agent VMs
# cannot use overlay2, so we use the fuse-overlayfs storage driver. Idempotent:
# returns immediately when the daemon is already up.
ensure_dockerd() {
  if sudo docker info >/dev/null 2>&1; then
    sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
    return 0
  fi
  sudo mkdir -p /var/log/rakazo
  sudo bash -c 'nohup dockerd --storage-driver=fuse-overlayfs >/var/log/rakazo/dockerd.log 2>&1 &'
  for _ in $(seq 1 45); do
    if sudo docker info >/dev/null 2>&1; then
      sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
      return 0
    fi
    sleep 1
  done
  echo "dockerd did not become ready" >&2
  return 1
}
