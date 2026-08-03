#!/usr/bin/env node
/**
 * release — the deterministic half of the skill.
 *
 * Everything mechanical lives here so the agent never reshapes output with
 * sed/grep/jq in the transcript: one command returns everything a step needs,
 * already as a table. The agent's job is the conversation; this binary's job
 * is facts.
 *
 * This file deliberately implements NO release logic. Reading versions,
 * resolving components, computing bumps, writing files, opening PRs and
 * proving the tag are all shipflow's — see `skills/shipflow`. What lives here
 * is the three things shipflow has no business knowing: which binary to call
 * and whether it is new enough, how to shape its JSON into the house's tables,
 * and how to turn commit subjects into a CHANGELOG draft in this repo's style.
 *
 * Two tools answering "how do I release this?" differently is worse than
 * either answer, so when something is missing here, add it to shipflow.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

// Every mutating step is one of shipflow's `release-*` commands, which landed
// in 0.4.0. An older shipflow fails three steps later with an obscure "Unknown
// command" — checking up front turns that into one plain sentence. Bumped to
// 0.6.0 for `devAhead` / the `dev-ahead-of-main` refusal (issue #173): an
// older shipflow returns a status that looks identical but silently lets
// `cut` tag whatever is on main even when dev already carries the version
// actually being released — the same failure this gate exists to catch, so
// the gate itself must not be satisfiable by the shipflow that has it.
const MIN_SHIPFLOW = '0.6.0';

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

const cmp = (a, b) => {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  return 0;
};

// ─── the shipflow binary ─────────────────────────────────────────────────────
// A checkout that SHIPS shipflow uses its own copy. That is not a convenience:
// it is what lets `ci / release` run without reaching the npm registry, and it
// is what makes a dogfood run exercise the code in the branch rather than the
// last published version. Everywhere else, npx — always with the explicit
// @latest tag, because a bare `npx @natjswenson/shipflow` silently prefers a
// stale global install already on PATH over the current registry version, with
// no warning. That cost this repo a release once already.
export function resolveShipflow(repoPath) {
  const inRepo = join(repoPath, 'skills', 'shipflow', 'skills', 'shipflow', 'bin', 'shipflow.js');
  if (existsSync(inRepo)) return { cmd: process.execPath, args: [inRepo], where: 'in-repo' };
  return { cmd: 'npx', args: ['-y', '@natjswenson/shipflow@latest'], where: 'npx @latest' };
}

export function shipflowVersion(bin) {
  const r = spawnSync(bin.cmd, [...bin.args, '-v'], { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) return null;
  return r.stdout.trim().split('\n').pop().trim();
}

function shipflow(repoPath, args) {
  const bin = resolveShipflow(repoPath);
  const found = shipflowVersion(bin);
  if (!found) {
    throw new Error(`shipflow-unavailable: could not run shipflow (${bin.where}). It is required for every step that changes anything.`);
  }
  if (cmp(found, MIN_SHIPFLOW) < 0) {
    throw new Error(`shipflow-too-old: found ${found} (${bin.where}), need >= ${MIN_SHIPFLOW}. The release-* commands did not exist before ${MIN_SHIPFLOW}.`);
  }
  // No shell, argv-style: component names and versions reach a subprocess.
  const r = spawnSync(bin.cmd, [...bin.args, ...args], { encoding: 'utf8', timeout: 600_000 });
  const stdout = (r.stdout || '').trim();
  const stderr = (r.stderr || '').trim();
  if (r.status !== 0) {
    let message = stderr || stdout || `shipflow exited ${r.status}`;
    try {
      message = JSON.parse(stderr).error ?? message;
    } catch { /* stderr was not JSON — use it raw */ }
    throw new Error(message);
  }
  try {
    return { data: JSON.parse(stdout), shipflowVersion: found, where: bin.where };
  } catch {
    throw new Error(`shipflow returned output that is not JSON: ${stdout.slice(0, 200)}`);
  }
}

