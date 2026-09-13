"""Regression checks simulate OS failures; never signal a live process."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('process_identity', Path(__file__).parents[1] / 'lib/process_identity.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
EXPECTED = dict(pid=43210, uid=501, started='12.345678', executable='/test/worker', host='test', platform='darwin', zombie=False)


class OutcomeTests(unittest.TestCase):
    def outcome(self, observed):
        with patch.object(mod, 'protect'), patch.object(mod.sys, 'platform', 'darwin'), \
                patch.object(mod.os, 'kill') as kill, patch.object(mod, 'identity', side_effect=[EXPECTED, observed]):
            result = mod.terminate(EXPECTED, 'TERM')
            kill.assert_called_once_with(EXPECTED['pid'], mod.signal.SIGTERM)
            return result

    def test_exec_is_still_running(self):
        result = self.outcome({**EXPECTED, 'executable': '/test/other'})
        self.assertEqual(result['result'], 'still-running')
        self.assertTrue(result['identity_changed'])

    def test_pid_replacement(self):
        self.assertEqual(self.outcome({**EXPECTED, 'started': '99.000001'})['result'], 'original-process-gone')

    def test_confirmed_exit(self):
        self.assertEqual(self.outcome(ProcessLookupError('gone'))['result'], 'exited')

    def test_permission_loss_is_not_exit(self):
        with self.assertRaises(PermissionError):
            self.outcome(PermissionError('kernel identity unreadable'))

    def test_changed_target_never_gets_signal(self):
        with patch.object(mod, 'protect'), patch.object(mod.sys, 'platform', 'darwin'), \
                patch.object(mod.os, 'kill') as kill, patch.object(mod, 'identity', return_value={**EXPECTED, 'started': 'other'}):
            with self.assertRaisesRegex(ValueError, 'identity changed'):
                mod.terminate(EXPECTED, 'TERM')
            kill.assert_not_called()

    def test_root_or_other_user_rejected(self):
        with patch.object(mod.os, 'geteuid', return_value=501):
            for uid in (0, 502):
                with self.assertRaisesRegex(ValueError, 'root or another'):
                    mod.protect({**EXPECTED, 'uid': uid})


if __name__ == '__main__':
    unittest.main()
