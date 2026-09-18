"""Portable local launcher. Uses only the standard library until setup completes."""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
import webbrowser

ROOT = Path(__file__).resolve().parent


def python_works(executable):
    try:
        return subprocess.run(
            [str(executable), '-c', 'import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15,
        ).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def prepare_environment(root=ROOT):
    """Reuse a working environment; preserve and replace broken copied environments."""
    root = Path(root).resolve()
    environment = root / '.venv'
    python = environment / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if not python_works(python):
        base = getattr(sys, '_base_executable', sys.executable)
        if not python_works(base):
            raise RuntimeError('Install Python 3.12 or newer, then run the launcher again.')
        if environment.exists():
            backup = root / ('.venv-backup-' + datetime.now().strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:6])
            environment.rename(backup)
            print(f'Preserved the unusable environment as {backup.name}', flush=True)
        print('Creating a Python environment in this project...', flush=True)
        subprocess.run([base, '-m', 'venv', str(environment)], check=True, cwd=root)
    check = subprocess.run([str(python), '-c', 'import gymnasium, numpy, torch, matplotlib'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=root)
    if check.returncode:
        print('Installing project dependencies. First setup needs internet and may take several minutes.', flush=True)
        subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(root / 'rl/requirements.txt')],
                       check=True, cwd=root)
    return python


def existing_server(port, root=ROOT):
    """Only reuse a server that identifies this exact project directory."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(f'http://127.0.0.1:{port}/api/health', timeout=2) as response:
            health = json.load(response)
        return (isinstance(health, dict) and health.get('project') == 'PixelSnake'
                and Path(health.get('root', '')).resolve() == Path(root).resolve())
    except (OSError, ValueError, urllib.error.URLError):
        return False


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error('Port must be 1..65535')
    url = f'http://127.0.0.1:{args.port}'
    if existing_server(args.port):
        print(f'PixelSnake is already running from this folder: {url}', flush=True)
        if not args.no_browser:
            webbrowser.open(url)
        return 0
    python = prepare_environment()
    command = [str(python), '-B', '-m', 'rl.web_server', '--port', str(args.port)]
    if not args.no_browser:
        command.append('--open-browser')
    print(f'Project: {ROOT}\nKeep this terminal open while playing. Ctrl+C stops the service.', flush=True)
    return subprocess.call(command, cwd=ROOT)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        pass
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'PixelSnake startup failed: {error}', file=sys.stderr)
        raise SystemExit(1)
