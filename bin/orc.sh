#!/usr/bin/env bash
set -euo pipefail

# Resolve the project root (parent of bin/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Default to the current working directory for the repo to monitor
export ORC_REPO="${ORC_REPO:-$(pwd)}"

# Start the server (serves the pre-built UI)
exec bun "$PROJECT_ROOT/packages/server/src/index.ts"
