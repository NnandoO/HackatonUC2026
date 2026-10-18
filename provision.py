"""Provision a local Paperclip company; no tokens or credentials persisted here."""
import argparse
import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = Path(__file__).resolve().parent
URL = 'http://127.0.0.1:3100'
COMPANY = 'SORYNTEL · ANGIBELL 360'
ROLES = {'coordinador': 'cto', 'backend': 'engineer', 'frontend': 'engineer',
         'integraciones': 'engineer', 'qa': 'qa'}

def api(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = Request(URL + '/api' + path, data=data, method=method,
                  headers={'Content-Type': 'application/json'})
    with urlopen(req, timeout=15) as response:
        raw = response.read()
        return json.loads(raw) if raw else None

def save(state):
    path = BASE / '.state' / 'provision.json'
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(state, indent=2) + '\n')
    os.chmod(temp, 0o600)
    temp.replace(path)

def get_or_create(path, name, payload):
    matches = [item for item in api('GET', path) if item.get('name') == name]
    if len(matches) > 1:
        raise RuntimeError('Nombre duplicado; resolver manualmente: ' + name)
    return matches[0] if matches else api('POST', path, payload)

def agent_payload(role, cwd, lead_id=None):
    adapter_type = 'process'
    engine = 'opencode'
    args = [str(BASE / 'worker.py'), role, '--engine', engine, '--model', 'nvidia/nvidia/nemotron-3.5-lightning-30b-a3b']
    adapter = {'cwd': cwd, 'command': '/usr/bin/python3', 'args': args,
               'timeoutSec': 2400, 'graceSec': 20}
    return {
        'name': 'ANGIBELL ' + role, 'role': ROLES[role],
        'title': 'PM' if role == 'coordinador' else role.capitalize(),
        'reportsTo': lead_id, 'adapterType': adapter_type, 'adapterConfig': adapter,
        'runtimeConfig': {'heartbeat': {'enabled': False, 'wakeOnDemand': False, 'maxConcurrentRuns': 1}},
        'permissions': {'canCreateAgents': False},
        'budgetMonthlyCents': 1000 if role == 'coordinador' else 500,
    }

