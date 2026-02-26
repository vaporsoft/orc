#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

export ORC_REPO="${ORC_REPO:-$(pwd)}"

exec node --import tsx "$PROJECT_ROOT/src/index.tsx"
