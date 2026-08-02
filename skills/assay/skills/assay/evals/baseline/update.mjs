#!/usr/bin/env node
/**
 * Refresh assay's baseline from a real session.
 *
 * The declared `update_command` for every baseline entry. It regenerates the
 * frozen inputs, re-runs the graded report over them, and hands the result to
 * `smith freeze` — so the fixtures and the golden are always produced by the
 * same pass and cannot drift apart.
 *
 * Why the inputs are frozen at all: grading reads a live session transcript,
 * which grows every turn, and a live repo, which changes every PR. Pinned
 * against either, the golden would go red for reasons that have nothing to do
 * with assay. Frozen inputs make the byte comparison a statement about THIS
 * skill's behaviour and nothing else.
 *
 *   node evals/baseline/update.mjs [--session <path-to-session.jsonl>]
 *
 * With no --session it picks the most recently modified transcript for this
 * project, which is almost always the run you just did.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(HERE, '..', '..');
// skills/<name>/skills/<name> is four levels below the repo root, and the slug
// below is built by string-replacing separators — so this must be resolved, not
// merely joined, or the '..' segments end up inside the project slug.
const REPO = resolve(SKILL, '..', '..', '..', '..');
const FIXTURES = join(SKILL, 'evals', 'fixtures');
const SMITH = join(REPO, 'skills', 'smith', 'skills', 'smith', 'scripts', 'smith.js');

/** The run the golden is pinned against, and the command that reproduces it. */
const GRADED_SKILL = 'smith';
const COMMAND =
  'node scripts/assay.js report --contract evals/fixtures/contracts/smith.json ' +
  '--trace evals/fixtures/run-trace.json --skill smith --out $OUT';
const TRAP =
  'node scripts/assay.js probe --contract evals/fixtures/contracts/smith.json ' +
  '--trace evals/fixtures/run-trace.json --check-finding evals/fixtures/bad-finding.json';

const run = (cmd, args) => execFileSync(cmd, args, { cwd: SKILL, encoding: 'utf8', stdio: 'inherit' });

function latestSession() {
  const slug = REPO.replace(/\//g, '-');
  const dir = join(homedir(), '.claude', 'projects', slug);
  if (!existsSync(dir)) throw new Error(`no session directory at ${dir} — pass --session <file>`);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f: join(dir, f), t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (files.length === 0) throw new Error(`no transcripts in ${dir} — pass --session <file>`);
  return files[0].f;
}

const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};

const session = argOf('--session') ?? latestSession();
mkdirSync(FIXTURES, { recursive: true });

console.log(`→ freezing contracts for every skill in ${REPO}`);
run('node', ['scripts/assay.js', 'contract', '--all', '--repo', REPO, '--out', join(FIXTURES, 'contracts')]);

console.log(`→ freezing the run: ${session}`);
run('node', ['scripts/assay.js', 'trace', '--run', session, '--out', join(FIXTURES, 'run-trace.json')]);

// The known-bad input. Both citations are deliberately unresolvable: this is
// the finding the skill must refuse rather than soften into a maybe.
writeFileSync(
  join(FIXTURES, 'bad-finding.json'),
  `${JSON.stringify(
    [
      {
        id: 'f-uncitable',
        probe: 'invented-by-hand',
        clauseId: 'rule-000000ff',
        eventId: 'e999999',
        severity: 'critical',
        detail: 'a finding that sounds plausible and cites nothing that exists',
      },
    ],
    null,
    2,
  )}\n`,
);

const out = mkdtempSync(join(tmpdir(), 'assay-refresh-'));
console.log('→ re-running the graded report over the frozen inputs');
run('bash', ['-lc', COMMAND.replaceAll('$OUT', out)]);

console.log('→ freezing it as the baseline');
run('node', [SMITH, 'freeze', '--skill', 'assay', '--repo', REPO, '--from', out, '--command', COMMAND, '--trap-command', TRAP]);

console.log(`\nrefreshed against ${GRADED_SKILL}. Review the diff before committing — a golden that changed for a reason you cannot name is the whole signal.`);
