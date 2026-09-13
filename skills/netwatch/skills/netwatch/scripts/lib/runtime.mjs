import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, createReadStream, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { classify, requireSnapshot, splitCapture, parseLsof, distinctFlows, table, clean } from '../netwatch.js';
import { compareSnapshots, securitySignals } from './security.mjs';

const CLI = fileURLToPath(new URL('../netwatch.js', import.meta.url));
const HELPER = fileURLToPath(new URL('./process_identity.py', import.meta.url));
const PYTHON = process.platform === 'darwin' ? '/usr/bin/python3' : 'python3';
const LSOF = process.platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof';

export function run(file, args, options = {}) {
  const r = spawnSync(file, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' }, ...options });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status, error: r.error?.message || null };
}

function privateWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
}

export function capture(path, runner = run, platform = process.platform) {
  if (platform !== 'darwin') throw new Error('Live capture currently requires macOS; offline analysis works on other hosts.');
  const startedAt = new Date().toISOString();
  const lsof = runner(LSOF, ['-nP', '-i', '-FpcfntPT']);
  if (lsof.error || ![0, 1].includes(lsof.status)) throw new Error(`lsof capture failed: ${clean(lsof.error || lsof.stderr || lsof.status)}`);
  if (!parseLsof(lsof.stdout).length) throw new Error('snapshot has zero connections or readable sockets; not an all-clear');
  const ps = runner('/bin/ps', ['-axo', 'pid=,comm=']);
  const nettop = runner('/usr/bin/nettop', ['-P', '-L', '1', '-x', '-J', 'bytes_in,bytes_out']);
  const diagnostics = Object.entries({ lsof, ps, nettop }).map(([tool, result]) => ({ tool, status: result.status, error: result.error, warning: result.stderr.trim() }));
  const metadata = { schema: 1, startedAt, capturedAt: new Date().toISOString(), host: 'local machine', platform, diagnostics,
    limitations: 'Non-atomic samples of readable sockets only. Other users, short-lived connections, and packet contents may be invisible. Metadata itself can be sensitive.' };
  const content = `===== lsof =====\n${lsof.stdout}\n===== nettop =====\n${nettop.status === 0 ? nettop.stdout : ''}\n===== ps =====\n${ps.status === 0 ? ps.stdout : ''}\n`;
  // Keep diagnostics in the same private file without treating them as ps data.
  privateWrite(path, `# netwatch ${JSON.stringify(metadata)}\n${content}`);
  return { snapshot: path, ...metadata };
}

export function helper(request, runner = run) {
  const result = runner(PYTHON, [HELPER], { input: JSON.stringify(request) });
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { throw new Error(`process identity unavailable: ${clean(result.error || result.stderr || 'install Python 3.9+ or allow local process inspection')}`); }
  if (result.status !== 0 || parsed.error) throw new Error(parsed.error || 'process inspection failed');
  return parsed;
}

export function confirmation(inspection, signal) {
  const digest = createHash('sha256').update(JSON.stringify([inspection.identity, inspection.inspectedAt])).digest('hex').slice(0, 16);
  return `${signal}:${inspection.identity.pid}:${digest}`;
}