// The declared component list. This reads the config rather than asking
// shipflow because it is a literal array in a committed file, not derived
// logic — there is nothing here to keep in sync. Anything that INTERPRETS a
// component (paths, versions, tags) goes through shipflow, always.
function declaredComponents(repoPath) {
  const path = join(repoPath, '.github', 'shipflow.json');
  if (!existsSync(path)) {
    throw new Error(`no .github/shipflow.json in ${repoPath} — run the shipflow skill to set this repo up first`);
  }
  const config = JSON.parse(readFileSync(path, 'utf8'));
  const declared = config?.release?.components;
  if (Array.isArray(declared) && declared.length > 0) {
    return declared.map((e) => (typeof e === 'string' ? e : e?.name)).filter(Boolean);
  }
  return [null]; // single inferred component — shipflow resolves it, --component omitted
}

// ─── preflight ───────────────────────────────────────────────────────────────

// Extracted so the "`On dev` cannot silently vanish" regression can assert
// against it directly rather than re-parsing console output.
export const PREFLIGHT_HEADERS = ['Component', 'State', 'On main', 'On dev', 'Last tag', 'Unreleased commits', 'Blockers'];

async function cmdPreflight(args) {
  const repo = resolve(args.repo ?? '.');
  const names = args.component ? [args.component] : declaredComponents(repo);

  const rows = [];
  let meta = null;
  const detail = [];
  for (const name of names) {
    const call = ['release-status', '--repo', repo, ...(name ? ['--component', name] : [])];
    let status;
    try {
      status = shipflow(repo, call);
    } catch (err) {
      rows.push([name ?? '(root)', 'ERROR', '—', '—', '—', '—', err.message.slice(0, 60)]);
      continue;
    }
    meta ??= status;
    const s = status.data;
    rows.push([
      s.component.name,
      s.state,
      s.versionOnMain ?? '—',
      s.versionOnDev ?? '—',
      s.lastTag ?? 'never released',
      String(s.commits.length),
      s.blockers.length ? s.blockers.map((b) => b.id).join(', ') : '—',
    ]);
    if (names.length === 1) detail.push(s);
  }

  console.log(table(PREFLIGHT_HEADERS, rows));

  for (const s of detail) {
    if (s.commits.length > 0) {
      console.log(`\n${table(
        ['Commit', 'Type', 'Subject'],
        s.commits.map((c) => [c.sha, c.breaking ? `${c.type ?? '?'}!` : (c.type ?? '—'), c.subject]),
      )}`);
      console.log(`\n${table(
        ['Suggested bump', 'Next version', 'Because'],
        [[s.suggestedBump ?? '—', s.nextVersion ?? '—', s.suggestedBumpReason]],
      )}`);
      if (s.suggestedBumpCapped) {
        console.log('\nNOTE: a breaking change was capped at minor because this component is still 0.x. Going to 1.0.0 is your call.');
      }
    }
    // The collateral table is printed even when empty, and says so explicitly.
    // A silently-absent section reads as "nothing to see"; an explicit "none"
    // is the difference between a checked question and an unasked one.
    if (s.collateral.length > 0) {
      console.log(`\nALSO RELEASED by the same promotion — a promotion is atomic and carries all of dev:`);
      console.log(table(['Component', 'Version', 'Tag it would cut'], s.collateral.map((c) => [c.name, c.version ?? '?', c.tag ?? '?'])));
    } else {
      console.log('\nCollateral: none — no other component is bumped-but-untagged on dev.');
    }
    if (s.blockers.length > 0) {
      console.log(`\n${table(['Blocker', 'Detail'], s.blockers.map((b) => [b.id, b.detail]))}`);
    }
    for (const n of s.notes) console.log(`\nnote: ${n}`);
    console.log(`\nstatusHash: ${s.statusHash}`);
  }

  if (meta) console.log(`\nshipflow ${meta.shipflowVersion} (${meta.where})`);

  // Exit non-zero when the one named component cannot be released. This is what
  // makes preflight a gate rather than a report: a blocked component must not
  // read as "fine" to anything downstream that only checks the exit code.
  const blocked = detail.filter((s) => s.blockers.length > 0);
  if (blocked.length > 0) process.exitCode = 1;
}

