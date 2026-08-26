#!/usr/bin/env bash
# Long-running Rakazo development stack for the Cloud Agent "dev" terminal.
# Runs the API, Graphile worker, web app, and sandbox supervisor via turbo.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=/dev/null
. .cursor/lib.sh

use_node
exec pnpm dev
