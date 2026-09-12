import json
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / 'tools/codex_marketplace_smoke.py'
MARKETPLACE = json.loads((ROOT / '.claude-plugin/marketplace.json').read_text())
PLUGIN_NAMES = [entry['name'] for entry in MARKETPLACE['plugins']]
RUNNER_SPEC = importlib.util.spec_from_file_location('codex_marketplace_smoke', RUNNER)
SMOKE = importlib.util.module_from_spec(RUNNER_SPEC)
RUNNER_SPEC.loader.exec_module(SMOKE)


FAKE_CODEX = r'''#!/usr/bin/env python3
import json
import os
import sys


args = sys.argv[1:]
with open(os.environ['FAKE_LOG'], 'a', encoding='utf-8') as handle:
    handle.write(json.dumps({'home': os.environ.get('CODEX_HOME'), 'args': args}) + '\n')

names = json.loads(os.environ['FAKE_PLUGINS'])
if args == ['--version']:
    print(os.environ.get('FAKE_VERSION', 'codex-cli 0.153.4'))
elif args[:3] == ['plugin', 'marketplace', 'add']:
    print('marketplace added')
elif args[:2] == ['plugin', 'list'] and '--available' in args:
    available = json.loads(os.environ.get('FAKE_AVAILABLE', json.dumps(names)))
    print(json.dumps({'installed': [], 'available': [
        {'name': name, 'installed': False, 'enabled': False} for name in available
    ]}))
elif args[:2] == ['plugin', 'add']:
    plugin = args[2].split('@', 1)[0]
    if plugin == os.environ.get('FAKE_FAIL_PLUGIN'):
        print('simulated install failure', file=sys.stderr)
        sys.exit(7)
    print('plugin added')
elif args[:2] == ['plugin', 'list']:
    disabled = os.environ.get('FAKE_DISABLED_PLUGIN')
    print(json.dumps({'installed': [
        {'name': name, 'installed': True, 'enabled': name != disabled} for name in names
    ]}))
else:
    print(f'unexpected command: {args}', file=sys.stderr)
    sys.exit(2)
'''


class CodexMarketplaceSmokeTests(unittest.TestCase):
    def make_fake_codex(self, directory):
        path = Path(directory) / 'fake-codex'
        path.write_text(FAKE_CODEX)
        path.chmod(0o755)
        return path

    def run_runner(self, fake_codex, log, **overrides):
        environment = os.environ.copy()
        environment.update({
            'CODEX_HOME': '/tmp/real-codex-home-must-not-be-used',
            'FAKE_LOG': str(log),
            'FAKE_PLUGINS': json.dumps(PLUGIN_NAMES),
        })
        environment.update(overrides)
        return subprocess.run(
            [sys.executable, str(RUNNER), '--repo-root', str(ROOT),
             '--codex', str(fake_codex), '--expected-version', '0.153.4'],
            env=environment,
            capture_output=True,
            text=True,
        )

    def test_success_uses_temporary_home_and_checks_every_plugin(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'commands.jsonl'
            fake_codex = self.make_fake_codex(directory)
            result = self.run_runner(fake_codex, log)

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            commands = [json.loads(line) for line in log.read_text().splitlines()]
            self.assertTrue(commands)
            homes = {command['home'] for command in commands}
            self.assertEqual(len(homes), 1)
            temporary_home = homes.pop()
            self.assertNotEqual(temporary_home, '/tmp/real-codex-home-must-not-be-used')
            self.assertFalse(Path(temporary_home).exists())
            installed = [command['args'][2].split('@', 1)[0] for command in commands
                         if command['args'][:2] == ['plugin', 'add']]
            self.assertEqual(installed, PLUGIN_NAMES)
            self.assertGreaterEqual(len(PLUGIN_NAMES), 20)
            self.assertIn(f'{len(PLUGIN_NAMES)} plugins', result.stdout)

    def test_missing_or_extra_discovery_entry_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'commands.jsonl'
            fake_codex = self.make_fake_codex(directory)
            available = PLUGIN_NAMES[1:] + ['unexpected']
            result = self.run_runner(fake_codex, log, FAKE_AVAILABLE=json.dumps(available))

            self.assertNotEqual(result.returncode, 0)
            self.assertIn('available plugin set mismatch', result.stdout + result.stderr)
            self.assertIn('unexpected', result.stdout + result.stderr)

    def test_duplicate_discovery_entry_fails_when_another_plugin_is_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'commands.jsonl'
            fake_codex = self.make_fake_codex(directory)
            available = PLUGIN_NAMES.copy()
            available[1] = available[0]
            result = self.run_runner(fake_codex, log, FAKE_AVAILABLE=json.dumps(available))

            self.assertNotEqual(result.returncode, 0)
            output = result.stdout + result.stderr
            self.assertIn('available plugin set mismatch', output)
            self.assertIn(PLUGIN_NAMES[1], output)

    def test_malformed_discovery_name_reports_mismatch_without_type_error(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'commands.jsonl'
            fake_codex = self.make_fake_codex(directory)
            available = PLUGIN_NAMES[1:] + [None, 'unexpected']
            result = self.run_runner(fake_codex, log, FAKE_AVAILABLE=json.dumps(available))

            self.assertNotEqual(result.returncode, 0)
            output = result.stdout + result.stderr
            self.assertIn('available plugin set mismatch', output)
            self.assertIn('None', output)
            self.assertIn('unexpected', output)
            self.assertNotIn('TypeError', output)

    def test_codex_command_timeout_identifies_command(self):
        command = ['codex', 'plugin', 'add', 'ghostwriter@claude-skills']
        timeout = subprocess.TimeoutExpired(command, SMOKE.COMMAND_TIMEOUT_SECONDS)
        with mock.patch.object(SMOKE.subprocess, 'run', side_effect=timeout) as run:
            with self.assertRaises(SMOKE.SmokeError) as raised:
                SMOKE.run_command(command, {}, ROOT)

        self.assertIn('timed out', str(raised.exception))
        self.assertIn('plugin add ghostwriter@claude-skills', str(raised.exception))
        self.assertEqual(run.call_args.kwargs['timeout'], SMOKE.COMMAND_TIMEOUT_SECONDS)

    def test_plugin_specific_install_failure_identifies_plugin_and_command(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'commands.jsonl'
            fake_codex = self.make_fake_codex(directory)
            result = self.run_runner(fake_codex, log, FAKE_FAIL_PLUGIN='ghostwriter')

            self.assertNotEqual(result.returncode, 0)
            output = result.stdout + result.stderr
            self.assertIn('ghostwriter', output)
            self.assertIn('plugin add ghostwriter@claude-skills', output)

    def test_disabled_post_install_entry_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'commands.jsonl'
            fake_codex = self.make_fake_codex(directory)
            result = self.run_runner(fake_codex, log, FAKE_DISABLED_PLUGIN='appletv')

            self.assertNotEqual(result.returncode, 0)
            self.assertIn('appletv', result.stdout + result.stderr)
            self.assertIn('enabled=true', result.stdout + result.stderr)

    def test_cli_version_mismatch_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'commands.jsonl'
            fake_codex = self.make_fake_codex(directory)
            result = self.run_runner(fake_codex, log, FAKE_VERSION='codex-cli 9.9.9')

            self.assertNotEqual(result.returncode, 0)
            output = result.stdout + result.stderr
            self.assertIn('Codex CLI version mismatch', output)
            self.assertIn('0.153.4', output)
            self.assertIn('9.9.9', output)


if __name__ == '__main__':
    unittest.main()
