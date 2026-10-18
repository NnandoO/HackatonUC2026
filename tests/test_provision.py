import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('provision', ROOT / 'provision.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

class ProvisionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        (self.base / '.state').mkdir()
        paths = {role: '/worktrees/' + role for role in p.ROLES}
        (self.base / '.state/workspaces.json').write_text(json.dumps(paths))
        (self.base / 'tasks.json').write_text((ROOT / 'tasks.json').read_text())
        self.tables = {'/companies': []}
        self.calls = []
        self.base_patch = patch.object(p, 'BASE', self.base)
        self.api_patch = patch.object(p, 'api', self.fake_api)
        self.base_patch.start()
        self.api_patch.start()
    def tearDown(self):
        self.api_patch.stop()
        self.base_patch.stop()
        self.temp.cleanup()
    def fake_api(self, method, path, body=None):
        self.calls.append((method, path, body))
        path = path.split('?')[0]
        if path == '/health':
            return {'status': 'ok', 'deploymentMode': 'local_trusted'}
        if method == 'GET':
            if path in self.tables:
                return self.tables[path]
            for rows in self.tables.values():
                for item in rows:
                    if path.endswith('/' + item['id']):
                        return item
            self.tables[path] = []
            return []
        if method == 'POST':
            item = dict(body, id=str(uuid4()))
            self.tables.setdefault(path, []).append(item)
            return item
        if method == 'PATCH':
            for rows in self.tables.values():
                for item in rows:
                    if path.endswith('/' + item['id']):
                        item.update(body)
                        return item
            raise AssertionError('Unknown PATCH ' + path)
        raise AssertionError(method)
    def test_repeat_does_not_duplicate_or_wake(self):
        p.provision()
        count = len([c for c in self.calls if c[0] == 'POST'])
        p.provision()
        self.assertEqual(count, len([c for c in self.calls if c[0] == 'POST']))
        self.assertFalse(any(c[0] == 'PATCH' and c[1].startswith('/issues/') for c in self.calls))
        self.assertEqual(count, 18)  # company + 5 agents + project + 5 workspaces + 6 issues
    def test_dependencies_are_real_issue_ids(self):
        p.provision()
        state = json.loads((self.base / '.state/provision.json').read_text())
        issues = next(rows for key, rows in self.tables.items() if key.endswith('/issues'))
        qa = next(i for i in issues if '[ANGIBELL:verificacion]' in i['title'])
        self.assertEqual(qa['blockedByIssueIds'], [state['issues'][k] for k in ['comercio', 'tienda', 'canales']])
        self.assertTrue(all(i['status'] == 'backlog' and 'assigneeAgentId' not in i for i in issues))
    def test_start_only_assigns_contracts_once(self):
        p.provision(start=True)
        p.provision(start=True)
        assignments = [c for c in self.calls if c[0] == 'PATCH' and c[1].startswith('/issues/')]
        self.assertEqual(len(assignments), 1)
        self.assertEqual(assignments[0][2]['status'], 'todo')
    def test_no_sandbox_bypass_or_model_override(self):
        for role in p.ROLES:
            payload = p.agent_payload(role, '/worktrees/' + role)
            config = payload['adapterConfig']
            if role == 'coordinador':
                self.assertFalse(config['dangerouslyBypassApprovalsAndSandbox'])
                self.assertEqual(config['engine'], 'cli')
                self.assertEqual(payload['adapterType'], 'codex_local')
            else:
                self.assertEqual(payload['adapterType'], 'process')
                self.assertIn('--engine', config['args'])
                self.assertNotIn('codex', ' '.join(config['args']))
            self.assertNotIn('model', config)
            self.assertFalse(payload['runtimeConfig']['heartbeat']['enabled'])
            self.assertFalse(payload['permissions']['canCreateAgents'])

if __name__ == '__main__': unittest.main()
