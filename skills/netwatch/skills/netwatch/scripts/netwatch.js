#!/usr/bin/env node
/**
 * netwatch — the deterministic half of the skill.
 *
 * Everything mechanical lives here so the agent never reshapes output with
 * sed/grep/jq in the transcript: one command returns everything a step needs,
 * already as a table. The agent captures a live snapshot (nettop/lsof) into a
 * file; this binary turns that text into grounded flows, classifies each one
 * strictly against a baseline the user built, and refuses — as code, not prose —
 * to ever attach a "dangerous" verdict. The agent's job is the conversation and
 * the judgment; this binary's job is facts.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

function argv(args) {
  const out = { _: [], _multi: {} };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      let val;
      if (inline !== undefined) val = inline;
      else if (args[i + 1] && !args[i + 1].startsWith('--')) { val = args[i + 1]; i += 1; }
      else val = true;
      out[key] = val;
      (out._multi[key] ??= []).push(val);
    } else out._.push(a);
  }
  return out;
}

export const table = (headers, rows) => {
  if (rows.length === 0) return '';
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => `| ${cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' | ')} |`;
  return [line(headers), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...rows.map(line)].join('\n');
};

// ---------------------------------------------------------------------------
// Capture parsing. The capture is one text file with two labelled sections:
//   ===== lsof =====      output of `lsof -nP -i -FcnPptT`  (connections)
//   ===== nettop =====    output of `nettop -P -L 1 -x -J bytes_in,bytes_out`
// Only the lsof section is load-bearing; nettop supplies per-process byte
// totals when present. See references/capture.md.
// ---------------------------------------------------------------------------

export function splitCapture(text) {
  const sections = { lsof: '', nettop: '' };
  let current = null;
  for (const raw of text.split('\n')) {
    const m = raw.match(/^=+\s*(lsof|nettop)\s*=+\s*$/i);
    if (m) { current = m[1].toLowerCase(); continue; }
    if (current) sections[current] += `${raw}\n`;
  }
  // A capture with no section markers is treated as raw lsof field output.
  if (!sections.lsof && !sections.nettop && /^p\d+/m.test(text)) sections.lsof = text;
  return sections;
}

// Split a numeric "host:port" or "[v6]:port" into { host, port }.
function splitAddr(addr) {
  const v6 = addr.match(/^\[(.+)\]:(\d+|\*)$/);
  if (v6) return { host: v6[1], port: v6[2] };
  const i = addr.lastIndexOf(':');
  if (i === -1) return { host: addr, port: '' };
  return { host: addr.slice(0, i), port: addr.slice(i + 1) };
}

export function parseLsof(text) {
  const flows = [];
  let pid = '';
  let cmd = '';
  let file = null;
  const flush = () => {
    if (!file || !file.n || !file.n.includes('->')) { file = null; return; }
    const [lhs, rhs] = file.n.split('->');
    const { host: rhost, port: rport } = splitAddr(rhs.trim());
    if (!rhost || rhost === '*') { file = null; return; }
    flows.push({
      process: cmd,
      pid,
      proto: file.P || '',
      type: file.t || '',
      lhost: splitAddr(lhs.trim()).host,
      rhost,
      rport,
      state: file.T || '',
      source: `p${pid} c${cmd} ${file.P || ''} ${file.n}`,
    });
    file = null;
  };
  for (const line of text.split('\n')) {
    if (!line) continue;
    const id = line[0];
    const val = line.slice(1);
    if (id === 'p') { flush(); pid = val; }
    else if (id === 'c') { cmd = val; }
    else if (id === 'f') { flush(); file = {}; }
    else if (file) {
      if (id === 'P') file.P = val;
      else if (id === 't') file.t = val;
      else if (id === 'n') file.n = val;
      else if (id === 'T' && val.startsWith('ST=')) file.T = val.slice(3);
    }
  }
  flush();
  return flows;
}

export function parseNettop(text) {
  const byPid = new Map();
  for (const line of text.split('\n')) {
    const cells = line.split(',').map((c) => c.trim());
    for (let i = 0; i < cells.length; i += 1) {
      const m = cells[i].match(/^(.+)\.(\d+)$/);
      if (!m) continue;
      const nums = cells.slice(i + 1).filter((c) => /^\d+$/.test(c));
      if (nums.length >= 2) byPid.set(m[2], { bytesIn: Number(nums[0]), bytesOut: Number(nums[1]) });
      break;
    }
  }
  return byPid;
}

// Distinct flows: one row per (process, proto, rhost, rport, state); sockets counts the collapse.
export function distinctFlows(flows) {
  const map = new Map();
  for (const f of flows) {
    const key = `${f.process}|${f.proto}|${f.rhost}|${f.rport}|${f.state}`;
    const hit = map.get(key);
    if (hit) { hit.sockets += 1; continue; }
    map.set(key, { ...f, sockets: 1 });
  }
  return [...map.values()].sort((a, b) =>
    a.process.localeCompare(b.process) || a.rhost.localeCompare(b.rhost)
    || Number(a.rport) - Number(b.rport) || a.proto.localeCompare(b.proto));
}

// ---------------------------------------------------------------------------
// Baseline. An entry is { process?, host, port?, note }. `host` is required and
// may never match everything. Matching supports: exact host; a leading-dot
// suffix (".apple.com" matches gateway.push.apple.com); a trailing-dot prefix
// ("17.253." matches 17.253.72.14). See references/baseline.md.
// ---------------------------------------------------------------------------

export function validateBaselineEntry(e, i) {
  if (typeof e !== 'object' || e === null) return `entry ${i}: not an object`;
  const host = e.host;
  if (typeof host !== 'string' || host.trim() === '') return `entry ${i}: names no host — an entry that matches everything is refused`;
  if (host === '*' || host === '.' || host === '*.' || host === '**') return `entry ${i}: host "${host}" matches everything — refused`;
  if (e.process !== undefined && typeof e.process !== 'string') return `entry ${i}: process must be a string`;
  if (e.port !== undefined && e.port !== '*' && !/^\d+$/.test(String(e.port))) return `entry ${i}: port "${e.port}" is not a number or *`;
  return null;
}

export function loadBaseline(path) {
  if (!path || !existsSync(path)) return { entries: [], exists: false };
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); }
  catch (err) { return { entries: [], exists: true, error: `baseline is not valid JSON: ${err.message}` }; }
  const entries = Array.isArray(parsed) ? parsed : parsed.entries;
  if (!Array.isArray(entries)) return { entries: [], exists: true, error: 'baseline must be an array of entries, or { "entries": [...] }' };
  for (let i = 0; i < entries.length; i += 1) {
    const bad = validateBaselineEntry(entries[i], i);
    if (bad) return { entries: [], exists: true, error: bad };
  }
  return { entries, exists: true };
}

export function hostMatches(rhost, pattern) {
  if (pattern === rhost) return true;
  if (pattern.startsWith('.')) return rhost === pattern.slice(1) || rhost.endsWith(pattern);
  if (pattern.endsWith('.')) return rhost.startsWith(pattern);
  return false;
}

export function matchFlow(flow, entries) {
  for (const e of entries) {
    const procOk = !e.process || e.process === '*' || e.process.toLowerCase() === flow.process.toLowerCase();
    const portOk = e.port === undefined || e.port === '*' || String(e.port) === String(flow.rport);
    if (procOk && portOk && hostMatches(flow.rhost, e.host)) return e;
  }
  return null;
}

// ---------------------------------------------------------------------------

function requireSnapshot(args) {
  const path = args.snapshot ? resolve(args.snapshot) : null;
  if (!path || !existsSync(path)) throw new Error('no snapshot — capture one first (see references/capture.md) and pass --snapshot <file>');
  const text = readFileSync(path, 'utf8');
  const { lsof, nettop } = splitCapture(text);
  const flows = parseLsof(lsof);
  if (flows.length === 0) throw new Error('snapshot has zero connections — an empty capture is refused, not reported as "all clear". Re-capture while something is talking to the network');
  return { flows: distinctFlows(flows), rawCount: flows.length, bytes: parseNettop(nettop) };
}

function rejectVerdict(args) {
  for (const flag of ['verdict', 'flag', 'severity', 'threat', 'malicious', 'danger', 'dangerous']) {
    if (args[flag] !== undefined) {
      throw new Error(`netwatch does not label flows "${args[flag] === true ? flag : args[flag]}" — the one rule is that a flow is only ever "known" (you accepted it) or "unrecognized". Verdicts are the model's judgment, never this report's`);
    }
  }
}

async function cmdFlows(args) {
  const { flows, rawCount } = requireSnapshot(args);
  const rows = flows.map((f) => [f.process, f.pid, f.proto, f.rhost, f.rport || '—', f.state || '—', f.sockets]);
  console.log(table(['Process', 'PID', 'Proto', 'Destination', 'Port', 'State', 'Sockets'], rows));
  console.log('');
  console.log(table(['Distinct flows', 'Sockets', 'Processes'], [[
    flows.length, rawCount, new Set(flows.map((f) => f.process)).size,
  ]]));
  console.log('\nevery row above traces to a line the capture actually contained — nothing here was inferred.');
}

async function cmdBaseline(args) {
  const bl = loadBaseline(args.baseline ? resolve(args.baseline) : null);
  if (bl.error) throw new Error(bl.error);
  const rows = bl.entries.map((e) => [e.process || '*', e.host, e.port ?? '*', e.note || '']);
  console.log(table(['Process', 'Host', 'Port', 'Why it is known'], rows.length ? rows : [['—', '—', '—', 'no baseline yet — every flow will read as unrecognized']]));
  if (args.snapshot) {
    const { flows } = requireSnapshot(args);
    const known = flows.filter((f) => matchFlow(f, bl.entries)).length;
    const pct = flows.length ? Math.round((known / flows.length) * 100) : 0;
    console.log('');
    console.log(table(['Entries', 'Flows in snapshot', 'Known', 'Unrecognized', 'Coverage'], [[
      bl.entries.length, flows.length, known, flows.length - known, `${pct}%`,
    ]]));
  }
}

async function cmdReport(args) {
  rejectVerdict(args);
  const { flows, bytes } = requireSnapshot(args);
  const bl = loadBaseline(args.baseline ? resolve(args.baseline) : null);
  if (bl.error) throw new Error(bl.error);

  const classified = flows.map((f) => ({ ...f, match: matchFlow(f, bl.entries) }));
  const rows = classified.map((f) => [
    f.match ? 'known' : 'unrecognized', f.process, f.proto, f.rhost, f.rport || '—', f.sockets, f.match ? (f.match.note || f.match.host) : '',
  ]);
  console.log(table(['Status', 'Process', 'Proto', 'Destination', 'Port', 'Sockets', 'Known as'], rows));

  // Per-process rollup, with bytes from nettop when captured.
  const byProc = new Map();
  for (const f of classified) {
    const p = byProc.get(f.process) ?? { flows: 0, dests: new Set(), unrec: 0, pid: f.pid };
    p.flows += 1; p.dests.add(f.rhost); if (!f.match) p.unrec += 1;
    byProc.set(f.process, p);
  }
  const procRows = [...byProc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, p]) => {
    const b = bytes.get(p.pid);
    return [name, p.flows, p.dests.size, p.unrec, b ? b.bytesIn : '—', b ? b.bytesOut : '—'];
  });
  console.log('');
  console.log(table(['Process', 'Flows', 'Destinations', 'Unrecognized', 'Bytes in', 'Bytes out'], procRows));

  // Per-destination rollup.
  const byDest = new Map();
  for (const f of classified) {
    const d = byDest.get(f.rhost) ?? { flows: 0, procs: new Set(), known: false };
    d.flows += 1; d.procs.add(f.process); if (f.match) d.known = true;
    byDest.set(f.rhost, d);
  }
  const destRows = [...byDest.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([host, d]) => [
    host, [...d.procs].sort().join(', '), d.flows, d.known ? 'known' : 'unrecognized',
  ]);
  console.log('');
  console.log(table(['Destination', 'Processes', 'Flows', 'Status'], destRows));

  const unrec = classified.filter((f) => !f.match).length;
  console.log('');
  console.log(table(['Flows', 'Known', 'Unrecognized', 'Destinations', 'Processes'], [[
    classified.length, classified.length - unrec, unrec, byDest.size, byProc.size,
  ]]));
  console.log(`\n${unrec} flow(s) are unrecognized — that means "not in your baseline", not "dangerous". Decide which are worth a look, then \`accept\` the ones that are fine.`);
}

async function cmdAccept(args) {
  const path = args.baseline ? resolve(args.baseline) : null;
  if (!path) throw new Error('accept needs --baseline <file> to write into');
  const hosts = args._multi.host || [];
  if (hosts.length === 0) throw new Error('accept needs at least one --host <host-or-prefix> to add');
  if (!args.note) throw new Error('accept needs --note "<why this flow is fine>" — a baseline nobody can read is one nobody will prune');
  const bl = loadBaseline(path);
  if (bl.error) throw new Error(bl.error);

  const added = hosts.map((h) => {
    const e = { host: h, note: String(args.note) };
    if (args.process) e.process = String(args.process);
    if (args.port) e.port = String(args.port);
    const bad = validateBaselineEntry(e, bl.entries.length);
    if (bad) throw new Error(bad);
    return e;
  });

  const receiptPath = args.receipt ? resolve(args.receipt) : `${path}.receipt.json`;
  writeFileSync(receiptPath, JSON.stringify({ baseline: path, before: bl.entries, added }, null, 2));

  const next = [...bl.entries, ...added];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2));

  console.log(table(['Added to baseline', 'Process', 'Port', 'Why'], added.map((e) => [e.host, e.process || '*', e.port ?? '*', e.note])));
  console.log('');
  console.log(table(['Entries now', 'Receipt'], [[next.length, receiptPath]]));
  console.log('\nreversible — restore the "before" list from the receipt to undo this.');
}

const USAGE = `netwatch v${VERSION} — who your computer is actually talking to on the network right now.

  netwatch flows    --snapshot <capture>                      parse a capture into a grounded flow table
  netwatch baseline --baseline <file> [--snapshot <capture>]  show the baseline; with a snapshot, its coverage
  netwatch report   --snapshot <capture> --baseline <file>    classify every flow known-vs-unrecognized
  netwatch accept   --baseline <file> --host <h> --note <why> [--process <p>] [--port <n>]

A flow is only ever "known" (you accepted it) or "unrecognized". netwatch never calls one dangerous.
`;

async function main() {
  const args = argv(process.argv.slice(2));
  const cmd = args._[0];
  if (args.version) return console.log(VERSION);
  try {
    switch (cmd) {
      case 'flows': return await cmdFlows(args);
      case 'baseline': return await cmdBaseline(args);
      case 'report': return await cmdReport(args);
      case 'accept': return await cmdAccept(args);
      default:
        console.log(USAGE);
        process.exitCode = cmd ? 2 : 0;
    }
  } catch (err) {
    console.error(`netwatch: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
