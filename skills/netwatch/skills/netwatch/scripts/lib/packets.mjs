import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { mkdirSync, writeFileSync, statSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { clean, table } from '../netwatch.js';
import { run } from './runtime.mjs';

const TCPDUMP = '/usr/sbin/tcpdump';

export function packetPlan(args) {
  if (typeof args.interface !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,31}$/.test(args.interface) || ['any', 'all', 'pktap'].includes(args.interface)) throw new Error('Choose one explicit interface (for example en0 or lo0); aggregate interfaces are refused');
  if (typeof args.host !== 'string' || !isIP(args.host)) throw new Error('packets needs one numeric --host peer address');
  const seconds = Number(args.seconds ?? 10), count = Number(args.count ?? 100), snaplen = Number(args.snaplen ?? 96);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 30) throw new Error('seconds must be 1–30');
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('count must be 1–1000');
  if (!Number.isInteger(snaplen) || snaplen < 64 || snaplen > 65535) throw new Error('snaplen must be 64–65535; larger values can include more payload');
  if (args.port !== undefined && (!/^\d+$/.test(String(args.port)) || Number(args.port) < 1 || Number(args.port) > 65535)) throw new Error('port must be 1–65535');
  if (typeof args.out !== 'string') throw new Error('packets needs --out <new-directory>');
  const out = resolve(args.out);
  const filter = `host ${args.host}${args.port ? ` and port ${Number(args.port)}` : ''}`;
  const elevated = args.sudo === true;
  const plan = { schema: 1, interface: args.interface, host: args.host, filter, seconds, count, snaplen, out, elevated,
    warning: 'Packet files can include credentials, names, and request contents even with a short snaplen. Captures match this peer on this interface, potentially across multiple processes; never attribute packets to a PID from the filter alone.' };
  plan.confirmation = `CAPTURE:${createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 16)}`;
  return plan;
}

// No shell, promiscuous mode, DNS lookup, arbitrary BPF, or unlimited duration.
export function packetCommand(plan) {
  const args = ['-i', plan.interface, '-p', '-nn', '-U', '-c', String(plan.count), '-s', String(plan.snaplen), '-w', join(plan.out, 'capture.pcap'), plan.filter];
  return plan.elevated ? { file: '/usr/bin/sudo', args: ['-n', TCPDUMP, ...args] } : { file: TCPDUMP, args };
}

export async function executePacketPlan(plan, spawnTool = spawn) {
  if (process.platform !== 'darwin') throw new Error('Live packet capture currently requires macOS');
  mkdirSync(plan.out, { mode: 0o700 }); // Exclusive directory; never overwrite a capture.
  const receiptPath = join(plan.out, 'receipt.json');
  const startedAt = new Date().toISOString();
  writeFileSync(receiptPath, JSON.stringify({ ...plan, startedAt, result: 'pending' }, null, 2), { flag: 'wx', mode: 0o600 });
  const command = packetCommand(plan);
  const result = await new Promise((done) => {
    let stderr = '', interrupted = false, timedOut = false, settled = false, hardTimer, stopping = false;
    const child = spawnTool(command.file, command.args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, LC_ALL: 'C' } });
    const finish = (value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(hardTimer); process.removeListener('SIGINT', interrupt);
      done({ ...value, timedOut, interrupted, childPid: child.pid ?? null, command, diagnostic: clean(stderr) });
    };
    const stop = () => {
      if (stopping || settled) return;
      stopping = true;
      child.kill('SIGINT');
      hardTimer = setTimeout(() => {
        child.kill('SIGKILL');
        child.unref?.(); child.stderr?.destroy?.();
        finish({ result: 'unverified', error: 'capture did not acknowledge stop; check the recorded command process before another capture' });
      }, 3000);
    };
    const interrupt = () => { interrupted = true; stop(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, plan.seconds * 1000);
    process.on('SIGINT', interrupt);
    child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(-16000); });
    child.on('error', (error) => {
      if (!child.pid) finish({ result: 'failed', error: error.message });
      else { stderr += ` Stop/spawn error: ${error.message}`; stop(); }
    });
    child.on('close', (code, signal) => finish({ result: code === 0 || ((timedOut || interrupted) && signal === 'SIGINT') ? 'stopped' : 'failed', code, signal }));
    try {
      writeFileSync(receiptPath, JSON.stringify({ ...plan, startedAt, result: 'pending', childPid: child.pid ?? null, command }, null, 2), { mode: 0o600 });
    } catch (error) {
      stderr += ` Receipt update failed: ${error.message}`;
      stop();
    }
  });
  const pcap = join(plan.out, 'capture.pcap');
  try {
    chmodSync(pcap, 0o600);
    result.bytes = statSync(pcap).size;
    const summary = run(TCPDUMP, ['-nn', '-tttt', '-q', '-r', pcap], { timeout: 10000 });
    if (summary.status === 0) {
      // Header summaries only; do not use -A/-X/-v or paste a payload in chat.
      result.packetsSummarized = summary.stdout.split('\n').filter(Boolean).length;
      writeFileSync(join(plan.out, 'summary.txt'), summary.stdout, { flag: 'wx', mode: 0o600 });
    } else result.summaryError = clean(summary.error || summary.stderr);
  } catch (error) { result.artifactError = clean(error.message); }
  result.result = result.result === 'stopped' && result.packetsSummarized === 0 ? 'no-packets-observed' : result.result;
  const receipt = { ...plan, startedAt, finishedAt: new Date().toISOString(), ...result, pcap };
  try { writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 }); }
  catch (error) { receipt.result = 'unverified'; receipt.error = `Could not save final receipt: ${clean(error.message)}`; }
  return { ...receipt, receipt: receiptPath };
}

export async function packets(args) {
  const plan = packetPlan(args);
  if (!args.confirm) {
    console.log(args.json ? JSON.stringify(plan, null, 2) : table(['Item', 'Capture preview — no capture started'], Object.entries(plan).map(([k, v]) => [k, v])));
    return;
  }
  if (args.confirm !== plan.confirmation) throw new Error('capture options changed or confirmation is incorrect; preview and confirm this exact capture');
  const result = await executePacketPlan(plan);
  console.log(args.json ? JSON.stringify(result, null, 2) : table(['Result', 'Packets summarized', 'PCAP', 'Receipt', 'Diagnostic'], [[result.result, result.packetsSummarized ?? 'unavailable', result.pcap, result.receipt, result.error || result.artifactError || result.diagnostic]]));
  if (!['stopped', 'no-packets-observed'].includes(result.result) || result.artifactError || result.summaryError) process.exitCode = 1;
}
