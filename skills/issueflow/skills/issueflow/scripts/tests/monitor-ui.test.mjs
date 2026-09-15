import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

const cli = fileURLToPath(new URL('../issueflow.js', import.meta.url));
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value)); };
const tree = (dir) => readdirSync(dir, { withFileTypes: true }).filter((e) => e.name !== '.test-heartbeat').sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
  const path = join(dir, e.name); return e.isDirectory() ? tree(path) : [[path, readFileSync(path, 'utf8')]];
});
function fixtures(t) {
  const root = mkdtempSync(join(tmpdir(), 'monitor-ui-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ['gh', 'git', 'codex', 'claude']) {
    const path = join(root, 'bin', name);
    write(path, '#!/bin/sh\nprintf called > "${0%/*}/unexpected-call"\nexit 97\n'); chmodSync(path, 0o755);
  }
  const make = (number, host) => {
    const dir = join(root, host, `issue-${number}`), output = join(dir, 'root', 'implement.md');
    const agent = { id: 'worker-1', generation: 'generation-1', outputs: [output], brief: 'implement task',
      native: { workerId: `${host}-native`, status: 'started', startedAt: '2020-01-01T00:00:00.000Z' } };
    const run = { schema: 5, createdAt: '2026-09-01T00:00:00.000Z', runtime: host,
      repo: { owner: 'fixture', name: host }, issue: { number, title: 'terminal check' },
      initialization: { owner: { digest: (host === 'codex' ? 'a' : 'b').repeat(64), token: 'PRIVATE-TOKEN' } },
      harness: { version: 2, attempts: { 'root/implement.md': agent }, attemptHistory: [] }, stages: [],
      lanes: [{ slug: 'root', stages: [{ id: 'implement', state: 'briefed', artifact: 'implement.md' }] }],
      presentation: { snapshot: { state: 'waiting for worker', nextAction: 'Wait for output' } } };
    write(join(dir, 'run.json'), run);
    write(output, Array.from({ length: 70 }, (_, i) => `${host}-output-line-${i}`).join('\n'));
    write(join(dir, 'progress/root-implement.log'), `${host} stage activity`);
    return { dir, run, agent };
  };
  return { root, claude: make(2, 'claude'), codex: make(1, 'codex') };
}

// Real POSIX terminal driver, with bounded reads and only this monitor's PID
// eligible for termination. Test-only fixture writes model external controllers.
const driver = String.raw`
import errno, fcntl, json, os, pty, re, select, signal, struct, subprocess, sys, termios, threading, time
config = json.loads(sys.argv[1])
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 28, 160, 0, 0))
before = termios.tcgetattr(slave)
proc = subprocess.Popen(config['argv'], stdin=slave, stdout=slave, stderr=slave,
    env=dict(os.environ, TERM=config.get('term', 'xterm-256color'), PATH=config['bin'] + os.pathsep + os.environ['PATH']))
raw, frames, count = b'', [], [0]
stop = threading.Event()
def writer():
    while not stop.wait(.02):
        count[0] += 1
        with open(config['heartbeat'], 'w') as target: target.write(str(count[0]))
thread = threading.Thread(target=writer); thread.start()
def read_for(seconds):
    global raw
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if select.select([master], [], [], min(.05, max(0, end - time.monotonic())))[0]:
            try: raw += os.read(master, 65536)
            except OSError as exc:
                if exc.errno == errno.EIO: return
                raise
def screen():
    current = raw.split(b'\x1b[H\x1b[2J')[-1].decode('utf8', 'replace')
    return re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', current)
try:
    for action in config['actions']:
        if 'send' in action: os.write(master, action['send'].encode())
        if 'write' in action:
            with open(action['write'], 'w') as target: target.write(json.dumps(action['value']))
        if 'remove' in action: os.unlink(action['remove'])
        if 'resize' in action:
            rows, cols = action['resize']
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0)); proc.send_signal(signal.SIGWINCH)
        deadline = time.monotonic() + 4
        read_for(action.get('wait', .65 if action.get('send') == '\x1b' else .12))
        while 'expect' in action and action['expect'] not in screen() and time.monotonic() < deadline and proc.poll() is None: read_for(.05)
        frames.append(screen())
    if proc.poll() is None: proc.wait(timeout=4)
    read_for(.1)
    final_count = count[0]; time.sleep(.08)
    print(json.dumps(dict(code=proc.returncode, frames=frames, restored=termios.tcgetattr(slave) == before,
        cursor=b'\x1b[?25h' in raw, alternate=b'\x1b[?1049l' in raw, writerContinued=count[0] > final_count)))
finally:
    stop.set(); thread.join()
    if proc.poll() is None: proc.terminate(); proc.wait(timeout=2)
    os.close(master); os.close(slave)
`;
function terminal(root, actions, extra = {}) {
  const result = spawnSync('python3', ['-c', driver, JSON.stringify({ argv: [process.execPath, cli, 'monitor', '--run-root', root],
    bin: join(root, 'bin'), heartbeat: join(root.endsWith('/missing') ? dirname(root) : root, '.test-heartbeat'), actions, ...extra })],
    { encoding: 'utf8', timeout: 35000 });
  assert.equal(result.status, 0, `PTY driver completed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}
function publicReady(root) {
  const result = terminal(root, [{ expect: 'ISSUEFLOW MONITOR' }, { send: 'q' }]);
  assert.match(result.frames[0], /ISSUEFLOW MONITOR/, 'public monitor must start an interactive terminal');
  assert.equal(result.code, 0);
  return result;
}

test('public PTY navigates two hosts, scrolls details, refreshes attention/replacement/removal and resizes without mutations', (t) => {
  const { root, codex } = fixtures(t), before = tree(root);
  const replaced = structuredClone(codex.run);
  replaced.presentation.snapshot = { state: 'awaiting user', nextAction: 'Review output' };
  const old = replaced.harness.attempts['root/implement.md']; old.native.status = 'completed';
  replaced.harness.attemptHistory = [old];
  replaced.harness.attempts['root/implement.md'] = { ...old, id: 'worker-0', native: { ...old.native, status: 'failed' } };
  const removed = structuredClone(replaced); removed.harness.attemptHistory = [];
  removed.presentation.snapshot.state = 'blocked';
  const changed = join(codex.dir, 'run.json');
  const actions = [
    { expect: 'ISSUEFLOW MONITOR' },
    { send: '\t', expect: 'Focus: agents' },
    { send: 'o', expect: '/tasks' },
    { send: '\u001b', expect: 'Focus: runs' },
    { send: 'j', expect: 'Selected run: fixture/codex' },
    { send: '\t', expect: 'Focus: agents' },
    { send: 'o', expect: '/agent' },
    { send: '\u001b[6~', expect: 'codex-output-line-' },
    { write: changed, value: replaced, send: 'r', expect: 'worker-1 / codex-native' },
    { send: '\u001b', expect: 'awaiting user' },
    { send: '\t', expect: 'completed historical' },
    { write: changed, value: removed, wait: 1.2, expect: 'Selected agent: removed/unavailable' },
    { send: 'j', expect: 'worker-0 / codex-native' },
    { resize: [10, 50], expect: 'AGENTS' },
    { send: '\r', expect: 'DETAILS' },
    { resize: [28, 160], expect: 'blocked' },
    { remove: changed, wait: 1.2, expect: 'Selected run: removed/unavailable' },
    { send: '\u001b', expect: 'Focus: runs' },
    { send: 'k', expect: 'Selected run: fixture/claude' },
    { send: 'q' },
  ];
  const out = terminal(root, actions);
  assert.match(out.frames[0], /ISSUEFLOW MONITOR/, 'public monitor must start an interactive terminal');
  actions.forEach((action, i) => { if (action.expect) assert.ok(out.frames[i].includes(action.expect), `frame ${i} must contain ${action.expect}:\n${out.frames[i]}`); });
  assert.match(out.frames[2], /External attachment unavailable/); assert.match(out.frames[6], /External attachment unavailable/);
  assert.match(out.frames[7], /codex-output-line-/); assert.doesNotMatch(out.frames[7], /claude-output-line-/);
  assert.doesNotMatch(out.frames.join('\n'), /PRIVATE-TOKEN/);
  assert.equal(out.frames[13].split('\r\n').length, 10);
  assert.equal(out.code, 0); assert.ok(out.restored && out.cursor && out.alternate && out.writerContinued);
  assert.deepEqual(tree(root), before.filter(([path]) => path !== changed), 'only test-owned fixture changes may occur');
});

test('public PTY exits with terminal restored for q, Ctrl-C and Ctrl-D; empty and unreadable states remain usable', (t) => {
  const { root } = fixtures(t);
  publicReady(root);
  const before = tree(root);
  for (const key of ['q', '\u0003', '\u0004']) {
    const out = terminal(root, [{ expect: 'ISSUEFLOW MONITOR' }, { send: key }]);
    assert.equal(out.code, 0); assert.ok(out.restored && out.cursor && out.alternate && out.writerContinued);
  }
  const empty = join(root, 'missing');
  const out = terminal(empty, [{ expect: 'No runs discovered' }, { send: 'o', expect: 'Run root unavailable' }, { send: 'q' }]);
  assert.ok(out.frames[0].includes('No runs discovered')); assert.match(out.frames[1], /Run root unavailable/);
  assert.deepEqual(tree(root), before);
});

test('non-TTY and unsupported terminal explain the JSON fallback; JSON remains usable', (t) => {
  const { root } = fixtures(t);
  const result = spawnSync(process.execPath, [cli, 'monitor', '--run-root', root], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /requires input\/output TTYs/);
  assert.match(result.stderr, /issueflow monitor --json/);
  const dumb = terminal(root, [{ wait: .2 }], { term: 'dumb' });
  assert.notEqual(dumb.code, 0); assert.match(dumb.frames[0], /ANSI-capable TERM/); assert.ok(dumb.restored);
  const json = spawnSync(process.execPath, [cli, 'monitor', '--json', '--run-root', root], { encoding: 'utf8' });
  assert.equal(json.status, 0); assert.equal(JSON.parse(json.stdout).runs.length, 2);
});

test('stable selections survive reorder; lifecycle removes listeners and restores raw mode on EOF and errors', async (t) => {
  const { root } = fixtures(t);
  publicReady(root); // Base fails this public assertion, never a missing module import.
  const { createView, refreshView, handleKey, renderView, runMonitor } = await import('../lib/monitor-ui.mjs');
  const snapshot = JSON.parse(spawnSync(process.execPath, [cli, 'monitor', '--json', '--run-root', root], { encoding: 'utf8' }).stdout);
  const view = createView(snapshot), first = view.runKey, firstAgent = view.agentKey;
  const empty = createView({ ...snapshot, runs: [{ ...snapshot.runs[0], agents: [], agentsNote: 'No agents yet' }] });
  handleKey(empty, { name: 'tab' }); assert.match(renderView(empty), /No agents yet/);
  refreshView(empty, snapshot); assert.equal(empty.agentKey, firstAgent, 'first observed worker appears after an empty run');
  refreshView(view, { ...snapshot, runs: [...snapshot.runs].reverse() });
  assert.equal(view.runKey, first); assert.equal(view.agentKey, firstAgent);
  handleKey(view, { name: 'tab', shift: true }); assert.equal(view.focus, 'details');
  handleKey(view, { name: 'escape' }); assert.equal(view.focus, 'runs');
  for (const [columns, rows] of [[160, 28], [50, 10], [30, 6]]) {
    const frame = renderView(view, columns, rows).split('\r\n');
    assert.equal(frame.length, rows); assert.ok(frame.every((line) => line.length < columns));
    assert.ok(frame.some((line) => line.includes('q/Ctrl-C')));
  }
  for (const mode of ['end', 'input error', 'output error', 'snapshot error']) {
    const input = new PassThrough(), output = new PassThrough(), signals = new EventEmitter();
    Object.assign(input, { isTTY: true, isRaw: mode === 'end', setRawMode(value) { this.isRaw = value; } });
    Object.assign(output, { isTTY: true, columns: 140, rows: 24 });
    input.pause();
    const raw = input.isRaw, paused = input.isPaused(), chunks = [];
    output.on('data', (chunk) => chunks.push(chunk));
    let count = 0;
    const running = runMonitor({}, { input, output, signals, env: { TERM: 'xterm' }, intervalMs: 10,
      snapshot() { if (++count > 1 && mode === 'snapshot error') throw new Error('fixture read error'); return snapshot; } });
    if (mode === 'end') input.emit('end');
    else if (mode === 'input error') input.emit('error', new Error('fixture stream error'));
    else if (mode === 'output error') output.emit('error', new Error('fixture output error'));
    if (mode === 'end') await running; else await assert.rejects(running, /fixture/);
    assert.equal(input.isRaw, raw); assert.equal(input.isPaused(), paused);
    for (const name of ['data', 'keypress', 'end', 'close', 'error', 'newListener']) assert.equal(input.listenerCount(name), 0, name);
    assert.equal(output.listenerCount('resize'), 0); assert.equal(signals.listenerCount('SIGINT'), 0);
    assert.match(Buffer.concat(chunks).toString(), /\x1b\[\?25h\x1b\[\?1049l/);
  }
});
