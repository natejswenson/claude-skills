"""Local process identity and narrowly scoped signals; no shell, sudo, or argv capture.

Darwin uses the kernel start time including microseconds. Linux uses start ticks
and boot ID, and a pidfd when signalling. Darwin has no pidfd equivalent here:
revalidation immediately before kill reduces but cannot eliminate the kernel race.
"""
import ctypes
import errno
import json
import os
import signal
import sys
import time


def identity(pid):
    if type(pid) is not int or pid <= 1:
        raise ValueError('PID must be an integer greater than 1')
    if sys.platform == 'darwin':
        class BsdInfo(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint32) for name in (
                'flags', 'status', 'xstatus', 'pid', 'ppid', 'uid', 'gid',
                'ruid', 'rgid', 'svuid', 'svgid', 'rfu')]
            _fields_ += [('comm', ctypes.c_char * 16), ('name', ctypes.c_char * 32)]
            _fields_ += [(name, ctypes.c_uint32) for name in (
                'nfiles', 'pgid', 'pjobc', 'e_tdev', 'e_tpgid')]
            _fields_ += [('nice', ctypes.c_int32), ('start_sec', ctypes.c_uint64), ('start_usec', ctypes.c_uint64)]
        lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
        lib.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
        lib.proc_pidinfo.restype = ctypes.c_int
        lib.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
        lib.proc_pidpath.restype = ctypes.c_int
        info = BsdInfo()
        size = lib.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
        if size != ctypes.sizeof(info):
            error = ctypes.get_errno()
            if error == errno.ESRCH:
                raise ProcessLookupError('process exited')
            raise PermissionError('kernel identity is unreadable (permission or visibility restriction)')
        path = ctypes.create_string_buffer(4096)
        if lib.proc_pidpath(pid, path, len(path)) <= 0 and info.status != 5:
            if ctypes.get_errno() == errno.ESRCH:
                raise ProcessLookupError('process exited')
            raise PermissionError('executable path is unreadable')
        return dict(pid=pid, ppid=info.ppid, uid=info.uid, started=f'{info.start_sec}.{info.start_usec:06d}',
                    executable=os.fsdecode(path.value), host=os.uname().nodename, platform='darwin', zombie=info.status == 5)
    if sys.platform.startswith('linux'):
        with open(f'/proc/{pid}/stat') as source:
            fields = source.read().rsplit(')', 1)[1].split()
        with open('/proc/sys/kernel/random/boot_id') as source:
            boot = source.read().strip()
        with open(f'/proc/{pid}/status') as source:
            uid = next(int(line.split()[2]) for line in source if line.startswith('Uid:'))
        return dict(pid=pid, ppid=int(fields[1]), uid=uid, started=fields[19],
                    executable=os.readlink(f'/proc/{pid}/exe'), host=boot, platform='linux', zombie=fields[0] == 'Z')
    raise ValueError('process inspection supports macOS and Linux only')


def same(a, b):
    return all(a.get(k) == b.get(k) for k in ('pid', 'uid', 'started', 'executable', 'host', 'platform'))


def same_instance(a, b):
    return all(a.get(k) == b.get(k) for k in ('pid', 'started', 'host', 'platform'))


def parent_pid(pid):
    # Ancestor protection only needs the parent, not executable access to every
    # system service above the user's agent. Darwin short BSD info has narrower
    # access requirements than full process identity.
    if sys.platform == 'darwin':
        class ShortInfo(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint32) for name in ('pid', 'ppid', 'pgid', 'status')]
            _fields_ += [('comm', ctypes.c_char * 16)]
            _fields_ += [(name, ctypes.c_uint32) for name in ('flags', 'uid', 'gid', 'ruid', 'rgid', 'svuid', 'svgid', 'rfu')]
        lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
        lib.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
        lib.proc_pidinfo.restype = ctypes.c_int
        info = ShortInfo()
        if lib.proc_pidinfo(pid, 13, 0, ctypes.byref(info), ctypes.sizeof(info)) != ctypes.sizeof(info) or info.pid != pid:
            raise PermissionError('parent identity unreadable')
        return info.ppid
    with open(f'/proc/{pid}/stat') as source:
        return int(source.read().rsplit(')', 1)[1].split()[1])


def protect(expected):
    if expected['uid'] == 0 or expected['uid'] != os.geteuid():
        raise ValueError('refusing root or another user’s process')
    ancestor = os.getpid()
    seen = set()
    while ancestor > 1:
        if ancestor in seen or len(seen) >= 1024:
            raise ValueError('invalid process ancestry; no signal sent')
        seen.add(ancestor)
        if ancestor == expected['pid']:
            raise ValueError('refusing netwatch or an ancestor (shell/agent/session)')
        try:
            ancestor = parent_pid(ancestor)
        except (OSError, ValueError) as error:
            raise ValueError(f'cannot validate protected ancestor {ancestor}; no signal sent: {error}') from error
    executable = expected['executable']
    if sys.platform == 'darwin' and executable.startswith(('/System/', '/usr/libexec/', '/usr/sbin/', '/sbin/')):
        raise ValueError('refusing a protected system service')


def terminate(expected, signame):
    if signame not in ('TERM', 'KILL'):
        raise ValueError('only TERM or KILL is supported')
    protect(expected)
    pidfd = None
    try:
        if sys.platform.startswith('linux'):
            if not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
                raise ValueError('termination requires Linux pidfd support')
            pidfd = os.pidfd_open(expected['pid'])
        if not same(expected, identity(expected['pid'])):
            raise ValueError('process identity changed; inspect again')
        sig = signal.SIGTERM if signame == 'TERM' else signal.SIGKILL
        if pidfd is not None:
            signal.pidfd_send_signal(pidfd, sig)
        else:
            os.kill(expected['pid'], sig)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            try:
                current = identity(expected['pid'])
                if current['zombie'] and same_instance(expected, current):
                    return dict(result='exited', zombie=True)
                if not same_instance(expected, current):
                    return dict(result='original-process-gone', replacement_pid_observed=True)
                if not same(expected, current):
                    return dict(result='still-running', identity_changed=True, next='The same process instance changed executable or UID. Inspect again; do not infer exit.')
            except (ProcessLookupError, FileNotFoundError):
                return dict(result='exited')
            time.sleep(0.1)
        return dict(result='still-running', next='Inspect again before a separately confirmed force kill.')
    finally:
        if pidfd is not None:
            os.close(pidfd)


def main():
    request = json.load(sys.stdin)
    if request['action'] == 'identity':
        return identity(request['pid'])
    if request['action'] == 'terminate':
        return terminate(request['identity'], request['signal'])
    raise ValueError('unknown action')


if __name__ == '__main__':
    try:
        print(json.dumps(main()))
    except (OSError, ValueError, KeyError, StopIteration) as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(1)
