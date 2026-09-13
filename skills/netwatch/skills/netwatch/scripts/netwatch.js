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
import { securitySignals } from './lib/security.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

function argv(args) {
  const out = { _: [], _multi: {} };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, ...rest] = a.slice(2).split('=');
      const inline = rest.length ? rest.join('=') : undefined;
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

export const clean = (s) => String(s ?? '').replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ').replaceAll('|', '¦');
export const table = (headers, rows) => {
  if (rows.length === 0) return '';
  rows = rows.map((r) => r.map(clean));
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
    if (!file || !file.n || !/^\d+$/.test(pid) || !cmd || !['TCP', 'UDP'].includes(file.P)) { file = null; return; }
    const [lhs, rhs] = file.n.split('->');
    const kind = rhs ? 'connection' : file.T === 'LISTEN' ? 'listener' : 'bound';
    const { host: rhost, port: rport } = rhs ? splitAddr(rhs.trim()) : { host: '', port: '' };
    const local = splitAddr(lhs.trim());
    if (!local.host || !local.port || (rhs && (!rhost || rhost === '*' || !/^\d+$/.test(rport)))) { file = null; return; }
    flows.push({
      process: psMap.get(pid) || cmd,
      lsofName: cmd,
      pid,
      proto: file.P || '',
      type: file.t || '',
      lhost: local.host,
      lport: local.port,
      kind,
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
    if (id === 'p') { flush(); pid = val; cmd = ''; }
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
  let header = null;
  for (const line of text.split('\n')) {
    const cells = line.split(',').map((c) => c.trim());
    if (cells.includes('bytes_in') && cells.includes('bytes_out')) { header = cells; continue; }
    for (let i = 0; i < cells.length; i += 1) {
      const m = cells[i].match(/^(.+)\.(\d+)$/);
      if (!m) continue;
      const values = header ? [cells[header.indexOf('bytes_in')], cells[header.indexOf('bytes_out')]] : cells.slice(i + 1, i + 3);
      if (values.length === 2 && values.every((v) => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)))) byPid.set(m[2], { bytesIn: Number(values[0]), bytesOut: Number(values[1]) });
      break;
    }
  }
  return byPid;
}

export function distinctFlows(flows) {
  const map = new Map();
  for (const f of flows) {
    const key = JSON.stringify([f.pid, f.process, f.kind, f.type, f.proto, f.lhost, f.lport, f.rhost, f.rport, f.state]);
    const hit = map.get(key);
    if (hit) { hit.sockets += 1; hit.sources.push(f.source); continue; }
    map.set(key, { ...f, sockets: 1, sources: [f.source], ...lookupProvider(f.rhost || f.lhost) });
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
  if (host !== host.trim()) return `entry ${i}: host has surrounding whitespace`;
  if (host.includes('/') && !ipInCidr(host.split('/')[0], host)) return `entry ${i}: invalid CIDR`;
  if (e.process !== undefined && typeof e.process !== 'string') return `entry ${i}: process must be a string`;
  if (e.port !== undefined && e.port !== '*' && !/^\d+$/.test(String(e.port))) return `entry ${i}: port "${e.port}" is not a number or *`;
  if (e.port !== undefined && e.port !== '*' && (Number(e.port) < 1 || Number(e.port) > 65535)) return `entry ${i}: port is outside 1–65535`;
  if (e.proto !== undefined && !['TCP', 'UDP'].includes(e.proto)) return `entry ${i}: proto must be TCP or UDP`;
  if (e.note !== undefined && typeof e.note !== 'string') return `entry ${i}: note must be a string`;
  return null;
}

export function loadBaseline(path) {
  if (!path || !existsSync(path)) return { entries: [], exists: false };
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); }
  catch (err) { return { entries: [], exists: true, error: `baseline is not valid JSON: ${err.message}` }; }
  const entries = Array.isArray(parsed) ? parsed : parsed?.entries;
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
  if (p.includes(':') && !p.endsWith(':') && !p.includes('/')) return ipInCidr(r, `${p}/128`);
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
  if (flow.kind && flow.kind !== 'connection') return null;
  for (const e of entries) {
    const procOk = !e.process || e.process === '*' || e.process.toLowerCase() === flow.process.toLowerCase();
    const portOk = e.port === undefined || e.port === '*' || String(e.port) === String(flow.rport);
    if (procOk && portOk && (!e.proto || e.proto === flow.proto) && hostMatches(flow.rhost, e.host)) return e;
  }
  return null;
}