export async function inspect(pid, runner = run) {
  if (!/^\d+$/.test(String(pid)) || !Number.isSafeInteger(Number(pid)) || Number(pid) <= 1) throw new Error('inspect needs a positive --pid greater than 1');
  const identity = helper({ action: 'identity', pid: Number(pid) }, runner);
  const inspectedAt = new Date().toISOString();
  const sockets = runner(LSOF, ['-nP', '-a', '-p', String(pid), '-i', '-FpcfntPT']);
  const flows = distinctFlows(parseLsof(sockets.stdout));
  const facts = { executable: identity.executable, sha256: null, signature: 'not checked on this platform', file: null };
  const warnings = [];
  if (sockets.error || ![0, 1].includes(sockets.status) || sockets.stderr) warnings.push(`Socket visibility incomplete: ${clean(sockets.error || sockets.stderr || sockets.status)}`);
  try {
    const info = statSync(identity.executable);
    facts.file = { uid: info.uid, mode: (info.mode & 0o777).toString(8), size: info.size, modified: info.mtime.toISOString() };
    if (!info.isFile() || info.size > 256 * 1024 * 1024) warnings.push('Executable hash unavailable: not a regular file or exceeds 256 MiB.');
    else {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(identity.executable)) hash.update(chunk);
      facts.sha256 = hash.digest('hex');
      const after = statSync(identity.executable);
      if (info.ino !== after.ino || info.size !== after.size || info.mtimeMs !== after.mtimeMs) { facts.sha256 = null; warnings.push('Executable changed while hashing.'); }
    }
    if (info.mode & 0o002) warnings.push('Executable file is writable by everyone.');
  } catch (e) { warnings.push(`Executable file metadata unavailable: ${clean(e.message)}`); }
  if (identity.platform === 'darwin') {
    const verify = runner('/usr/bin/codesign', ['--verify', '--strict', identity.executable]);
    const details = runner('/usr/bin/codesign', ['-dv', '--verbose=2', identity.executable]);
    facts.signature = { status: verify.status === 0 ? 'valid on-disk signature (not a safety verdict)' : 'unsigned, invalid, or verification unavailable', evidence: clean(verify.error || verify.stderr), details: clean(details.stderr) };
  }
  if (/^\/(private\/)?tmp\//.test(identity.executable) || identity.executable.includes('/Downloads/')) warnings.push('Executable is running from a temporary or Downloads location; investigate its origin.');
  const current = helper({ action: 'identity', pid: Number(pid) }, runner);
  if (JSON.stringify(current) !== JSON.stringify(identity)) throw new Error('process identity changed during inspection; inspect again');
  const inspection = { schema: 1, inspectedAt, identity, facts, flows: flows.map((f) => ({ ...f, signals: securitySignals(f) })), warnings,
    limitations: 'Hash and signature describe the file on disk, not all loaded code. No command arguments, environment, request contents, or reputation lookups collected.' };
  inspection.confirmations = { TERM: confirmation(inspection, 'TERM'), KILL: confirmation(inspection, 'KILL') };
  return inspection;
}

export function terminate(args, runner = run, now = Date.now()) {
  if (typeof args.inspection !== 'string') throw new Error('terminate requires --inspection <file> from a fresh inspect');
  const path = resolve(args.inspection);
  const inspection = JSON.parse(readFileSync(path, 'utf8'));
  if (inspection.schema !== 1 || !inspection.identity || !Number.isInteger(inspection.identity.pid) || inspection.identity.pid <= 1) throw new Error('invalid inspection');
  const signal = args.signal || 'TERM';
  if (!['TERM', 'KILL'].includes(signal)) throw new Error('signal must be TERM or KILL');
  const age = now - Date.parse(inspection.inspectedAt);
  if (!Number.isFinite(age) || age < 0 || age > 120000) throw new Error('inspection expired; inspect again before confirming');
  if (args.confirm !== confirmation(inspection, signal)) throw new Error('exact process and signal confirmation required; no signal sent');
  if (typeof args.reason !== 'string' || !args.reason.trim()) throw new Error('terminate needs --reason recording the user’s decision');
  const receipt = `${path}.${signal.toLowerCase()}.receipt.json`;
  const record = { schema: 1, identity: inspection.identity, signal, reason: args.reason, requestedAt: new Date(now).toISOString(), result: 'pending' };
  // A write failure or reused receipt must prevent signalling. The helper checks
  // ownership, ancestors and live kernel identity again immediately before kill.
  privateWrite(receipt, record);
  let result;
  try { result = helper({ action: 'terminate', identity: inspection.identity, signal }, runner); }
  catch (e) { result = { result: 'failed-or-unverified', error: e.message }; }
  writeFileSync(receipt, JSON.stringify({ ...record, ...result }, null, 2), { mode: 0o600 });
  return { ...result, receipt, pid: inspection.identity.pid, signal };
}

function printInspection(value) {
  console.log(table(['Item', 'Value'], [
    ['PID / parent / UID', `${value.identity.pid} / ${value.identity.ppid} / ${value.identity.uid}`],
    ['Executable', value.identity.executable], ['Kernel start identity', value.identity.started],
    ['SHA-256 (on disk)', value.facts.sha256 || 'unavailable'],
    ['Signature', typeof value.facts.signature === 'string' ? value.facts.signature : value.facts.signature.status],
    ['Observed sockets', value.flows.length], ['Warnings', value.warnings.join('; ') || 'none observed — not proof of safety'],
  ]));
  console.log(table(['Proto', 'Kind', 'Local', 'Peer', 'State'], value.flows.map((f) => [f.proto, f.kind, `${f.lhost}:${f.lport}`, f.rhost ? `${f.rhost}:${f.rport}` : '—', f.state])));
  console.log(value.limitations);
  console.log(table(['Signal', 'Confirmation token (expires in 2 minutes)'], Object.entries(value.confirmations)));
}