def provision(start=False):
    state_path = BASE / '.state' / 'provision.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    workspaces = json.loads((BASE / '.state' / 'workspaces.json').read_text())
    health = api('GET', '/health')
    if health.get('deploymentMode') not in (None, 'local_trusted'):
        raise RuntimeError('Este bootstrap requiere instancia local_trusted aislada.')
    if 'companyId' not in state:
        # Refuse to adopt a potentially unrelated company with the same name.
        if any(c.get('name') == COMPANY for c in api('GET', '/companies')):
            raise RuntimeError('Compañía existente sin estado local. Revisar antes de adoptar.')
        company = api('POST', '/companies', {
            'name': COMPANY,
            'description': 'Desarrollo de ANGIBELL 360 conforme al plan maestro v2; revisión humana SORYNTEL.',
            'budgetMonthlyCents': 1000,
        })
        state['companyId'] = company['id']
        save(state)
    cid = state['companyId']
    company = api('GET', '/companies/' + cid)
    if company['name'] != COMPANY:
        raise RuntimeError('La compañía guardada no coincide.')
    state.setdefault('agents', {})
    if any(role not in state['agents'] for role in ROLES):
        # The user authorized these five initial hires. Restore governance even
        # if a request fails; no worker can run during this bootstrap.
        api('PATCH', '/companies/' + cid, {'requireBoardApprovalForNewAgents': False})
        try:
            for role in ROLES:
                if role not in state['agents']:
                    payload = agent_payload(role, workspaces[role], state['agents'].get('coordinador'))
                    agent = get_or_create('/companies/' + cid + '/agents', payload['name'], payload)
                    state['agents'][role] = agent['id']
                    save(state)
        finally:
            api('PATCH', '/companies/' + cid, {'requireBoardApprovalForNewAgents': True})
    if 'projectId' not in state:
        project = get_or_create('/companies/' + cid + '/projects', 'ANGIBELL 360 · Demo', {
            'name': 'ANGIBELL 360 · Demo',
            'description': 'Contratos primero; tareas delimitadas; ramas aisladas; sin publicación externa.',
            'leadAgentId': state['agents']['coordinador'],
            'status': 'planned',
        })
        state['projectId'] = project['id']
        save(state)
    state.setdefault('workspaces', {})
    for role in ROLES:
        if role not in state['workspaces']:
            workspace = get_or_create('/projects/' + state['projectId'] + '/workspaces', 'worktree-' + role, {
                'name': 'worktree-' + role, 'cwd': workspaces[role],
                'sourceType': 'local_path', 'isPrimary': role == 'coordinador',
            })
            state['workspaces'][role] = workspace['id']
            save(state)
    state.setdefault('issues', {})
    tasks = json.loads((BASE / 'tasks.json').read_text())
    for task in tasks:
        if task['key'] in state['issues']:
            continue
        title = '[ANGIBELL:' + task['key'] + '] ' + task['title']
        # GET filtered by project, then match titles: safe retry after interrupted POST.
        existing = api('GET', '/companies/' + cid + '/issues?projectId=' + state['projectId'])
        matches = [i for i in existing if i.get('title') == title]
        if len(matches) > 1:
            raise RuntimeError('Issue duplicada: ' + title)
        issue = matches[0] if matches else api('POST', '/companies/' + cid + '/issues', {
            'title': title,
            'description': task['description'] + '\n\nResponsable previsto: ' + task['owner']
                + '\nWorktree: ' + workspaces[task['owner']]
                + '\nDependencias: ' + (', '.join(task['dependsOn']) or 'ninguna')
                + '\nActivar solamente al resolver dependencias. Ver instrucciones del rol.',
            'status': 'backlog',
            'priority': 'high',
            'projectId': state['projectId'],
            'projectWorkspaceId': state['workspaces'][task['owner']],
            'blockedByIssueIds': [state['issues'][k] for k in task['dependsOn']],
        })
        state['issues'][task['key']] = issue['id']
        save(state)
    if start and not state.get('started'):
        # Enable assignment-driven runs; periodic autonomous heartbeats remain disabled.
        for agent_id in state['agents'].values():
            api('PATCH', '/agents/' + agent_id, {
                'runtimeConfig': {'heartbeat': {'enabled': False,
                                               'wakeOnDemand': True,
                                               'maxConcurrentRuns': 1}},
            })
        api('PATCH', '/issues/' + state['issues']['contratos'], {
            'assigneeAgentId': state['agents']['coordinador'], 'status': 'todo',
        })
        state['started'] = True
        save(state)
    print('Compañía: ' + COMPANY)
    print('Agentes: ' + ', '.join(state['agents']))
    print('Tareas: ' + str(len(state['issues'])))
    print('Coordinador activado por asignación.' if state.get('started') else
          'Configurado sin ejecuciones. Para iniciar: python3 provision.py --start')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--health', action='store_true')
    parser.add_argument('--start', action='store_true')
    args = parser.parse_args()
    try:
        if args.health:
            health = api('GET', '/health')
            if health.get('status') != 'ok':
                raise RuntimeError('Health no está OK.')
        else:
            provision(args.start)
    except (OSError, HTTPError, URLError, ValueError, KeyError, RuntimeError) as exc:
        # Do not print response bodies, environment, or auth material.
        print('No se pudo completar la configuración: ' + type(exc).__name__)
        if isinstance(exc, HTTPError):
            print('HTTP ' + str(exc.code) + '. Revisar compatibilidad/autenticación del servidor.')
        elif isinstance(exc, RuntimeError):
            print(str(exc))
        raise SystemExit(1)
if __name__ == '__main__': main()