// ---------------------------------------------------------------------------

export function requireSnapshot(args) {
  const path = args.snapshot ? resolve(args.snapshot) : null;
  if (!path || !existsSync(path)) throw new Error('no snapshot — capture one first (see references/capture.md) and pass --snapshot <file>');
  const text = readFileSync(path, 'utf8');
  let metadata = null;
  if (text.startsWith('# netwatch ')) {
    try { metadata = JSON.parse(text.split('\n')[0].slice(11)); }
    catch { throw new Error('snapshot metadata header is malformed'); }
    if (!metadata || !Array.isArray(metadata.diagnostics)) throw new Error('snapshot diagnostics are malformed');
  }
  const { lsof, nettop, ps } = splitCapture(text);
  const flows = parseLsof(lsof, parsePs(ps));
  if (flows.length === 0) throw new Error('snapshot has zero connections — an empty capture is refused, not reported as "all clear". Re-capture while something is talking to the network');
  return { flows: distinctFlows(flows), rawCount: flows.length, bytes: parseNettop(nettop), metadata };
}

export function classify(args) {
  const { flows, bytes, metadata } = requireSnapshot(args);
  const bl = loadBaseline(args.baseline ? resolve(args.baseline) : null);
  if (bl.error) throw new Error(bl.error);
  const classified = flows.map((f) => ({ ...f, match: matchFlow(f, bl.entries), signals: securitySignals(f) }))
    .filter((f) => (!args.pid || f.pid === String(args.pid))
      && (!args.process || f.process.toLowerCase().includes(String(args.process).toLowerCase()))
      && (!args.host || hostMatches(f.rhost || f.lhost, args.host))
      && (!args.port || String(f.rport || f.lport) === String(args.port))
      && (!args.proto || f.proto === String(args.proto).toUpperCase())
      && (!args.kind || f.kind === args.kind));
  return { classified, bytes, metadata, entries: bl.entries };
}

function rejectVerdict(args) {
  for (const flag of ['verdict', 'flag', 'severity', 'threat', 'malicious', 'danger', 'dangerous']) {
    if (args[flag] !== undefined) {
      throw new Error(`netwatch does not label flows "${args[flag] === true ? flag : args[flag]}" — the one rule is that a flow is only ever "known" (you accepted it) or "unrecognized". Verdicts are the model's judgment, never this report's`);
    }
  }
}

// Per-process rollup shared by report and render.
export function byProcess(classified, bytes) {
  const m = new Map();
  for (const f of classified) {
    const key = `${f.process} (${f.pid})`;
    const p = m.get(key) ?? { flows: 0, dests: new Set(), unrec: 0, pid: f.pid };
    p.flows += 1; if (f.rhost) p.dests.add(f.rhost); if (!f.match) p.unrec += 1;
    m.set(key, p);
  }
  return [...m.entries()].sort((a, b) => (b[1].unrec - a[1].unrec) || a[0].localeCompare(b[0]))
    .map(([name, p]) => ({ name, ...p, ...(bytes.get(p.pid) || { bytesIn: undefined, bytesOut: undefined }) }));
}

