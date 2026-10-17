#!/usr/bin/env bash
# Genera API key/secret de Administrator en el almacén y las imprime.
# Uso: bash erpnext/bootstrap.sh   (con el compose ya levantado)
set -euo pipefail
SITE="${SITE:-angibell360}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Generando API keys para Administrator en el sitio ${SITE}..."
docker compose -f "${ROOT}/docker-compose.yml" exec -T backend \
  bench --site "${SITE}" execute frappe.core.doctype.user.user.generate_keys --kwargs '{"user": "Administrator"}'

echo
echo "Copia api_key y api_secret en web/.env (ERPNEXT_API_KEY / ERPNEXT_API_SECRET)"
echo "o configura la conexión desde /panel → Almacén."