// ─── changelog draft ─────────────────────────────────────────────────────────
// Conventional types → Keep-a-Changelog sections. `Internal` is last and is
// expected to be deleted by the author more often than not; `Uncategorised`
// exists so a non-conventional commit is never silently dropped.
const SECTIONS = [
  { title: 'Added', types: ['feat'] },
  { title: 'Fixed', types: ['fix'] },
  { title: 'Changed', types: ['perf', 'refactor', 'revert'] },
  { title: 'Internal', types: ['chore', 'docs', 'test', 'ci', 'build', 'style'] },
  { title: 'Uncategorised', types: [] },
];

export function groupCommits(commits) {
  const groups = SECTIONS.map((s) => ({ title: s.title, commits: [] }));
  const index = new Map(SECTIONS.flatMap((s, i) => s.types.map((t) => [t, i])));
  const fallback = SECTIONS.length - 1;
  for (const c of commits) {
    groups[index.get(c.type) ?? fallback].commits.push(c);
  }
  // Anti-vacuity: every commit must land in exactly one section. A grouping
  // that silently drops a commit still produces a plausible-looking entry,
  // which is precisely the failure that would never be noticed.
  const placed = groups.reduce((n, g) => n + g.commits.length, 0);
  if (placed !== commits.length) {
    throw new Error(`grouping dropped ${commits.length - placed} of ${commits.length} commits — refusing to emit an incomplete draft`);
  }
  return groups.filter((g) => g.commits.length > 0);
}

export function renderDraft(groups) {
  return groups
    .map((g) => {
      const bullets = g.commits.map((c) => {
        const prefix = c.breaking ? '**BREAKING:** ' : '';
        const scope = c.scope ? `**${c.scope}:** ` : '';
        return `- ${prefix}${scope}${c.subject} (${c.sha})`;
      });
      return `### ${g.title}\n\n${bullets.join('\n')}`;
    })
    .join('\n\n');
}

async function cmdChangelogDraft(args) {
  // `--from <dir> --out <dir>` re-renders drafts from frozen release-status
  // JSON instead of calling shipflow. This is the offline, deterministic path
  // the baseline eval reproduces: the input is a real run's output, the
  // rendering is the real code path, and neither touches the network — so the
  // gate cannot spend money or flake. It is not a user-facing mode.
  if (args.from) {
    const fromDir = resolve(args.from);
    const outDir = resolve(args.out ?? '.');
    mkdirSync(outDir, { recursive: true });
    const statuses = readdirSync(fromDir).filter((f) => /^status-.*\.json$/.test(f)).sort();
    if (statuses.length === 0) {
      throw new Error(`no status-*.json files in ${fromDir} — nothing to render`);
    }
    let written = 0;
    for (const file of statuses) {
      const s = JSON.parse(readFileSync(join(fromDir, file), 'utf8'));
      if (s.commits.length === 0) continue; // nothing to release, nothing to draft
      writeFileSync(join(outDir, `changelog-draft-${s.component.name}.md`), `${renderDraft(groupCommits(s.commits))}\n`);
      written += 1;
    }
    if (written === 0) {
      throw new Error(`all ${statuses.length} frozen status file(s) have zero commits — the render was a no-op`);
    }
    console.log(table(['Rendered', 'From', 'Into'], [[String(written), fromDir, outDir]]));
    return;
  }

  const repo = resolve(args.repo ?? '.');
  const status = shipflow(repo, ['release-status', '--repo', repo, ...(args.component ? ['--component', args.component] : [])]);
  const s = status.data;
  if (s.commits.length === 0) {
    throw new Error(`no commits touch ${s.component.name} since ${s.lastTag ?? 'the beginning'} — there is nothing to write notes about`);
  }
  console.log(renderDraft(groupCommits(s.commits)));
  console.log(`\n---\nThis is raw material, not the entry. It says what was typed, not what changed`);
  console.log(`for a reader or what breaks. Rewrite it in the house style (references/changelog.md),`);
  console.log(`show it to the user, then pass it to \`prepare --notes-file\`.`);
}

