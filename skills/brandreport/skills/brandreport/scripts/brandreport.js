#!/usr/bin/env node
/**
 * brandreport — the deterministic half of the skill.
 *
 * Everything mechanical lives here so the agent never reshapes output with
 * sed/grep/jq in the transcript: one command returns everything a step needs,
 * already as a table. The agent's job is the blind discovery and the identity
 * judgment; this binary's job is provenance, the attribution gate, and the
 * offline render. Nothing here ever touches the network.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve, join, extname, basename } from 'node:path';
import { homedir } from 'node:os';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

function argv(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inline !== undefined) out[key] = inline;
      else if (args[i + 1] && !args[i + 1].startsWith('--')) { out[key] = args[i + 1]; i += 1; }
      else out[key] = true;
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

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const need = (args, flag) => {
  const v = args[flag];
  if (v === undefined || v === true || String(v).trim() === '') throw new Error(`--${flag} is required`);
  return String(v);
};

// ── run layout ─────────────────────────────────────────────────────────────

function loadRun(args) {
  const run = resolve(need(args, 'run'));
  const subjectPath = join(run, 'subject.json');
  if (!existsSync(subjectPath)) throw new Error(`${run} is not a brandreport run (no subject.json) — start one with \`brandreport init\``);
  const subject = JSON.parse(readFileSync(subjectPath, 'utf8'));
  return { run, subject, snapshotsDir: join(run, 'snapshots'), findingsPath: join(run, 'findings.json') };
}

function loadSnapshots(snapshotsDir) {
  if (!existsSync(snapshotsDir)) return [];
  return readdirSync(snapshotsDir)
    .filter((f) => f.endsWith('.meta.json'))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0))
    .map((f) => JSON.parse(readFileSync(join(snapshotsDir, f), 'utf8')));
}

// ── commands ───────────────────────────────────────────────────────────────

async function cmdInit(args) {
  const subject = need(args, 'subject');
  const slug = slugify(subject);
  const run = resolve(args.out ?? join(homedir(), '.claude', 'brandreport', slug));
  if (existsSync(join(run, 'subject.json'))) throw new Error(`${run} already holds a run for this subject — pass a different --out or continue that run`);
  mkdirSync(join(run, 'snapshots'), { recursive: true });
  writeFileSync(join(run, 'subject.json'), JSON.stringify({ subject, slug, created: new Date().toISOString() }, null, 2) + '\n');
  writeFileSync(join(run, 'findings.json'), JSON.stringify({
    subject,
    claims: [],
    read: { themes: [], gaps: [], summary: '' },
    unconfirmed: [],
  }, null, 2) + '\n');
  console.log(table(['Piece', 'Path'], [
    ['snapshots', join(run, 'snapshots')],
    ['findings', join(run, 'findings.json')],
    ['report', join(run, 'report.html')],
  ]));
}

async function cmdAdd(args) {
  const { run, snapshotsDir } = loadRun(args);
  const file = resolve(need(args, 'file'));
  if (!existsSync(file)) throw new Error(`no such file: ${file}`);
  const url = need(args, 'url');
  const kind = need(args, 'kind');
  const status = need(args, 'status');
  if (status !== 'confirmed' && status !== 'unconfirmed') throw new Error(`--status must be confirmed or unconfirmed, got "${status}"`);
  // The one rule, enforced at the door as well as at the gate: a confirmed
  // artifact records HOW it was tied to the person; an unconfirmed one records
  // why it could not be — so nothing is ever silently included or dropped.
  const corroboration = status === 'confirmed' ? need(args, 'corroboration') : '';
  const why = status === 'unconfirmed' ? need(args, 'why') : '';
  const existing = loadSnapshots(snapshotsDir);
  const id = `s${existing.length + 1}`;
  const ext = extname(file) || '.txt';
  const meta = {
    id,
    url,
    kind,
    platform: args.platform ? String(args.platform) : new URL(url).hostname.replace(/^www\./, ''),
    title: args.title ? String(args.title) : basename(file),
    status,
    ...(status === 'confirmed' ? { corroboration } : { why }),
    fetchedAt: args.fetchedAt ? String(args.fetchedAt) : new Date().toISOString(),
    file: `${id}${ext}`,
  };
  copyFileSync(file, join(snapshotsDir, meta.file));
  writeFileSync(join(snapshotsDir, `${id}.meta.json`), JSON.stringify(meta, null, 2) + '\n');
  console.log(table(['Id', 'Platform', 'Kind', 'Status', 'Tied by / why not'],
    [[id, meta.platform, kind, status, corroboration || why]]));
  void run;
}

async function cmdStatus(args) {
  const { snapshotsDir } = loadRun(args);
  const snaps = loadSnapshots(snapshotsDir);
  if (snaps.length === 0) { console.log('corpus is empty — nothing filed yet'); return; }
  console.log(table(['Id', 'Platform', 'Kind', 'Status', 'Tied by / why not'],
    snaps.map((s) => [s.id, s.platform, s.kind, s.status, (s.corroboration || s.why || '').slice(0, 60)])));
  const confirmed = snaps.filter((s) => s.status === 'confirmed').length;
  console.log(`\n${confirmed} confirmed, ${snaps.length - confirmed} unconfirmed, ${snaps.length} total`);
}

// The one rule as code. Returns [violations], each [check, where, problem].
function gateViolations({ snapshotsDir, findingsPath, subject }) {
  const v = [];
  const snaps = loadSnapshots(snapshotsDir);
  const byId = new Map(snaps.map((s) => [s.id, s]));
  let findings;
  try {
    findings = JSON.parse(readFileSync(findingsPath, 'utf8'));
  } catch (e) {
    return { violations: [['findings', 'findings.json', `missing or unparsable: ${e.message}`]], snaps, findings: null };
  }
  if (findings.subject !== subject.subject) v.push(['findings', 'findings.json', `subject "${findings.subject}" does not match run subject "${subject.subject}"`]);
  for (const s of snaps) {
    if (s.status === 'confirmed' && !String(s.corroboration ?? '').trim()) v.push(['corroboration', s.id, 'confirmed but records no corroborating signal']);
    if (s.status === 'unconfirmed' && !String(s.why ?? '').trim()) v.push(['why', s.id, 'unconfirmed but records no reason it could not be tied']);
  }
  const cite = (owner, sources) => {
    if (!Array.isArray(sources) || sources.length === 0) { v.push(['citation', owner, 'cites no sources at all']); return; }
    for (const id of sources) {
      const s = byId.get(id);
      if (!s) v.push(['citation', owner, `cites ${id}, which is not in the corpus`]);
      else if (s.status !== 'confirmed') v.push(['attribution', owner, `cites ${id}, which is unconfirmed — unverified content must not be attributed`]);
    }
  };
  (findings.claims ?? []).forEach((c, i) => cite(c.id ?? `claims[${i}]`, c.sources));
  (findings.read?.themes ?? []).forEach((t, i) => cite(`theme "${t.name ?? i}"`, t.sources));
  const listed = new Set((findings.unconfirmed ?? []).flatMap((u) => u.sources ?? []));
  for (const s of snaps) {
    if (s.status === 'unconfirmed' && !listed.has(s.id)) v.push(['residue', s.id, 'unconfirmed snapshot is not listed in findings.unconfirmed — never silently dropped']);
  }
  (findings.unconfirmed ?? []).forEach((u, i) => {
    for (const id of u.sources ?? []) {
      const s = byId.get(id);
      if (!s) v.push(['residue', `unconfirmed[${i}]`, `cites ${id}, which is not in the corpus`]);
      else if (s.status !== 'unconfirmed') v.push(['residue', `unconfirmed[${i}]`, `lists ${id} as unconfirmed but the corpus marks it confirmed`]);
    }
  });
  return { violations: v, snaps, findings };
}

async function cmdGate(args) {
  const ctx = loadRun(args);
  const { violations, snaps, findings } = gateViolations(ctx);
  if (violations.length > 0) {
    console.log(table(['Check', 'Where', 'Problem'], violations));
    throw new Error(`${violations.length} violation${violations.length === 1 ? '' : 's'} — nothing renders until the corpus and findings agree`);
  }
  const confirmed = snaps.filter((s) => s.status === 'confirmed').length;
  console.log(table(['Gate', 'Result'], [
    ['snapshots', `${confirmed} confirmed, ${snaps.length - confirmed} unconfirmed, all with recorded reasons`],
    ['claims', `${(findings.claims ?? []).length} claims, every citation resolves to a confirmed snapshot`],
    ['themes', `${(findings.read?.themes ?? []).length} themes, same rule`],
    ['residue', 'every unconfirmed snapshot is listed, none attributed'],
  ]));
}

// ── report ─────────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cites = (sources) => `<span class="cite">${(sources ?? []).map(esc).join(' ')}</span>`;

async function cmdReport(args) {
  const ctx = loadRun(args);
  const { violations, snaps, findings } = gateViolations(ctx);
  if (violations.length > 0) {
    console.log(table(['Check', 'Where', 'Problem'], violations));
    throw new Error('the gate is not clean — the report renders only what the corpus can prove');
  }
  const out = resolve(args.out ?? join(ctx.run, 'report.html'));
  const css = readFileSync(new URL('../assets/report.css', import.meta.url), 'utf8');
  const confirmed = snaps.filter((s) => s.status === 'confirmed');
  const unconfirmedSnaps = snaps.filter((s) => s.status === 'unconfirmed');
  // No wall-clock time anywhere: the report is dated by its own corpus, so a
  // re-render of a frozen run is byte-identical.
  const asOf = snaps.map((s) => s.fetchedAt).sort().at(-1)?.slice(0, 10) ?? '';
  const initials = ctx.subject.subject.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? '').join('').slice(0, 3);

  const coverageRows = confirmed.map((s) => `<tr><td class="mono">${esc(s.id)}</td><td>${esc(s.platform)}</td><td>${esc(s.kind)}</td><td><a href="${esc(s.url)}">${esc(s.title)}</a></td><td class="mono">${esc(s.fetchedAt.slice(0, 10))}</td></tr>`).join('\n');
  const claimItems = (findings.claims ?? []).map((c) => `<li>${esc(c.text)} ${cites(c.sources)}</li>`).join('\n');
  const themeBlocks = (findings.read?.themes ?? []).map((t) => `<div class="theme"><h3>${esc(t.name)} ${cites(t.sources)}</h3><p>${esc(t.text)}</p></div>`).join('\n');
  const gapItems = (findings.read?.gaps ?? []).map((g) => `<li class="serif">${esc(g)}</li>`).join('\n');
  const residueBlocks = (findings.unconfirmed ?? []).map((u) => {
    const srcs = (u.sources ?? []).map((id) => snaps.find((s) => s.id === id)).filter(Boolean);
    const rows = srcs.map((s) => `<tr><td class="mono">${esc(s.id)}</td><td>${esc(s.platform)}</td><td><a href="${esc(s.url)}">${esc(s.title)}</a></td><td class="serif">${esc(s.why)}</td></tr>`).join('\n');
    return `<p class="serif">${esc(u.note)}</p><table><thead><tr><th>Id</th><th>Platform</th><th>Where</th><th>Why it could not be tied</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(ctx.subject.subject)} — brand report</title>
<style>
${css}
</style>
</head>
<body>
<div class="sheet">
  <header class="masthead">
    <div class="stamp">${esc(initials)}</div>
    <div>
      <div class="eyebrow">brandreport — personal online brand</div>
      <h1>${esc(ctx.subject.subject)}</h1>
      <p class="dek serif">What the open web says, kept only where it can be proven.</p>
    </div>
    <div class="meta mono">${confirmed.length} confirmed sources<br>${unconfirmedSnaps.length} same-name, unconfirmed<br>corpus as of ${esc(asOf)}</div>
  </header>

  <section>
    <h2><span class="no">01</span> Where you were found</h2>
    <table><thead><tr><th>Id</th><th>Platform</th><th>Kind</th><th>Artifact</th><th>Fetched</th></tr></thead>
    <tbody>
${coverageRows}
    </tbody></table>
  </section>

  <section>
    <h2><span class="no">02</span> The confirmed presence</h2>
    <ul class="claims">
${claimItems}
    </ul>
  </section>

  <section>
    <h2><span class="no">03</span> The read</h2>
${themeBlocks}
    ${gapItems ? `<h3>What is missing</h3><ul class="gaps">\n${gapItems}\n</ul>` : ''}
    <p class="summary serif">${esc(findings.read?.summary ?? '')}</p>
  </section>

  <section>
    <h2><span class="no">04</span> Same name, not you</h2>
${residueBlocks || '<p class="serif">Nothing found under this name failed the identity gate.</p>'}
  </section>

  <footer class="colophon mono">every claim above cites a snapshot in this run's corpus · ${confirmed.length + unconfirmedSnaps.length} artifacts · nothing attributed without a recorded tie</footer>
</div>
</body>
</html>
`;
  writeFileSync(out, html);
  console.log(table(['Report', 'Sections', 'Sources cited'], [[out, 4, confirmed.length]]));
}

const USAGE = `brandreport v${VERSION} — Give it just a name; it blind-searches the open web for that person's presence, keeps only what it can prove is them, and renders what it found as a press-styled brand report.

  brandreport init   --subject <name> [--out <dir>]
  brandreport add    --run <dir> --file <path> --url <url> --kind <profile|site|post|mention|search>
                     --status confirmed --corroboration "<how it was tied>"
                     --status unconfirmed --why "<why it could not be tied>"
                     [--platform <name>] [--title <t>] [--fetched-at <iso>]
  brandreport status --run <dir>
  brandreport gate   --run <dir>
  brandreport report --run <dir> [--out <file>]
`;

async function main() {
  const args = argv(process.argv.slice(2));
  const cmd = args._[0];
  if (args.version) return console.log(VERSION);
  try {
    switch (cmd) {
      case 'init': return await cmdInit(args);
      case 'add': return await cmdAdd(args);
      case 'status': return await cmdStatus(args);
      case 'gate': return await cmdGate(args);
      case 'report': return await cmdReport(args);
      default:
        console.log(USAGE);
        process.exitCode = cmd ? 2 : 0;
    }
  } catch (err) {
    console.error(`brandreport: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
