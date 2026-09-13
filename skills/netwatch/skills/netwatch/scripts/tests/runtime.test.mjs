import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import { parseLsof, parseNettop, distinctFlows, byProcess, matchFlow, validateBaselineEntry, hostMatches, table } from '../netwatch.js';
import { capture, confirmation, terminate, helper } from '../lib/runtime.mjs';
import { packetPlan, packetCommand, executePacketPlan } from '../lib/packets.mjs';
import { securitySignals, compareSnapshots } from '../lib/security.mjs';
import { ipInCidr } from '../lib/providers.mjs';

const CLI = fileURLToPath(new URL('../netwatch.js', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../../evals/baseline/capture.txt', import.meta.url));
const fresh = () => mkdtempSync(join(tmpdir(), 'netwatch-test-'));
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const socket = (pid = 123, peer = '192.0.2.8:443', local = '127.0.0.1:3456') => `p${pid}\ncworker\nf4\ntIPv4\nPTCP\nn${local}->${peer}\nTST=ESTABLISHED\n`;
const bound = 'p123\ncworker\nf5\ntIPv4\nPTCP\nn*:8080\nTST=LISTEN\nf6\ntIPv6\nPUDP\nn[::]:5353\n';

test('connected sockets, TCP listeners and UDP binds preserve local endpoint and PID', () => {
  const flows = distinctFlows(parseLsof(socket() + socket(456) + bound));
  assert.equal(flows.length, 4);
  assert.deepEqual(new Set(flows.map((f) => f.kind)), new Set(['connection', 'listener', 'bound']));
  assert.equal(flows.find((f) => f.kind === 'listener').lport, '8080');
  assert.ok(flows.every((f) => f.sources.length && f.pid));
  assert.equal(parseLsof('p12\nf4\nPTCP\nn127.0.0.1:33->192.0.2.1:22').length, 0);
});

test('same names never borrow another PID’s counters', () => {
  const flows = distinctFlows(parseLsof(socket() + socket(456))).map((f) => ({ ...f, match: null }));
  const procs = byProcess(flows, new Map([['123', { bytesIn: 10, bytesOut: 20 }], ['456', { bytesIn: 30, bytesOut: 40 }]]));
  assert.equal(procs.length, 2);
  assert.equal(procs.find((p) => p.pid === '456').bytesOut, 40);
});

test('counter columns are read by header; missing values never shift into another metric', () => {
  assert.deepEqual(parseNettop(',bytes_out,bytes_in,other\nworker.123,20,10,900').get('123'), { bytesIn: 10, bytesOut: 20 });
  assert.equal(parseNettop(',bytes_in,bytes_out,other\nworker.123,,20,900').size, 0);
});

test('security observations preserve limitations and do not trust providers or accepted peers', () => {
  const listener = parseLsof(bound)[0];
  assert.equal(securitySignals(listener)[0].code, 'non-loopback-listener');
  assert.match(securitySignals(listener)[0].limitation, /firewall/i);
  assert.equal(securitySignals({ ...listener, lhost: '127.0.0.1' }).length, 0);
  const http = parseLsof(socket(123, '192.0.2.8:80'))[0];
  assert.equal(securitySignals({ ...http, match: { host: http.rhost } })[0].code, 'plaintext-service-port');
  assert.match(securitySignals(http)[0].limitation, /cannot establish/);
  assert.equal(matchFlow(listener, [{ host: '192.0.2.8' }]), null);
});

test('diff identifies changed sockets without inventing bytes or rates', () => {
  const before = distinctFlows(parseLsof(socket()));
  const after = distinctFlows(parseLsof(socket() + bound));
  const diff = compareSnapshots(before, after);
  assert.equal(diff.added.length, 2); assert.equal(diff.closed.length, 0); assert.equal(diff.unchanged, 1);
  assert.equal(compareSnapshots(after, before).closed.length, 2);
  assert.match(diff.limitation, /no bandwidth rate/);
});

test('IPv6 and protocol matching are precise and malformed ranges/ports fail', () => {
  assert.ok(hostMatches('fe80::1%en0', 'fe80:0:0:0:0:0:0:1'));
  assert.ok(ipInCidr('fe90::1', 'fe80::/10'));
  for (const cidr of ['1.2.3.4/', '1.2.3.4/8/4', '999.1.1.1/8', '1.2..4/8', '1:2:3:4:5:6:7:8::/32']) assert.equal(ipInCidr(cidr.split('/')[0], cidr), false);
  assert.ok(validateBaselineEntry({ host: '192.0.2.8', port: 99999 }, 0));
  assert.ok(validateBaselineEntry({ host: '192.0.2.8/99' }, 0));
  assert.equal(matchFlow(parseLsof(socket())[0], [{ host: '192.0.2.8', proto: 'UDP' }]), null);
});

test('capture saves private metadata and reports optional failure; no overwrite', () => {
  const out = join(fresh(), 'capture.txt');
  const runner = (file) => file.includes('lsof') ? { status: 0, stdout: socket(), stderr: '', error: null } : { status: 1, stdout: '', stderr: 'permission denied', error: null };
  const result = capture(out, runner, 'darwin');
  assert.equal(statSync(out).mode & 0o777, 0o600);
  assert.equal(result.diagnostics.filter((d) => d.status === 1).length, 2);
  assert.match(readFileSync(out, 'utf8'), /permission denied/);
  const report = JSON.parse(run('report', '--snapshot', out, '--json').stdout);
  assert.equal(report.metadata.diagnostics[1].warning, 'permission denied');
  assert.throws(() => capture(out, runner, 'darwin'), /EEXIST/);
  assert.throws(() => capture(join(fresh(), 'bad'), () => ({ status: 0, stdout: '', stderr: '', error: null }), 'darwin'), /zero connections/);
});

test('baseline validation precedes mutation and first-run directory is created', () => {
  const out = fresh(), baseline = join(out, 'nested', 'baseline.json');
  const bad = run('accept', '--baseline', baseline, '--host', '192.0.2.8', '--note', 'test', '--snapshot', join(out, 'missing'));
  assert.notEqual(bad.status, 0); assert.equal(existsSync(baseline), false);
  const good = run('accept', '--baseline', baseline, '--host', '192.0.2.8', '--note', 'test=exact');
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(readFileSync(baseline))[0].note, 'test=exact');
});

test('CLI refuses unknown or ambiguous action options and non-TTY prompts', () => {
  for (const args of [ ['terminate', '--pid', '123'], ['packets', '--sudo', 'false'], ['report', '--snapshot', FIXTURE, '--kind', 'all'], ['inspect', '--pid', '123', '--pid', '456'], ['interactive'] ]) {
    assert.notEqual(run(...args).status, 0, args.join(' '));
  }
});

const inspection = () => ({ schema: 1, inspectedAt: new Date().toISOString(), identity: { pid: 43210, ppid: 5, uid: 501, started: '12.345678', executable: '/test/worker', host: 'test', platform: 'darwin' } });
const saveInspection = (value) => { const file = join(fresh(), 'inspection.json'); writeFileSync(file, JSON.stringify(value)); return file; };

test('termination confirmation binds signal, identity and freshness before any helper call', () => {
  const value = inspection(); const path = saveInspection(value);
  const noCall = () => assert.fail('must not call helper');
  assert.throws(() => terminate({ inspection: path, confirm: 'yes', reason: 'chosen' }, noCall), /confirmation/);
  assert.throws(() => terminate({ inspection: path, signal: 'KILL', confirm: confirmation(value, 'TERM'), reason: 'chosen' }, noCall), /confirmation/);
  assert.throws(() => terminate({ inspection: path, confirm: confirmation(value, 'TERM'), reason: 'chosen' }, noCall, Date.now() + 130000), /expired/);
  const changed = { ...value, identity: { ...value.identity, started: '12.999999' } };
  assert.notEqual(confirmation(value, 'TERM'), confirmation(changed, 'TERM'));
});

test('termination writes a pending receipt before signalling and never treats helper failure as exit', () => {
  const value = inspection(); const path = saveInspection(value);
  const runner = (_file, _args, options) => {
    assert.equal(JSON.parse(readFileSync(`${path}.term.receipt.json`)).result, 'pending');
    assert.equal(JSON.parse(options.input).signal, 'TERM');
    return { status: 1, stdout: JSON.stringify({ error: 'identity changed' }) };
  };
  const result = terminate({ inspection: path, confirm: confirmation(value, 'TERM'), reason: 'chosen' }, runner);
  assert.equal(result.result, 'failed-or-unverified');
  assert.equal(statSync(result.receipt).mode & 0o777, 0o600);
  assert.throws(() => terminate({ inspection: path, confirm: confirmation(value, 'TERM'), reason: 'chosen' }, () => assert.fail()), /EEXIST/);
});

test('confirmed successful helper outcome is preserved in the receipt', () => {
  const value = inspection(); const path = saveInspection(value);
  const result = terminate({ inspection: path, confirm: confirmation(value, 'TERM'), reason: 'chosen' }, () => ({ status: 0, stdout: '{"result":"exited"}' }));
  assert.equal(result.result, 'exited');
  assert.equal(JSON.parse(readFileSync(result.receipt)).result, 'exited');
});

test('packet preview bounds scope, payload size, elevation, and confirmation', () => {
  const options = { interface: 'en0', host: '192.0.2.8', port: '443', out: join(fresh(), 'packet') };
  const plan = packetPlan(options);
  assert.equal(existsSync(plan.out), false);
  const command = packetCommand(plan);
  assert.ok(command.args.includes('-p'));
  assert.equal(command.args.at(-1), 'host 192.0.2.8 and port 443');
  for (const change of [{ host: 'evil;echo' }, { interface: 'any' }, { interface: 'en0;id' }, { seconds: 31 }, { count: 1001 }, { snaplen: 0 }]) assert.throws(() => packetPlan({ ...options, ...change }));
  for (const change of [{ sudo: true }, { host: '192.0.2.9' }, { seconds: 20 }, { snaplen: 65535 }]) assert.notEqual(packetPlan({ ...options, ...change }).confirmation, plan.confirmation);
  assert.match(plan.warning, /credentials/);
  const preview = run('packets', '--interface', 'en0', '--host', '192.0.2.8', '--out', options.out, '--json');
  assert.equal(preview.status, 0, preview.stderr); assert.equal(existsSync(options.out), false);
});

test('completed packet collection produces a private PCAP, header summary and receipt', { skip: process.platform !== 'darwin' }, async () => {
  const plan = packetPlan({ interface: 'lo0', host: '192.0.2.1', seconds: 1, out: join(fresh(), 'packets') });
  const fakeSpawn = (_file, args) => {
    const frame = Buffer.from('0000000000020000000000010800450000280000000040060000c0000201c0000202303901bb00000000000000005002200000000000', 'hex');
    const header = Buffer.alloc(24); header.writeUInt32LE(0xa1b2c3d4); header.writeUInt16LE(2, 4); header.writeUInt16LE(4, 6); header.writeUInt32LE(96, 16); header.writeUInt32LE(1, 20);
    const record = Buffer.alloc(16); record.writeUInt32LE(1760000000); record.writeUInt32LE(frame.length, 8); record.writeUInt32LE(frame.length, 12);
    writeFileSync(args[args.indexOf('-w') + 1], Buffer.concat([header, record, frame]));
    const child = new EventEmitter(); child.pid = 999999999; child.stderr = new EventEmitter(); child.kill = () => assert.fail('completed child must not be signalled');
    queueMicrotask(() => child.emit('close', 0, null));
    return child;
  };
  const result = await executePacketPlan(plan, fakeSpawn);
  assert.equal(result.result, 'stopped'); assert.equal(result.packetsSummarized, 1);
  assert.match(readFileSync(join(plan.out, 'summary.txt'), 'utf8'), /192\.0\.2\.1/);
  for (const file of ['capture.pcap', 'summary.txt', 'receipt.json']) assert.equal(statSync(join(plan.out, file)).mode & 0o777, 0o600);
});

test('packet signalling error retains the hard stop and reports unverified', { skip: process.platform !== 'darwin' }, async () => {
  const signals = [];
  const plan = packetPlan({ interface: 'lo0', host: '127.0.0.1', seconds: 1, out: join(fresh(), 'packets') });
  const fakeSpawn = () => {
    const child = new EventEmitter(); child.pid = 999999999; child.stderr = new EventEmitter();
    child.kill = (sig) => { signals.push(sig); queueMicrotask(() => child.emit('error', new Error('kill EPERM'))); return false; };
    child.unref = () => {};
    return child;
  };
  const result = await executePacketPlan(plan, fakeSpawn);
  assert.deepEqual(signals, ['SIGINT', 'SIGKILL']);
  assert.equal(result.result, 'unverified'); assert.equal(result.childPid, 999999999);
});

test('a receipt write failure after spawn still stops the packet child', { skip: process.platform !== 'darwin' || process.getuid?.() === 0 }, async () => {
  const plan = packetPlan({ interface: 'lo0', host: '127.0.0.1', seconds: 1, out: join(fresh(), 'packets') });
  const signals = [];
  const fakeSpawn = () => {
    chmodSync(join(plan.out, 'receipt.json'), 0o400);
    const child = new EventEmitter(); child.pid = 999999999; child.stderr = new EventEmitter();
    child.kill = (sig) => { signals.push(sig); queueMicrotask(() => child.emit('close', 0, null)); return true; };
    return child;
  };
  const result = await executePacketPlan(plan, fakeSpawn);
  assert.deepEqual(signals, ['SIGINT']);
  assert.equal(result.result, 'unverified');
  assert.match(result.error, /receipt/);
});

test('native signal outcomes distinguish permission loss, exec, exit and PID replacement', () => {
  const script = fileURLToPath(new URL('./test_process_identity.py', import.meta.url));
  const result = spawnSync(process.platform === 'darwin' ? '/usr/bin/python3' : 'python3', ['-B', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('report escapes capture text and filtered empty view never implies all known', () => {
  const out = fresh(), snapshot = join(out, 'hostile.txt');
  writeFileSync(snapshot, socket().replace('cworker', 'c<script>alert(1)</script>'));
  const html = join(out, 'report.html');
  assert.equal(run('render', '--snapshot', snapshot, '--out', html).status, 0);
  assert.match(readFileSync(html, 'utf8'), /&lt;script&gt;/);
  assert.doesNotMatch(table(['Process'], [['\x1b[31mspoof\nrow']]), /\x1b|spoof\n/);
  assert.equal(run('render', '--snapshot', FIXTURE, '--pid', '999999999', '--out', html).status, 0);
  assert.match(readFileSync(html, 'utf8'), /No sockets match/);
  assert.doesNotMatch(readFileSync(html, 'utf8'), /Every live flow matches/);
});

test('live helper refuses ancestors and changed identity, stops only a disposable owned child', {
  skip: !['darwin', 'linux'].includes(process.platform) || process.getuid?.() === 0,
}, async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await once(child, 'spawn');
  const exited = once(child, 'exit');
  try {
    const value = helper({ action: 'identity', pid: child.pid });
    assert.equal(value.pid, child.pid);
    assert.throws(() => helper({ action: 'terminate', identity: { ...value, started: 'wrong' }, signal: 'TERM' }), /identity changed|ancestor/);
    const own = helper({ action: 'identity', pid: process.pid });
    assert.throws(() => helper({ action: 'terminate', identity: own, signal: 'TERM' }), /ancestor/);
    const result = helper({ action: 'terminate', identity: value, signal: 'TERM' });
    assert.equal(result.result, 'exited');
    await exited;
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); }
});
