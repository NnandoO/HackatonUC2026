#!/usr/bin/env python3
"""Paperclip process adapter bridge for authenticated agy and OpenCode workers."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import signal
import shlex
import subprocess
import sys
from urllib.request import Request, urlopen
from urllib.error import HTTPError

BASE = Path(__file__).resolve().parent
SUCCESS = 'ANGIBELL_ENTREGA_COMPLETA'

def api(method, path, body=None):
    headers = {'Content-Type': 'application/json', 'X-Paperclip-Run-Id': os.environ['PAPERCLIP_RUN_ID']}
    if os.environ.get('PAPERCLIP_API_KEY'):
        headers['Authorization'] = 'Bearer ' + os.environ['PAPERCLIP_API_KEY']
    req = Request(os.environ['PAPERCLIP_API_URL'].rstrip('/') + '/api' + path,
                  method=method, headers=headers,
                  data=None if body is None else json.dumps(body).encode())
    with urlopen(req, timeout=20) as response:
        raw = response.read()
        return json.loads(raw) if raw else None

def command(engine, prompt, model=None):
    if engine == 'agy-ssh':
        remote_command = 'cd /home/jhulio/hackuc/angibell-worker/repo && export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus && exec /home/jhulio/.local/bin/agy --sandbox --mode accept-edits --print-timeout 18m -p ' + shlex.quote(prompt)
        return ['/usr/bin/ssh', '-i', str(BASE / '.state/ssh/id_ed25519'), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=yes', 'jhulio@172.16.5.29', remote_command]
    if engine == 'agy':
        return ['/home/blink/.local/bin/agy', '--sandbox', '--mode', 'accept-edits',
                '--print-timeout', '18m', '-p', prompt]
    if not model:
        raise ValueError('El worker OpenCode requiere proveedor/modelo explícito.')
    return ['/home/blink/.opencode/bin/opencode', 'run', '--pure', '--format', 'default', '--dir', str(Path.cwd()), '--model', model, prompt]

def run(args):
    workspaces = json.loads((BASE / '.state/workspaces.json').read_text())
    os.chdir(workspaces[args.role])
    aid, cid = os.environ['PAPERCLIP_AGENT_ID'], os.environ['PAPERCLIP_COMPANY_ID']
    issues = api('GET', '/companies/' + cid + '/issues?assigneeAgentId=' + aid + '&status=todo,in_progress')
    issues = [i for i in issues if i.get('assigneeAgentId') == aid and i.get('status') in ('todo', 'in_progress')]
    if not issues:
        print('Sin tareas ejecutables asignadas. No se inició ningún modelo.')
        return
    if len(issues) != 1:
        raise RuntimeError('Asignar una única tarea al worker antes de ejecutarlo.')
    issue = issues[0]
    iid = issue['id']
    api('POST', '/issues/' + iid + '/checkout', {'agentId': aid, 'expectedStatuses': ['todo', 'in_progress']})
    instructions = (BASE / 'agents' / (args.role + '.md')).read_text()
    prompt = instructions + '\n\n# Tarea asignada\n' + issue['title'] + '\n' + (issue.get('description') or '')
    prompt += '''\n\nEl puente gestiona checkout y estados de Paperclip: no cambies otras tareas ni adaptadores.
Lee el plan maestro y AGENTS.md en este worktree. Trabaja solo dentro de él.
No hagas merge, push, despliegue ni publicaciones externas. No imprimas secretos.
Entrega resumen, commit y pruebas con resultados. Si hay bloqueo, descríbelo claramente.
Escribe ANGIBELL_ENTREGA_COMPLETA al final únicamente si completaste la tarea y su validación.
El puente enviará tu entrega a revisión; no se considera integración ni aprobación humana.
'''
    env = {k: v for k, v in os.environ.items() if not k.startswith('PAPERCLIP_')}
    env['PWD'] = str(Path.cwd())
    if args.engine == 'opencode':
        # Scope MCP disabling to these workers; preserve the user's global config.
        cfg = Path('/home/blink/.config/opencode/opencode.jsonc')
        global_config = json.loads(cfg.read_text()) if cfg.exists() else {}
        config_content = {
            'mcp': {key: {'enabled': False} for key in global_config.get('mcp', {})},
            'small_model': args.model,
        }
        if args.model and 'nvidia' in args.model:
            config_content['provider'] = {'nvidia': {'options': {'timeout': 300000}}}
        env['OPENCODE_CONFIG_CONTENT'] = json.dumps(config_content)
    # One local agy turn at a time to avoid sharing its account/session concurrently.
    with (BASE / '.state' / (args.engine + '.lock')).open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        api('POST', '/issues/' + iid + '/comments', {'body': 'Iniciando worker ' + args.engine + ' en rama aislada; entrega sujeta a revisión del PM.'})
        proc = subprocess.Popen(command(args.engine, prompt, args.model), stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
                                start_new_session=True)
        def stop(signum, frame):
            os.killpg(proc.pid, signal.SIGTERM)
            raise SystemExit(128 + signum)
        for sig in (signal.SIGTERM, signal.SIGINT): signal.signal(sig, stop)
        try:
            out, err = proc.communicate(timeout=1120)
            complete = proc.returncode == 0 and SUCCESS in out and 'print timeout' not in err.lower()
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            out, err = proc.communicate()
            complete = False
        # Credential values never enter the prompt; redact any accidental echo.
        token = os.environ.get('PAPERCLIP_API_KEY', '')
        if token:
            out, err = out.replace(token, '[REDACTED]'), err.replace(token, '[REDACTED]')
        report = out[-24000:].strip() or 'El ejecutor no devolvió una entrega.'
        if not complete:
            report = 'Worker bloqueado o entrega incompleta. No se declara la tarea terminada.\n\n' + report
            if err.strip(): report += '\n\nDiagnóstico:\n' + err[-4000:]
        # Completed work remains isolated in its role branch. Mark the execution
        # done so dependency scheduling can continue; the PM still reviews the
        # branch before any integration, merge, push, or deployment.
        update = {'status': 'done' if complete else 'blocked', 'comment': report}
        if not complete:
            update['unblockDescriptor'] = {
                'owner': {'agentId': aid},
                'action': 'Revisar el diagnóstico del worker, corregirlo y volver a ejecutar esta tarea.',
            }
        api('PATCH', '/issues/' + iid, update)
        print(report)
        print('Estado: ' + ('done' if complete else 'blocked'))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('role', choices=['coordinador', 'backend', 'frontend', 'integraciones', 'qa', 'remoto'])
    parser.add_argument('--engine', choices=['agy', 'opencode', 'agy-ssh'], required=True)
    parser.add_argument('--model')
    args = parser.parse_args()
    try: run(args)
    except HTTPError as exc:
        # Paperclip returns actionable, non-secret authorization guidance in its
        # JSON error body. Keep it bounded and redact the run credential so a
        # failed adapter run can be diagnosed from its own log.
        detail = exc.read(4000).decode('utf-8', errors='replace').strip()
        token = os.environ.get('PAPERCLIP_API_KEY', '')
        if token:
            detail = detail.replace(token, '[REDACTED]')
        message = 'Error HTTP del puente: ' + str(exc.code) + ' en ' + exc.url.split('/api',1)[-1]
        if detail:
            message += '\n' + detail
        print(message, file=sys.stderr)
        raise SystemExit(1)
    except Exception as exc:
        print('Error de puente: ' + type(exc).__name__, file=sys.stderr)
        raise SystemExit(1)
