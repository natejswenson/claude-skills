#!/usr/bin/env python3
"""Hold an OS-managed lock while the legacy shell runner stages and promotes."""
from pathlib import Path
import fcntl
import subprocess
import sys


def run(bundle: Path) -> int:
    research = bundle / 'research'
    research.mkdir(parents=True, exist_ok=True)
    with (research / '.radar-lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Radar already running; try again when it finishes.', file=sys.stderr)
            return 1
        # Inherit the descriptor: even if this wrapper is killed, the running
        # child retains its lock until it exits. The file itself may remain.
        return subprocess.call(
            ['bash', str(bundle / 'scripts/release_radar.sh'),
             '--backend', 'claude', '--lock-held'], pass_fds=(lock.fileno(),))


if __name__ == '__main__':
    sys.exit(run(Path(sys.argv[1])))