async function cmdFlows(args) {
  const { flows, rawCount } = requireSnapshot(args);
  if (args.json) return console.log(JSON.stringify({ flows, rawCount }, null, 2));
  const rows = flows.map((f) => [f.process, f.pid, f.kind, f.proto, `${f.lhost}:${f.lport}`, f.rhost || '—', f.owner, f.rport || '—', f.state || '—', f.sockets]);
  console.log(table(['Process', 'PID', 'Kind', 'Proto', 'Local', 'Destination', 'Network hint', 'Port', 'State', 'Sockets'], rows));
  console.log('');
  console.log(table(['Distinct flows', 'Sockets', 'Processes'], [[
    flows.length, rawCount, new Set(flows.map((f) => f.pid)).size,
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
  const { classified, bytes, metadata } = classify(args);
  if (args.json) return console.log(JSON.stringify({ flows: classified, bytes: Object.fromEntries(bytes), metadata, limitations: 'Visible socket metadata only; byte counters are process totals, direction and payload encryption unknown. Network labels are offline hints.' }, null, 2));
  if (metadata) console.log(table(['Collector', 'Exit', 'Diagnostic'], metadata.diagnostics.map((d) => [d.tool, d.status ?? 'unavailable', d.error || d.warning || '—'])));
  if (!classified.length) return console.log('No sockets match these filters; this is not an all-clear.');
  const unrec = classified.filter((f) => !f.match);
  const known = classified.filter((f) => f.match);

  // Signal first.
  console.log(table(['Flows', 'Known', 'Unrecognized', 'Destinations', 'Processes'], [[
    classified.length, known.length, unrec.length,
    new Set(classified.map((f) => f.rhost).filter(Boolean)).size, new Set(classified.map((f) => f.pid)).size,
  ]]));

  // Unrecognized leads — it is the thing to look at.
  console.log('\nUNRECOGNIZED — not in your baseline (which is not the same as dangerous)');
  console.log(unrec.length === 0
    ? '\n  none — every live flow matches your baseline.'
    : `\n${table(['Process', 'Destination', 'Network', 'Port', 'Sockets'],
        unrec.map((f) => [`${f.process} (${f.pid})`, f.rhost || `${f.kind} ${f.lhost}:${f.lport}`, f.owner, f.rport || '—', f.sockets]))}`);

  console.log('\nKNOWN — you have vouched for these');
  console.log(known.length === 0
    ? '\n  none yet.'
    : `\n${table(['Process', 'Destination', 'Network', 'Known as'],
        known.map((f) => [`${f.process} (${f.pid})`, f.rhost, f.owner, f.match.note || f.match.host]))}`);

  console.log('\nBY PROCESS — observed counters, not an interval rate or destination totals');
  console.log(table(['Process', 'Flows', 'Destinations', 'Unrecognized', 'Bytes in', 'Bytes out'],
    byProcess(classified, bytes).map((p) => [
      p.name, p.flows, p.dests.size, p.unrec, humanBytes(p.bytesIn), humanBytes(p.bytesOut),
    ])));

  const signals = classified.flatMap((f) => f.signals.map((s) => [f.pid, f.process, s.observation, s.limitation]));
  console.log('\nSECURITY OBSERVATIONS — evidence for investigation, not malware verdicts');
  console.log(signals.length ? table(['PID', 'Process', 'Observation', 'Limit'], signals) : 'No configured indicators observed; this is not proof of safety.');
  console.log(`\n${unrec.length} of ${classified.length} socket flow(s) are unrecognized. Visibility is limited to readable sockets; connection direction and payload encryption are unknown. Network labels are offline hints. Use inspect, diff, or interactive to investigate.`);
}

async function cmdRender(args) {
  rejectVerdict(args);
  const { classified, bytes, metadata } = classify(args);
  const out = resolve(args.out ?? 'netwatch-report.html');
  const css = readFileSync(new URL('../assets/report.css', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../assets/report.js', import.meta.url), 'utf8');

  const unrec = classified.filter((f) => !f.match);
  const known = classified.filter((f) => f.match);
  const dests = new Set(classified.map((f) => f.rhost).filter(Boolean)).size;
  const asOf = args.capturedAt ? String(args.capturedAt) : metadata?.capturedAt || 'moment not dated';

  const flowRow = (f, extra) => `      <tr data-flow data-status="${f.match ? 'known' : 'unrecognized'}" data-kind="${esc(f.kind)}">
        <td class="proc"><details><summary>${esc(f.process)} <span class="mono">${esc(f.pid)}</span></summary>
        <p class="mono">${esc(f.proto)} · ${esc(f.kind)} · ${esc(f.state || 'state unavailable')}<br>Local: ${esc(f.lhost)}:${esc(f.lport)}</p>
        <p>${esc(f.signals.map((s) => `${s.observation}. ${s.limitation}`).join(' ') || 'No configured security indicators observed; not proof of safety.')}</p>
        <pre>${esc(f.sources.join('\n'))}</pre></details></td>
        <td class="host">${esc(f.rhost || `${f.lhost}:${f.lport} (${f.kind})`)}<span class="net"> · ${esc(f.owner)}</span></td>
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
      <p class="dek serif">Observed socket metadata. Open a process row for evidence, filter the view, or sort a column. This file is an offline snapshot.</p>
    </div>
    <div class="meta mono">${classified.length} flows<br>${unrec.length} unrecognized<br>${esc(asOf)}</div>
  </header>

  <div class="signal">
    <div class="stat"><span class="num">${classified.length}</span><span class="lab">Flows</span></div>
    <div class="stat"><span class="num">${known.length}</span><span class="lab">Known</span></div>
    <div class="stat ${unrec.length ? 'alert' : ''}"><span class="num">${unrec.length}</span><span class="lab">Unrecognized</span></div>
    <div class="stat"><span class="num">${dests}</span><span class="lab">Destinations</span></div>
  </div>

  <nav class="controls" aria-label="Filter socket flows">
    <label>Search <input id="search" type="search" placeholder="Process, PID, peer, port, evidence"></label>
    <label>Status <select id="status"><option value="">All statuses</option><option value="unrecognized">Unrecognized</option><option value="known">Known</option></select></label>
    <label>Kind <select id="kind"><option value="">All sockets</option><option value="connection">Connection</option><option value="listener">TCP listener</option><option value="bound">Bound socket</option></select></label>
    <button id="reset" type="button">Reset filters</button>
    <output id="visible" aria-live="polite"></output>
  </nav>
  <noscript>JavaScript is disabled: all captured rows and native expandable evidence remain available.</noscript>
  <p class="lede serif">${metadata ? esc(metadata.diagnostics.map((d) => `${d.tool}: ${d.error || d.warning || `exit ${d.status}`}`).join('; ')) : 'Legacy capture: per-tool diagnostics and capture timing are unavailable.'}</p>

  <section>
    <h2><span class="no">01</span> Unrecognized — worth your eye</h2>
    <p class="lede serif">Not in your baseline — which means you have not vouched for it, not that it is dangerous.</p>
    ${unrec.length === 0
      ? `<p class="empty">${classified.length ? 'Every displayed flow matches your baseline; this does not establish safety.' : 'No sockets match these filters. This is not an all-clear.'}</p>`
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
    <h2><span class="no">03</span> By process — observed counters</h2>
    <p class="lede serif">Totals for the full snapshot, unaffected by view filters. These are process counters, not traffic rates or destination byte totals.</p>
    <table><thead><tr><th>Process</th><th>Flows</th><th>Destinations</th><th>Unrecognized</th><th>Bytes out</th></tr></thead>
    <tbody>
${procRows}
    </tbody></table>
  </section>

  <footer class="colophon">
    <strong>The one rule:</strong> a flow is only ever <em>known</em> (you accepted it) or <em>unrecognized</em> — never dangerous on a hunch.
    Networks are named by an offline allocation hint that may be stale, not verified ownership or a claim about safety.
    Only readable sockets were observed; short-lived connections may be missed. Direction and payload encryption are unknown.
    This report contains metadata that may be sensitive. It cannot capture packets or stop processes; use the netwatch conversation or terminal for live actions.
  </footer>
</div>
<script>
${ui}
</script>
</body>
</html>
`;
  writeFileSync(out, html, { mode: 0o600 });
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
    if (args.proto) e.proto = String(args.proto).toUpperCase();
    const bad = validateBaselineEntry(e, bl.entries.length);
    if (bad) throw new Error(bad);
    return e;
  });

  const receiptPath = args.receipt ? resolve(args.receipt) : `${path}.receipt.json`;
  if (receiptPath === path) throw new Error('receipt must differ from baseline');
  // Validate all inputs before the first write.
  const matchCounts = args.snapshot
    ? (() => { const { flows } = requireSnapshot(args); return added.map((e) => flows.filter((f) => matchFlow(f, [e])).length); })()
    : null;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  mkdirSync(dirname(receiptPath), { recursive: true, mode: 0o700 });
  writeFileSync(receiptPath, JSON.stringify({ baseline: path, before: bl.entries, added }, null, 2));

  const next = [...bl.entries, ...added];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2));

  // With a snapshot in hand, count how many of its flows each just-added
  // entry actually matches. A new entry matching zero is almost always a
  // pattern mistake — the same anti-vacuity doctrine `baseline` already
  // applies to the whole file, applied per entry, at the moment it is
  // written. Exit stays 0 either way: pre-seeding a range that is not live
  // in this snapshot is legitimate, so this is a warning, never a refusal.
  console.log(table(['Added to baseline', 'Process', 'Port', 'Matches now', 'Why'],
    added.map((e, i) => [e.host, e.process || '*', e.port ?? '*', matchCounts ? matchCounts[i] : 'not checked', e.note])));
  console.log('');
  console.log(table(['Entries now', 'Receipt'], [[next.length, receiptPath]]));
  console.log('\nreversible — restore the "before" list from the receipt to undo this.');

  if (matchCounts) {
    const zero = added.filter((_, i) => matchCounts[i] === 0);
    if (zero.length > 0) {
      console.log(`\nzero-match warning: ${zero.map((e) => `"${e.host}"`).join(', ')} matched zero flows in this snapshot — the flow(s) you meant to cover will still read unrecognized. If that is not what you intended, restore the "before" list from ${receiptPath} to undo it.`);
    }
  } else {
    console.log('\ncoverage not checked — pass --snapshot <capture> to see whether each new entry actually matches anything in this run.');
  }
}

const USAGE = `netwatch v${VERSION} — who your computer is actually talking to on the network right now.

  netwatch flows    --snapshot <capture>                      grounded flow table, with the network each reaches
  netwatch baseline --baseline <file> [--snapshot <capture>]  show the baseline; with a snapshot, its coverage
  netwatch report   --snapshot <capture> --baseline <file>    classify every flow known-vs-unrecognized
  netwatch render   --snapshot <capture> --baseline <file> --out <html> [--captured-at <when>]
  netwatch accept   --baseline <file> --host <h> --note <why> [--process <p>] [--port <n>] [--snapshot <capture>]
                    with --snapshot, warns if a just-added entry matches zero flows
  netwatch capture  --out <new-file>                         capture visible sockets on this Mac
  netwatch inspect  --pid <pid> [--out <new-file>]            live executable, owner, signature, sockets
  netwatch diff     --before <capture> --snapshot <capture>   added and closed sockets (no inferred rate)
  netwatch watch    --out <new-directory> [--count 3] [--interval 5]  bounded samples, Ctrl-C to stop
  netwatch interactive [--baseline <file>]                    terminal investigation loop (TTY required)
  netwatch terminate --inspection <file> --confirm <token> [--signal TERM|KILL] --reason <text>
                    exact inspected process only; separate confirmation for force kill
  netwatch packets --interface <if> --host <ip> --out <new-dir> [--port <n>] [--seconds 10] [--count 100] [--snaplen 96] [--sudo]
                    preview first; repeat with --confirm <token> only after the user approves
  report/render filters: --pid, --process, --host, --port, --proto, --kind connection|listener|bound
  report/flows/inspect/diff/capture: --json for structured host integrations

A flow is only ever "known" (you accepted it) or "unrecognized". netwatch never calls one dangerous.
`;

export function validateArgs(cmd, args) {
  const filters = 'pid process host port proto kind';
  const flags = {
    flows: 'snapshot json', baseline: 'baseline snapshot',
    report: `snapshot baseline json ${filters}`, render: `snapshot baseline out capturedAt ${filters}`,
    accept: 'snapshot baseline host note process port proto receipt',
    capture: 'out json', inspect: 'pid out json', diff: 'before snapshot json',
    watch: 'out count interval', interactive: 'baseline',
    terminate: 'inspection confirm reason signal json',
    packets: 'interface host port seconds count snaplen out sudo confirm json',
  };
  if (!flags[cmd]) return;
  if (args._.length > 1) throw new Error('unexpected positional argument');
  const allowed = new Set(flags[cmd].split(' '));
  for (const [key, value] of Object.entries(args)) {
    if (key === '_' || key === '_multi') continue;
    if (!allowed.has(key)) throw new Error(`unsupported option --${key} for ${cmd}`);
    if (['json', 'sudo'].includes(key) ? value !== true : typeof value !== 'string') throw new Error(`invalid value for --${key}`);
    if (args._multi[key]?.length > 1 && !(cmd === 'accept' && key === 'host')) throw new Error(`duplicate option --${key}`);
  }
  if (args.kind && !['connection', 'listener', 'bound'].includes(args.kind)) throw new Error('invalid socket kind');
  if (args.proto && !['TCP', 'UDP'].includes(args.proto.toUpperCase())) throw new Error('protocol must be TCP or UDP');
  if (args.pid && (!/^\d+$/.test(args.pid) || Number(args.pid) < 1)) throw new Error('PID must be a positive integer');
  if (args.port && (!/^\d+$/.test(args.port) || Number(args.port) < 1 || Number(args.port) > 65535)) throw new Error('port must be 1–65535');
}

async function main() {
  try {
    const args = argv(process.argv.slice(2));
    const cmd = args._[0];
    if (args.version) return console.log(VERSION);
    if (args.help) return console.log(USAGE);
    rejectVerdict(args);
    validateArgs(cmd, args);
    switch (cmd) {
      case 'packets': return await (await import('./lib/packets.mjs')).packets(args);
      case 'capture': case 'inspect': case 'diff': case 'watch': case 'interactive': case 'terminate':
        return await (await import('./lib/runtime.mjs')).runCommand(cmd, args);
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
