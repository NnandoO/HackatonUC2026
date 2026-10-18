#!/usr/bin/env bash
set -euo pipefail
umask 077
base="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export PAPERCLIP_HOME="$base/.state/paperclip"
export PAPERCLIP_INSTANCE_ID=angibell
export PAPERCLIP_NO_BROWSER=1
export PORT=3100
export SERVE_UI=true
unset DATABASE_URL
cli="$base/.runtime/node_modules/.bin/paperclipai"
[[ -x "$cli" ]] || { printf '%s\n' 'Ejecuta primero bash setup.sh'; exit 1; }
mkdir -p "$base/.state"
python3 - <<'CHECK'
import socket
with socket.socket() as sock:
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(('127.0.0.1', 3100))
    except OSError:
        raise SystemExit('Puerto 3100 ocupado; no se modificará otra instancia.')
CHECK
# Foreground supervisor: Ctrl+C detiene el servidor que este script inició.
"$cli" onboard --yes --no-install-service >"$base/.state/server.log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true' EXIT
trap 'exit 130' INT TERM
ready=0
for ((attempt=0; attempt<120; attempt++)); do
  kill -0 "$server_pid" 2>/dev/null || { printf '%s\n' 'Paperclip falló. Revisa .state/server.log localmente.'; exit 1; }
  if python3 "$base/provision.py" --health >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { printf '%s\n' 'Paperclip no respondió en 120 s. Revisa .state/server.log.'; exit 1; }
if python3 - "$PAPERCLIP_HOME/instances/$PAPERCLIP_INSTANCE_ID/config.json" <<'MODE'
import json, sys
raise SystemExit(0 if json.load(open(sys.argv[1]))['server']['deploymentMode'] == 'local_trusted' else 1)
MODE
then
  python3 "$base/provision.py" "$@"
else
  printf '%s\n' 'Modo autenticado: compañía y agentes existentes conservados; inicia sesión en el panel.'
fi
printf '%s\n' 'Paperclip: http://127.0.0.1:3100 — Ctrl+C para detener.'
wait "$server_pid"
