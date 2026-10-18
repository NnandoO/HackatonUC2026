#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"

umask 077
touch "$ENV_FILE"
ensure_secret() {
  local secret_name="$1"
  if ! rg -q "^${secret_name}=.{32,}$" "$ENV_FILE"; then
    sed -i "/^${secret_name}=/d" "$ENV_FILE"
    printf '%s=%s\n' "$secret_name" "$(openssl rand -hex 32)" >> "$ENV_FILE"
  fi
}

ensure_secret ANGIBELL_ADMIN_SERVICE_KEY
ensure_secret PAPERCLIP_API_KEY
ensure_secret PANEL_PASSWORD
ensure_secret POSTGRES_PASSWORD
ensure_secret META_TOKEN_ENCRYPTION_KEY

exec docker compose --env-file "$ENV_FILE" -f "$ROOT/docker-compose.yml" up --build postgres api web