// ─── prepare / cut — pass-through, shaped ────────────────────────────────────

async function cmdPrepare(args) {
  const repo = resolve(args.repo ?? '.');
  if (!args.version || !args.notesFile) throw new Error('prepare: --version and --notes-file are both required');
  const r = shipflow(repo, [
    'release-prepare', '--repo', repo,
    ...(args.component ? ['--component', args.component] : []),
    '--version', args.version, '--notes-file', resolve(args.notesFile),
    ...(args.date ? ['--date', args.date] : []),
  ]);
  const d = r.data;
  console.log(table(['Branch', 'Version', 'Tag it will cut', 'Files changed'], [[d.branch, d.version, d.tag, d.changed.length]]));
  console.log(`\n${table(['Changed'], d.changed.map((f) => [f]))}`);
  console.log('\nNothing is pushed yet. Name the collateral list to the user, then run `cut`.');
}

async function cmdCut(args) {
  const repo = resolve(args.repo ?? '.');
  if (!args.expectStatusHash && !args.skipHashCheck) {
    throw new Error('cut: --expect-status-hash is required (take it from preflight). --skip-hash-check is a deliberate escape hatch, not a default.');
  }
  const r = shipflow(repo, [
    'release-cut', '--repo', repo,
    ...(args.component ? ['--component', args.component] : []),
    ...(args.expectStatusHash ? ['--expect-status-hash', args.expectStatusHash] : ['--skip-hash-check']),
    ...(args.wait ? ['--wait', String(args.wait)] : []),
  ]);
  const d = r.data;
  console.log(table(
    ['Done', 'Stage', 'Tag', 'Release'],
    [[d.done ? 'yes' : 'not yet', d.stage ?? '—', d.tag ?? '—', d.releaseUrl ?? '—']],
  ));
  if (Array.isArray(d.log) && d.log.length > 0) {
    console.log(`\n${table(['Stage', 'What happened'], d.log.map((l) => [l.stage, l.msg]))}`);
  }
  if (!d.done) {
    console.log(`\n${d.next ?? 'call cut again — it resumes from live state'}`);
    // Not an error: `done: false` is the normal bounded-wait outcome. But it
    // must not exit 0 either, or a caller that only checks the status code
    // reads "parked, waiting" as "released".
    process.exitCode = 3;
  }
}

const USAGE = `release v${VERSION} — cut a release for one named component and prove the tag exists.

  release preflight       [--repo <path>] [--component <name>]
  release changelog-draft [--repo <path>] [--component <name>]
  release prepare         [--repo <path>] [--component <name>] --version <x.y.z> --notes-file <path>
  release cut             [--repo <path>] [--component <name>] --expect-status-hash <hash> [--wait <seconds>]

Exit codes: 0 ok · 1 blocked or failed · 2 bad usage · 3 cut is parked, call it again.
`;

async function main() {
  const args = argv(process.argv.slice(2));
  const cmd = args._[0];
  if (args.version === true) return console.log(VERSION);
  try {
    switch (cmd) {
      case 'preflight': return await cmdPreflight(args);
      case 'changelog-draft': return await cmdChangelogDraft(args);
      case 'prepare': return await cmdPrepare(args);
      case 'cut': return await cmdCut(args);
      default:
        console.log(USAGE);
        process.exitCode = cmd ? 2 : 0;
    }
  } catch (err) {
    console.error(`release: ${err.message}`);
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
