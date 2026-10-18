#!/usr/bin/env bash
set -euo pipefail
umask 077
base="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null
command -v npm >/dev/null
command -v python3 >/dev/null
command -v git >/dev/null
command -v codex >/dev/null
mkdir -p "$base/.runtime" "$base/.state"
chmod 700 "$base/.state"
if [[ ! -x "$base/.runtime/node_modules/.bin/paperclipai" ]]; then
  printf '%s\n' 'Instalando Paperclip oficial (versión exacta registrada en package-lock.json)…'
  npm install --prefix "$base/.runtime" --cache "$base/.state/npm-cache" --registry="${PAPERCLIP_NPM_REGISTRY:-https://registry.yarnpkg.com}" --fetch-retries=1 --fetch-timeout=20000 --legacy-peer-deps --save-exact paperclipai@2026.1012.0
fi
# npm 12 blocks dependency lifecycle scripts; this reviewed script restores
# the relative library symlinks required by embedded PostgreSQL on Linux x64.
pg_native="$base/.runtime/node_modules/@embedded-postgres/linux-x64"
if [[ -f "$pg_native/scripts/hydrate-symlinks.js" ]]; then
  (cd "$pg_native" && node scripts/hydrate-symlinks.js)
fi
python3 "$base/prepare.py"
exec bash "$base/start.sh" "$@"
