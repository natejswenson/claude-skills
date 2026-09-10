#!/usr/bin/env python3
"""Exercise Codex marketplace discovery and installation in an isolated home."""

import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile


VERSION_PATTERN = re.compile(r'(?<![\w.])\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?(?![\w.])')


class SmokeError(RuntimeError):
    pass


def display_command(command):
    return shlex.join(str(part) for part in command)


def run_command(command, environment, repo_root):
    rendered = display_command(command)
    try:
        result = subprocess.run(
            command,
            cwd=repo_root,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as error:
        raise SmokeError(
            f'Codex command could not start: {rendered}\n'
            f'error: {error}'
        ) from error

    print(f'$ {rendered}')
    print(f'exit status: {result.returncode}')
    print(f'stdout:\n{result.stdout.rstrip() or "(empty)"}')
    print(f'stderr:\n{result.stderr.rstrip() or "(empty)"}')
    if result.returncode:
        raise SmokeError(
            f'Codex command failed: {rendered}\n'
            f'exit status: {result.returncode}\n'
            f'stdout:\n{result.stdout.rstrip() or "(empty)"}\n'
            f'stderr:\n{result.stderr.rstrip() or "(empty)"}'
        )
    return result


def run_json(command, environment, repo_root):
    result = run_command(command, environment, repo_root)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise SmokeError(
            f'Codex command returned invalid JSON: {display_command(command)}\n'
            f'error: {error}'
        ) from error


def catalog(repo_root):
    path = repo_root / '.claude-plugin/marketplace.json'
    try:
        manifest = json.loads(path.read_text())
        marketplace = manifest['name']
        plugins = manifest['plugins']
        names = [plugin['name'] for plugin in plugins]
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise SmokeError(f'Unable to read marketplace catalog {path}: {error}') from error
    if not isinstance(marketplace, str) or not names or any(not isinstance(name, str) for name in names):
        raise SmokeError(f'Invalid marketplace catalog: {path}')
    if len(names) != len(set(names)):
        raise SmokeError(f'Duplicate plugin name in marketplace catalog: {path}')
    return marketplace, names


def plugin_names(payload, field, expected, command):
    entries = payload.get(field) if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        raise SmokeError(
            f'Codex command returned no {field} list: {display_command(command)}'
        )
    names = [entry.get('name') if isinstance(entry, dict) else None for entry in entries]
    if len(names) != len(expected) or set(names) != set(expected):
        missing = sorted(set(expected) - set(names))
        extra = sorted(set(names) - set(expected))
        raise SmokeError(
            f'{field} plugin set mismatch for {display_command(command)}: '
            f'missing={missing!r}, extra={extra!r}'
        )
    return entries


def run_smoke(repo_root, codex, expected_version=None):
    repo_root = repo_root.resolve()
    marketplace, expected_plugins = catalog(repo_root)
    with tempfile.TemporaryDirectory(prefix='codex-marketplace-smoke-') as home:
        environment = os.environ.copy()
        environment['CODEX_HOME'] = home

        version_command = [codex, '--version']
        version_result = run_command(version_command, environment, repo_root)
        version_output = f'{version_result.stdout}\n{version_result.stderr}'.strip()
        version_match = VERSION_PATTERN.search(version_output)
        actual_version = version_match.group(0) if version_match else 'unknown'
        print(f'Codex CLI version: {actual_version}')
        if expected_version and actual_version != expected_version:
            raise SmokeError(
                f'Codex CLI version mismatch for {display_command(version_command)}: '
                f'expected {expected_version}, got {version_output!r}'
            )

        marketplace_command = [codex, 'plugin', 'marketplace', 'add', str(repo_root)]
        run_command(marketplace_command, environment, repo_root)

        available_command = [
            codex, 'plugin', 'list', '--available', '--json', '--marketplace', marketplace,
        ]
        available_payload = run_json(available_command, environment, repo_root)
        available_entries = plugin_names(available_payload, 'available', expected_plugins, available_command)
        print(f'Discovered {len(available_entries)} plugins in {marketplace}.')

        for name in expected_plugins:
            install_command = [codex, 'plugin', 'add', f'{name}@{marketplace}']
            try:
                run_command(install_command, environment, repo_root)
            except SmokeError as error:
                raise SmokeError(f'Plugin install failed for {name}:\n{error}') from error

        installed_command = [codex, 'plugin', 'list', '--json', '--marketplace', marketplace]
        installed_payload = run_json(installed_command, environment, repo_root)
        installed_entries = plugin_names(installed_payload, 'installed', expected_plugins, installed_command)
        for entry in installed_entries:
            name = entry.get('name')
            if entry.get('installed') is not True:
                raise SmokeError(
                    f'Plugin {name} failed installed=true check from '
                    f'{display_command(installed_command)}'
                )
            if entry.get('enabled') is not True:
                raise SmokeError(
                    f'Plugin {name} failed enabled=true check from '
                    f'{display_command(installed_command)}'
                )
        print(f'Installed and enabled {len(installed_entries)} plugins in {marketplace}.')


def parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--repo-root',
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help='repository containing .claude-plugin/marketplace.json',
    )
    parser.add_argument('--codex', default='codex', help='Codex executable')
    parser.add_argument('--expected-version', help='fail unless codex --version reports this version')
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    try:
        run_smoke(args.repo_root, args.codex, args.expected_version)
    except SmokeError as error:
        print(f'ERROR: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