export async function watch(args) {
  const count = Number(args.count ?? 3), interval = Number(args.interval ?? 5);
  if (!Number.isInteger(count) || count < 2 || count > 120 || !Number.isFinite(interval) || interval < 1 || interval > 60) throw new Error('watch needs count 2–120 and interval 1–60 seconds');
  if (typeof args.out !== 'string') throw new Error('watch requires --out <new-directory>');
  const out = resolve(args.out);
  mkdirSync(out, { mode: 0o700 });
  let previous = null, stopped = false;
  const controller = new AbortController();
  const stop = () => { stopped = true; controller.abort(); };
  process.on('SIGINT', stop);
  try {
    for (let i = 0; i < count && !stopped; i++) {
      const path = join(out, `capture-${i + 1}.txt`);
      const result = capture(path);
      const current = requireSnapshot({ snapshot: path }).flows;
      console.log(table(['Sample', 'Captured at', 'Sockets', 'Added', 'Closed'], [[i + 1, result.capturedAt, current.length,
        previous ? compareSnapshots(previous, current).added.length : '—', previous ? compareSnapshots(previous, current).closed.length : '—']]));
      for (const d of result.diagnostics.filter((d) => d.error || d.warning || d.status !== 0)) console.log(clean(`${d.tool}: ${d.error || d.warning || `exit ${d.status}`}`));
      if (previous) privateWrite(join(out, `diff-${i + 1}.json`), compareSnapshots(previous, current));
      previous = current;
      if (i < count - 1 && !stopped) await delay(interval * 1000, undefined, { signal: controller.signal }).catch((e) => { if (e.name !== 'AbortError') throw e; });
    }
  } finally { process.removeListener('SIGINT', stop); }
  console.log(`${stopped ? 'Stopped' : 'Completed'}; private samples saved in ${out}. Snapshot differences do not establish traffic rates or continuous visibility.`);
}

export async function interactive(args) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('interactive requires a user-owned terminal; in chat use capture/report/inspect and the host’s question tool');
  const out = mkdtempSync(join(tmpdir(), 'netwatch-'));
  const baseline = resolve(args.baseline || join(homedir(), '.netwatch', 'baseline.json'));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let snapshot, previous, serial = 0, pid, closed = false;
  rl.on('close', () => { closed = true; });
  rl.on('SIGINT', () => {
    if (process.listenerCount('SIGINT')) process.emit('SIGINT');
    else rl.close();
  });
  const invoke = (command, flags) => {
    const result = run(process.execPath, [CLI, command, ...flags], { timeout: 30000 });
    console.log(clean(result.stderr));
    // The child formats and sanitizes its own tables; preserve their newlines.
    console.log(result.stdout);
    if (result.status !== 0) throw new Error(result.error || 'command failed');
  };
  const refresh = () => {
    const candidate = join(out, `capture-${++serial}.txt`);
    const c = capture(candidate);
    previous = snapshot; snapshot = candidate;
    for (const d of c.diagnostics.filter((d) => d.error || d.warning || d.status !== 0)) console.log(clean(`${d.tool}: ${d.error || d.warning || d.status}`));
  };
  try {
    refresh();
    while (!closed) {
      invoke('report', ['--snapshot', snapshot, '--baseline', baseline, ...(pid ? ['--pid', pid] : [])]);
      console.log('Commands: inspect PID · focus PID/all · refresh · changes · accept · export · watch · packets · stop PID · force PID · quit');
      let line;
      try { line = await rl.question('netwatch> '); } catch { break; }
      const [command, value] = line.trim().split(/\s+/);
      try {
        if (command === 'quit' || command === 'q') break;
        if (command === 'refresh') refresh();
        else if (command === 'focus') { if (value !== 'all' && !/^\d+$/.test(value || '')) throw new Error('focus needs PID or all'); pid = value === 'all' ? undefined : value; }
        else if (command === 'inspect') printInspection(await inspect(value));
        else if (command === 'changes') {
          if (!previous) console.log('Refresh once to compare two samples.');
          else invoke('diff', ['--before', previous, '--snapshot', snapshot]);
        } else if (command === 'watch') await watch({ out: join(out, `watch-${++serial}`), count: 3, interval: 5 });
        else if (command === 'export') invoke('render', ['--snapshot', snapshot, '--baseline', baseline, '--out', join(out, `report-${++serial}.html`)]);
        else if (command === 'packets') {
          const { packetPlan, packets } = await import('./packets.mjs');
          const interfaceName = await rl.question('Interface (for example en0, blank cancels): ');
          if (!interfaceName.trim()) continue;
          const host = await rl.question('Numeric peer IP: ');
          const port = await rl.question('Peer port (blank for any): ');
          const seconds = await rl.question('Duration in seconds (1–30, default 10): ');
          const sudo = await rl.question('Use existing sudo authorization if required? Type yes (otherwise no): ');
          const options = { interface: interfaceName, host, ...(port ? { port } : {}), seconds: seconds || 10, sudo: sudo === 'yes', out: join(out, `packets-${++serial}`) };
          const plan = packetPlan(options);
          console.log(table(['Item', 'Preview'], Object.entries(plan)));
          const token = await rl.question(`Type ${plan.confirmation} to capture (blank cancels): `);
          if (token) await packets({ ...options, confirm: token });
        }
        else if (command === 'accept') {
          const flows = classify({ snapshot, baseline, pid }).classified.filter((f) => !f.match && f.kind === 'connection');
          console.log(table(['Number', 'Process', 'PID', 'Proto', 'Peer'], flows.map((f, i) => [i + 1, f.process, f.pid, f.proto, `${f.rhost}:${f.rport}`])));
          if (!flows.length) { console.log('No unrecognized connected peers in this view.'); continue; }
          const choice = await rl.question('Flow number to recognize (blank cancels): ');
          if (!choice.trim()) continue;
          if (!/^\d+$/.test(choice) || !flows[Number(choice) - 1]) throw new Error('Choose a displayed flow number');
          const f = flows[Number(choice) - 1];
          const note = await rl.question('Why is this expected? ');
          if (!note.trim()) continue;
          const approved = await rl.question(`Recognize ${clean(f.process)} → ${f.rhost}:${f.rport}/${f.proto} for future processes with this name? Type yes: `);
          if (approved !== 'yes') continue;
          invoke('accept', ['--snapshot', snapshot, '--baseline', baseline, '--host', f.rhost, '--port', f.rport, '--process', f.process, '--proto', f.proto, '--note', note]);
        } else if (['stop', 'force'].includes(command)) {
          const inspection = await inspect(value);
          printInspection(inspection);
          const signal = command === 'force' ? 'KILL' : 'TERM';
          console.log(`${signal} will stop this process; unsaved work and network sessions may be lost. A supervisor may restart it.`);
          const reason = await rl.question('Reason to stop it (blank cancels): ');
          if (!reason.trim()) continue;
          const token = await rl.question(`Type ${inspection.confirmations[signal]} to confirm (blank cancels): `);
          if (!token.trim()) continue;
          const path = join(out, `inspection-${++serial}.json`);
          privateWrite(path, inspection);
          const result = terminate({ inspection: path, confirm: token, signal, reason });
          console.log(table(['PID', 'Signal', 'Result', 'Receipt'], [[value, signal, result.error || result.result, result.receipt]]));
          refresh();
        } else if (command) console.log('Unknown command; no action taken.');
      } catch (e) { if (!closed) console.log(`netwatch: ${clean(e.message)}`); }
    }
  } finally { rl.close(); }
  console.log(`Session complete. Private captures and exports: ${out}`);
}

