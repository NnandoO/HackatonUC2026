#!/usr/bin/env bash
# Siembra el catálogo de Angibell usando la misma API que usa Paperclip.
# Uso: ./scripts/seed-demo.sh [http://localhost:3000]
# Requiere PAPERCLIP_API_KEY en el entorno o en .env.local
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/scripts/seed-demo.mjs" "${1:-http://localhost:3000}"
