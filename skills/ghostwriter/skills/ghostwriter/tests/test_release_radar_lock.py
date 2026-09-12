"""OS lock behavior: contention, descriptor inheritance, and stale-file recovery."""
import fcntl
import release_radar_lock as runner


def test_lock_is_held_and_inherited_until_child_finishes(tmp_path, monkeypatch):
    calls = []

    def child(command, pass_fds):
        calls.append(command)
        assert len(pass_fds) == 1
        # Opening the same file independently must fail while the wrapper runs.
        with (tmp_path / 'research/.radar-lock').open('a') as competing:
            try:
                fcntl.flock(competing, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return 0
        raise AssertionError('Child ran without an exclusive lock')

    monkeypatch.setattr(runner.subprocess, 'call', child)
    assert runner.run(tmp_path) == 0
    assert calls[0][-3:] == ['--backend', 'claude', '--lock-held']
    assert runner.run(tmp_path) == 0  # existing lock file does not block a retry


def test_contending_runner_does_not_launch(tmp_path, monkeypatch, capsys):
    research = tmp_path / 'research'
    research.mkdir()
    with (research / '.radar-lock').open('a') as active:
        fcntl.flock(active, fcntl.LOCK_EX | fcntl.LOCK_NB)
        monkeypatch.setattr(runner.subprocess, 'call', lambda *a, **k: (_ for _ in ()).throw(
            AssertionError('A second model run must not start')))
        assert runner.run(tmp_path) == 1
    assert 'already running' in capsys.readouterr().err
