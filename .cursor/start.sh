#!/usr/bin/env bash
# Per-boot reconciliation for the Rakazo Cloud Agent environment.
# Starts Docker, Postgres, and applies migrations, then returns. Idempotent.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=/dev/null
. .cursor/lib.sh

use_node
ensure_dockerd

# The sandbox "computer" image (agent desktops) may not be baked into the base
# image; build it if it is missing.
if ! docker image inspect rakazo/computer:local >/dev/null 2>&1; then
  docker build -t rakazo/computer:local infra/sandboxes/computer
fi

# Local Postgres for the product path.
docker compose --env-file .env -f infra/compose/docker-compose.yml up postgres -d
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' compose-postgres-1 2>/dev/null || echo none)"
  [ "$status" = "healthy" ] && break
  sleep 1
done

# Apply database migrations (idempotent).
pnpm db:migrate
