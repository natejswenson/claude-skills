#!/usr/bin/env node
/**
 * netwatch — the deterministic half of the skill.
 *
 * Everything mechanical lives here so the agent never reshapes output with
 * sed/grep/jq in the transcript: one command returns everything a step needs,
 * already as a table. The agent captures a live snapshot (lsof/nettop/ps) into a
 * file; this binary turns that text into grounded flows, names the network each
 * one reaches (an offline allocation lookup, never a safety verdict), classifies
 * each strictly against a baseline the user built, and refuses — as code, not
 * prose — to ever attach a "dangerous" verdict. The agent's job is the
 * conversation and the judgment; this binary's job is facts.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookupProvider, ipInCidr } from './lib/providers.mjs';

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

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Compact byte counts for humans: 1536 -> "1.5 KB".
export function humanBytes(n) {
  if (n === '—' || n === undefined || n === null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Number(n);
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${i === 0 ? v : v.toFixed(1)} ${u[i]}`;
}

// ---------------------------------------------------------------------------
// Capture parsing. The capture is one text file with up to three labelled
// sections:
//   ===== lsof =====   `lsof -nP -i -FcnPptT`                     (connections)
//   ===== nettop ===== `nettop -P -L 1 -x -J bytes_in,bytes_out`  (byte totals)
//   ===== ps =====     `ps -axo pid=,comm=`                       (clean names)
// Only the lsof section is load-bearing. See references/capture.md.
// ---------------------------------------------------------------------------

export function splitCapture(text) {
  const sections = { lsof: '', nettop: '', ps: '' };
  let current = null;
  for (const raw of text.split('\n')) {
    const m = raw.match(/^=+\s*(lsof|nettop|ps)\s*=+\s*$/i);
    if (m) { current = m[1].toLowerCase(); continue; }
    if (current) sections[current] += `${raw}\n`;
  }
  if (!sections.lsof && !sections.nettop && !sections.ps && /^p\d+/m.test(text)) sections.lsof = text;
  return sections;
}

function splitAddr(addr) {
  const v6 = addr.match(/^\[(.+)\]:(\d+|\*)$/);
  if (v6) return { host: v6[1], port: v6[2] };
  const i = addr.lastIndexOf(':');
  if (i === -1) return { host: addr, port: '' };
  return { host: addr.slice(0, i), port: addr.slice(i + 1) };
}

// pid -> clean process name, from `ps -axo pid=,comm=` (comm is a full path).
export function parsePs(text) {
  const byPid = new Map();
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const comm = m[2].trim();
    byPid.set(m[1], comm.includes('/') ? comm.slice(comm.lastIndexOf('/') + 1) : comm);
  }
  return byPid;
}

export function parseLsof(text, psMap = new Map()) {
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
      process: psMap.get(pid) || cmd,
      lsofName: cmd,
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

export function distinctFlows(flows) {
  const map = new Map();
  for (const f of flows) {
    const key = `${f.process}|${f.proto}|${f.rhost}|${f.rport}|${f.state}`;
    const hit = map.get(key);
    if (hit) { hit.sockets += 1; continue; }
    map.set(key, { ...f, sockets: 1, ...lookupProvider(f.rhost) });
  }
  return [...map.values()].sort((a, b) =>
    a.process.localeCompare(b.process) || a.rhost.localeCompare(b.rhost)
    || Number(a.rport) - Number(b.rport) || a.proto.localeCompare(b.proto));
}

// ---------------------------------------------------------------------------
// Baseline — { process?, host, port?, note }. `host` is required and may never
// match everything. See references/baseline.md.
// ---------------------------------------------------------------------------

export function validateBaselineEntry(e, i) {
  if (typeof e !== 'object' || e === null) return `entry ${i}: not an object`;
  const host = e.host;
  if (typeof host !== 'string' || host.trim() === '') return `entry ${i}: names no host — an entry that matches everything is refused`;
  if (host === '*' || host === '.' || host === '*.' || host === '**' || host === ':' || host === '::') return `entry ${i}: host "${host}" matches everything — refused`;
  if (/\/0+\s*$/.test(host)) return `entry ${i}: CIDR "${host}" is a /0 and matches everything — refused`;
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
  const r = String(rhost).toLowerCase();
  const p = String(pattern).toLowerCase();
  if (p === r) return true;
  if (p.includes('/')) return ipInCidr(r, p);
  if (p.startsWith('.')) return r === p.slice(1) || r.endsWith(p);
  if (p.endsWith('.')) return r.startsWith(p);
  // Trailing colon: N complete hextets name a /(16*N) IPv6 prefix, the same
  // symmetry as trailing-dot for IPv4 (N complete octets -> /(8*N)). Desugars
  // to CIDR rather than a string startsWith, because IPv6 text is not
  // canonical — "fe80::" would `startsWith` fail against an address whose
  // scope id sits between, even though it is the same /16.
  if (p.endsWith(':')) {
    const groups = p.replace(/:+$/, '').split(':').filter(Boolean);
    if (groups.length === 0) return false; // bare ":" / "::" — refused at validation, never matches here either
    return ipInCidr(r, `${groups.join(':')}::/${groups.length * 16}`);
  }
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
  const { lsof, nettop, ps } = splitCapture(text);
  const flows = parseLsof(lsof, parsePs(ps));
  if (flows.length === 0) throw new Error('snapshot has zero connections — an empty capture is refused, not reported as "all clear". Re-capture while something is talking to the network');
  return { flows: distinctFlows(flows), rawCount: flows.length, bytes: parseNettop(nettop) };
}

function classify(args) {
  const { flows, bytes } = requireSnapshot(args);
  const bl = loadBaseline(args.baseline ? resolve(args.baseline) : null);
  if (bl.error) throw new Error(bl.error);
  const classified = flows.map((f) => ({ ...f, match: matchFlow(f, bl.entries) }));
  return { classified, bytes, entries: bl.entries };
}

function rejectVerdict(args) {
  for (const flag of ['verdict', 'flag', 'severity', 'threat', 'malicious', 'danger', 'dangerous']) {
    if (args[flag] !== undefined) {
      throw new Error(`netwatch does not label flows "${args[flag] === true ? flag : args[flag]}" — the one rule is that a flow is only ever "known" (you accepted it) or "unrecognized". Verdicts are the model's judgment, never this report's`);
    }
  }
}

// Per-process rollup shared by report and render.
function byProcess(classified, bytes) {
  const m = new Map();
  for (const f of classified) {
    const p = m.get(f.process) ?? { flows: 0, dests: new Set(), unrec: 0, pid: f.pid };
    p.flows += 1; p.dests.add(f.rhost); if (!f.match) p.unrec += 1;
    m.set(f.process, p);
  }
  return [...m.entries()].sort((a, b) => (b[1].unrec - a[1].unrec) || a[0].localeCompare(b[0]))
    .map(([name, p]) => ({ name, ...p, ...(bytes.get(p.pid) || { bytesIn: undefined, bytesOut: undefined }) }));
}

async function cmdFlows(args) {
  const { flows, rawCount } = requireSnapshot(args);
  const rows = flows.map((f) => [f.process, f.proto, f.rhost, f.owner, f.rport || '—', f.state || '—', f.sockets]);
  console.log(table(['Process', 'Proto', 'Destination', 'Network', 'Port', 'State', 'Sockets'], rows));
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
  const { classified, bytes } = classify(args);
  const unrec = classified.filter((f) => !f.match);
  const known = classified.filter((f) => f.match);

  // Signal first.
  console.log(table(['Flows', 'Known', 'Unrecognized', 'Destinations', 'Processes'], [[
    classified.length, known.length, unrec.length,
    new Set(classified.map((f) => f.rhost)).size, new Set(classified.map((f) => f.process)).size,
  ]]));

  // Unrecognized leads — it is the thing to look at.
  console.log('\nUNRECOGNIZED — not in your baseline (which is not the same as dangerous)');
  console.log(unrec.length === 0
    ? '\n  none — every live flow matches your baseline.'
    : `\n${table(['Process', 'Destination', 'Network', 'Port', 'Sockets'],
        unrec.map((f) => [f.process, f.rhost, f.owner, f.rport || '—', f.sockets]))}`);

  console.log('\nKNOWN — you have vouched for these');
  console.log(known.length === 0
    ? '\n  none yet.'
    : `\n${table(['Process', 'Destination', 'Network', 'Known as'],
        known.map((f) => [f.process, f.rhost, f.owner, f.match.note || f.match.host]))}`);

  console.log('\nBY PROCESS — how much each moved');
  console.log(table(['Process', 'Flows', 'Destinations', 'Unrecognized', 'Bytes in', 'Bytes out'],
    byProcess(classified, bytes).map((p) => [
      p.name, p.flows, p.dests.size, p.unrec, humanBytes(p.bytesIn), humanBytes(p.bytesOut),
    ])));

  console.log(`\n${unrec.length} of ${classified.length} flow(s) are unrecognized — decide which are worth a look, then \`accept\` the ones that are fine. Run \`render\` for a shareable report.`);
}

async function cmdRender(args) {
  rejectVerdict(args);
  const { classified, bytes } = classify(args);
  const out = resolve(args.out ?? 'netwatch-report.html');
  const css = readFileSync(new URL('../assets/report.css', import.meta.url), 'utf8');

  const unrec = classified.filter((f) => !f.match);
  const known = classified.filter((f) => f.match);
  const dests = new Set(classified.map((f) => f.rhost)).size;
  const asOf = args.capturedAt ? String(args.capturedAt) : 'moment not dated';

  const flowRow = (f, extra) => `      <tr>
        <td class="proc">${esc(f.process)}</td>
        <td class="host">${esc(f.rhost)}<span class="net"> · ${esc(f.owner)}</span></td>
        <td class="mono">${esc(f.rport || '—')}</td>
        ${extra}
      </tr>`;

  const unrecRows = unrec.map((f) => flowRow(f, `<td class="mono">${f.sockets}</td>`)).join('\n');
  const knownRows = known.map((f) => flowRow(f, `<td class="net">${esc(f.match.note || f.match.host)}</td>`)).join('\n');

  const procs = byProcess(classified, bytes);
  const maxOut = Math.max(1, ...procs.map((p) => Number(p.bytesOut) || 0));
  const procRows = procs.map((p) => {
    const outN = Number(p.bytesOut) || 0;
    const w = Math.max(1, Math.round((outN / maxOut) * 120));
    const bar = p.bytesOut === undefined ? '<span class="bar-num">—</span>'
      : `<span class="bar-wrap"><span class="bar" style="width:${w}px"></span><span class="bar-num">${esc(humanBytes(p.bytesOut))}</span></span>`;
    return `      <tr>
        <td class="proc">${esc(p.name)}</td>
        <td class="mono">${p.flows}</td>
        <td class="mono">${p.dests.size}</td>
        <td class="tag ${p.unrec ? 'unrecognized' : 'known'}">${p.unrec || '0'}</td>
        <td>${bar}</td>
      </tr>`;
  }).join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Network activity — netwatch</title>
<style>
${css}
</style>
</head>
<body>
<div class="sheet">
  <header class="masthead">
    <div class="stamp">NW</div>
    <div>
      <div class="eyebrow">netwatch — live network activity</div>
      <h1>What your machine is talking to</h1>
      <p class="dek serif">Every connection open at one moment, grounded in what the capture held — connection metadata only, never packet contents.</p>
    </div>
    <div class="meta mono">${classified.length} flows<br>${unrec.length} unrecognized<br>${esc(asOf)}</div>
  </header>

  <div class="signal">
    <div class="stat"><span class="num">${classified.length}</span><span class="lab">Flows</span></div>
    <div class="stat"><span class="num">${known.length}</span><span class="lab">Known</span></div>
    <div class="stat ${unrec.length ? 'alert' : ''}"><span class="num">${unrec.length}</span><span class="lab">Unrecognized</span></div>
    <div class="stat"><span class="num">${dests}</span><span class="lab">Destinations</span></div>
  </div>

  <section>
    <h2><span class="no">01</span> Unrecognized — worth your eye</h2>
    <p class="lede serif">Not in your baseline — which means you have not vouched for it, not that it is dangerous.</p>
    ${unrec.length === 0
      ? '<p class="empty">Every live flow matches your baseline.</p>'
      : `<table><thead><tr><th>Process</th><th>Destination · network</th><th>Port</th><th>Sockets</th></tr></thead>
    <tbody>
${unrecRows}
    </tbody></table>`}
  </section>

  <section>
    <h2><span class="no">02</span> Known — vouched for</h2>
    ${known.length === 0
      ? '<p class="empty">Nothing accepted into the baseline yet.</p>'
      : `<table><thead><tr><th>Process</th><th>Destination · network</th><th>Port</th><th>Known as</th></tr></thead>
    <tbody>
${knownRows}
    </tbody></table>`}
  </section>

  <section>
    <h2><span class="no">03</span> By process — how much moved</h2>
    <table><thead><tr><th>Process</th><th>Flows</th><th>Destinations</th><th>Unrecognized</th><th>Bytes out</th></tr></thead>
    <tbody>
${procRows}
    </tbody></table>
  </section>

  <footer class="colophon">
    <strong>The one rule:</strong> a flow is only ever <em>known</em> (you accepted it) or <em>unrecognized</em> — never dangerous on a hunch.
    Networks are named by an offline allocation lookup (likely operator), not a claim about the traffic.
    Nothing here was moved or changed; the capture read connection metadata only.
  </footer>
</div>
</body>
</html>
`;
  writeFileSync(out, html);
  console.log(table(['Report', 'Flows', 'Unrecognized'], [[out, classified.length, unrec.length]]));
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

  netwatch flows    --snapshot <capture>                      grounded flow table, with the network each reaches
  netwatch baseline --baseline <file> [--snapshot <capture>]  show the baseline; with a snapshot, its coverage
  netwatch report   --snapshot <capture> --baseline <file>    classify every flow known-vs-unrecognized
  netwatch render   --snapshot <capture> --baseline <file> --out <html> [--captured-at <when>]
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
      case 'render': return await cmdRender(args);
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

// Only run when executed directly, never when imported by the test suite.
// Both sides are realpath'd: under npm/npx argv[1] is a symlink while
// import.meta.url is the resolved file, so a naive === makes every invocation
// a silent no-op.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) main();
