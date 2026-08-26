#!/usr/bin/env bash
# Idempotent dependency + baseline setup for the Rakazo Cloud Agent environment.
# Runs after the repository is checked out. Safe to run repeatedly.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=/dev/null
. .cursor/lib.sh

use_node
corepack enable >/dev/null 2>&1 || true

# System packages for the Dockerized product path (Postgres + agent computers).
if ! command -v docker >/dev/null 2>&1 || ! command -v docker-compose-v2 >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    --no-install-recommends docker.io docker-compose-v2 fuse-overlayfs
fi

# Local environment file with strong random secrets. Never overwrite an existing
# .env (it is gitignored and may hold user-provided credentials).
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$(openssl rand -hex 32)|" .env
  sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -hex 32)|" .env
fi

# JavaScript dependencies and the generated Prisma client.
pnpm install --frozen-lockfile
pnpm db:generate

# Pre-build the sandbox "computer" image so agent desktops start quickly. This
# needs a running Docker daemon; tolerate build hosts where nested Docker is
# unavailable, since start.sh rebuilds it on first boot if it is missing.
if ensure_dockerd; then
  if ! docker image inspect rakazo/computer:local >/dev/null 2>&1; then
    docker build -t rakazo/computer:local infra/sandboxes/computer || \
      echo "sandbox image build skipped; start.sh will build it at boot" >&2
  fi
else
  echo "Docker daemon unavailable during install; start.sh will handle it at boot" >&2
fi
