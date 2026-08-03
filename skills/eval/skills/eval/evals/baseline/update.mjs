#!/usr/bin/env node
/**
 * Refresh eval's baseline from a real session.
 *
 * The declared `update_command` for every baseline entry. It regenerates the
 * frozen inputs, re-runs the graded report over them, and hands the result to
 * `skillfactory freeze` — so the fixtures and the golden are always produced by the
 * same pass and cannot drift apart.
 *
 * Why the inputs are frozen at all: grading reads a live session transcript,
 * which grows every turn, and a live repo, which changes every PR. Pinned
 * against either, the golden would go red for reasons that have nothing to do
 * with eval. Frozen inputs make the byte comparison a statement about THIS
 * skill's behaviour and nothing else.
 *
 *   node evals/baseline/update.mjs [--session <path-to-session.jsonl>] [--contracts]
 *
 * **The contracts are only re-extracted when --contracts is given.** They are a
 * frozen input for the same reason the trace is: they are lifted from a live
 * repo that changes every PR, so re-extracting them on every refresh made this
 * command unable to reproduce the committed baseline — it attributed repo
 * movement to eval drift, which is the one thing a golden must never do. Pass
 * --contracts when the corpus genuinely needs to catch up with the repo.
 *
 * **The trace is only re-frozen when --session is given.** Without it, the
 * committed run-trace.json is reused, so this command reproduces the committed
 * baseline instead of re-pinning it to whatever session happens to be newest —
 * which would silently swap the graded run for an unrelated one and make every
 * refresh a different experiment. Pass --session deliberately, when the run you
 * want graded is genuinely a new one. `--session latest` picks the most recently
 * modified transcript for this project, which is usually the run you just did.
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
const SKILLFACTORY = join(REPO, 'skills', 'skillfactory', 'skills', 'skillfactory', 'scripts', 'skillfactory.js');

/** The run the golden is pinned against, and the command that reproduces it. */
const GRADED_SKILL = 'skillfactory';
const COMMAND =
  'node scripts/eval.js report --contract evals/fixtures/contracts/skillfactory.json ' +
  '--trace evals/fixtures/run-trace.json --skill skillfactory --out $OUT';
const TRAP =
  'node scripts/eval.js probe --contract evals/fixtures/contracts/skillfactory.json ' +
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

const requested = argOf('--session');
const session = requested === 'latest' ? latestSession() : requested;
mkdirSync(FIXTURES, { recursive: true });

if (process.argv.includes('--contracts')) {
  console.log(`→ re-extracting contracts for every skill in ${REPO}`);
  run('node', ['scripts/eval.js', 'contract', '--all', '--repo', REPO, '--out', join(FIXTURES, 'contracts')]);
} else {
  console.log('→ keeping the committed contract fixtures (pass --contracts to re-extract from the live repo)');
}

if (session) {
  console.log(`→ freezing a NEW run: ${session}`);
  run('node', ['scripts/eval.js', 'trace', '--run', session, '--out', join(FIXTURES, 'run-trace.json')]);
} else {
  console.log('→ keeping the committed run-trace.json (pass --session to grade a different run)');
}

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

const out = mkdtempSync(join(tmpdir(), 'eval-refresh-'));
console.log('→ re-running the graded report over the frozen inputs');
run('bash', ['-lc', COMMAND.replaceAll('$OUT', out)]);

console.log('→ freezing it as the baseline');
run('node', [SKILLFACTORY, 'freeze', '--skill', 'eval', '--repo', REPO, '--from', out, '--command', COMMAND, '--trap-command', TRAP]);

console.log(`\nrefreshed against ${GRADED_SKILL}. Review the diff before committing — a golden that changed for a reason you cannot name is the whole signal.`);