export async function runCommand(command, args) {
  if (command === 'capture') {
    if (typeof args.out !== 'string') throw new Error('capture requires --out <new-file>');
    const result = capture(resolve(args.out));
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(table(['Snapshot', 'Captured at', 'Visibility'], [[result.snapshot, result.capturedAt, result.limitations]]));
      console.log(table(['Tool', 'Exit', 'Diagnostic'], result.diagnostics.map((d) => [d.tool, d.status, d.error || d.warning || '—'])));
    }
  } else if (command === 'inspect') {
    const value = await inspect(args.pid);
    if (args.out) privateWrite(resolve(args.out), value);
    if (args.json) console.log(JSON.stringify(value, null, 2)); else printInspection(value);
  } else if (command === 'terminate') {
    const result = terminate(args);
    console.log(args.json ? JSON.stringify(result, null, 2) : table(['PID', 'Signal', 'Result', 'Receipt'], [[result.pid, result.signal, result.error || result.result, result.receipt]]));
    if (!['exited', 'original-process-gone'].includes(result.result)) process.exitCode = 1;
  } else if (command === 'diff') {
    if (typeof args.before !== 'string') throw new Error('diff needs --before <capture>');
    const difference = compareSnapshots(requireSnapshot({ snapshot: args.before }).flows, requireSnapshot(args).flows);
    if (args.json) console.log(JSON.stringify(difference, null, 2));
    else {
      console.log(table(['Change', 'PID', 'Process', 'Proto', 'Local', 'Peer', 'State'], ['added', 'closed'].flatMap((change) => difference[change].map((f) => [change, f.pid, f.process, f.proto, `${f.lhost}:${f.lport}`, f.rhost ? `${f.rhost}:${f.rport}` : '—', f.state]))));
      console.log(`${difference.unchanged} unchanged socket tuple(s). ${difference.limitation}`);
    }
  } else if (command === 'watch') await watch(args);
  else if (command === 'interactive') await interactive(args);
}
