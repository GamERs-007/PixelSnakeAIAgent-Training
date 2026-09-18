"""Relocation and bootstrap regressions; no dependency downloads during tests."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch, Mock
import urllib.request
from http.server import ThreadingHTTPServer

import run_local
from rl.web_server import LocalApp, Handler


class PortableStartupTests(unittest.TestCase):
    def test_broken_copied_environment_is_preserved_and_rebuilt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'moved project'
            old = root / '.venv'
            old.mkdir(parents=True)
            (old / 'pyvenv.cfg').write_text('old-machine')
            with patch.object(run_local, 'python_works', side_effect=[False, True]), \
                 patch.object(run_local.subprocess, 'run', return_value=Mock(returncode=0)) as run:
                python = run_local.prepare_environment(root)
            backups = list(root.glob('.venv-backup-*'))
            self.assertEqual(len(backups), 1)
            self.assertEqual((backups[0] / 'pyvenv.cfg').read_text(), 'old-machine')
            self.assertEqual(run.call_args_list[0].args[0][1:3], ['-m', 'venv'])
            self.assertEqual(python.parent.parent, old)

    def test_missing_dependencies_install_from_project_requirements(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(run_local, 'python_works', return_value=True), \
                 patch.object(run_local.subprocess, 'run', side_effect=[Mock(returncode=1), Mock(returncode=0)]) as run:
                run_local.prepare_environment(root)
            self.assertEqual(run.call_args.args[0][-3:], ['install', '-r', str(root/'rl/requirements.txt')])
            self.assertEqual(run.call_args.kwargs['cwd'], root)

    def test_launcher_starts_from_its_own_root(self):
        with patch.object(run_local, 'existing_server', return_value=False), \
             patch.object(run_local, 'prepare_environment', return_value=Path(sys.executable)), \
             patch.object(run_local.subprocess, 'call', return_value=0) as call:
            self.assertEqual(run_local.main(['--port', '9876', '--no-browser']), 0)
        self.assertEqual(call.call_args.kwargs['cwd'], run_local.ROOT)
        self.assertEqual(call.call_args.args[0][-2:], ['--port', '9876'])

    def test_existing_server_reuse_requires_matching_project_root(self):
        with tempfile.TemporaryDirectory() as directory:
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            server.app = LocalApp(directory)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                port = server.server_address[1]
                self.assertTrue(run_local.existing_server(port, directory))
                self.assertFalse(run_local.existing_server(port, Path(directory)/'another-copy'))
            finally:
                server.shutdown(); server.server_close(); thread.join()

    def test_real_models_load_after_copy_to_unicode_path_from_unrelated_cwd(self):
        original = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / '另一台电脑 Pixel Snake'
            copied.mkdir()
            shutil.copytree(original/'rl', copied/'rl', ignore=shutil.ignore_patterns('__pycache__'))
            shutil.copytree(original/'models', copied/'models')
            shutil.copy2(original/'run_local.py', copied/'run_local.py')
            shutil.copy2(original/'index.html', copied/'index.html')
            # A fresh interpreter imports only the relocated project's sources.
            code = '''
import json
from pathlib import Path
from rl.web_server import LocalApp, ROOT
app = LocalApp()
models = app.list_models()
assert len(models) == 3, models
for model in models:
    exported = app.browser_model({'model': model['name']})
    assert exported['format'] == 'snake-dqn-dense-v1'
assert ROOT == Path(__import__('sys').argv[1])
print(json.dumps([model['name'] for model in models]))
'''
            env = {**os.environ, 'PYTHONPATH': str(copied), 'PYTHONDONTWRITEBYTECODE': '1'}
            result = subprocess.run([sys.executable, '-B', '-c', code, str(copied)],
                                    cwd=directory, env=env, capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(len(json.loads(result.stdout)), 3)


if __name__ == '__main__':
    unittest.main()
