#!/usr/bin/env bash
# Script de carga de catálogo hacia la API unificada (sin datos mock predefinidos).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/scripts/seed-demo.mjs" "${1:-http://localhost:3000}"
