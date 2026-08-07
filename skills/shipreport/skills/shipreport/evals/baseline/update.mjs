#!/usr/bin/env node
/**
 * Refresh the frozen baseline.
 *
 * `skill-invariants.json` has named `node evals/baseline/update.mjs` as the
 * update command for every frozen artifact since the skill shipped, and the file
 * did not exist — so the house rule that every frozen artifact has a one-command
 * refresh was true on paper and false on disk. A refresh command nobody can run
 * is how a baseline stops being refreshed and starts being deleted.
 *
 * The command is not written down twice: it is read from MANIFEST.json, which is
 * the same string the baseline test re-runs and byte-compares. Re-running it here
 * from a different source would be a second contract that could drift from the
 * first.
 *
 *   node evals/baseline/update.mjs            # re-run, then freeze
 *   node evals/baseline/update.mjs --dry-run  # re-run and diff, freeze nothing
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(HERE, '..', '..');
// skills/<name>/skills/<name> → four levels up is the repo root.
const REPO = resolve(SKILL, '..', '..', '..', '..');
const SKILLFACTORY = join(REPO, 'skills', 'skillfactory', 'skills', 'skillfactory', 'scripts', 'skillfactory.js');

const manifest = JSON.parse(readFileSync(join(HERE, 'MANIFEST.json'), 'utf8'));
const dryRun = process.argv.includes('--dry-run');

/**
 * The known-bad case, passed on EVERY freeze.
 *
 * `skillfactory freeze` regenerates `baseline.test.mjs` wholesale, and without
 * `--trap-command` it replaces the two-sided assertion with `assert.fail`. A
 * refresh that forgets this leaves the baseline one-sided — green the day
 * someone weakens the receipts gate — which is precisely the failure the
 * baseline exists to catch. Hard-wiring it here means the flag cannot be
 * forgotten by whoever runs the refresh next.
 */
const TRAP_COMMAND = 'node scripts/shipreport.js receipts --corpus evals/baseline/corpus --draft evals/baseline/draft-unresolvable.json';

const out = mkdtempSync(join(tmpdir(), 'shipreport-refresh-'));
console.log(`re-running the frozen command into ${out}`);
execFileSync('bash', ['-lc', manifest.command.replaceAll('$OUT', out)], { cwd: SKILL, stdio: 'inherit' });

let drifted = 0;
for (const a of manifest.artifacts) {
  const fresh = join(out, a.path);
  if (!existsSync(fresh)) {
    console.error(`MISSING  ${a.path} — the command no longer produces it`);
    process.exit(1);
  }
  const same = readFileSync(fresh).equals(readFileSync(join(HERE, a.path)));
  if (!same) drifted += 1;
  console.log(`${same ? 'same    ' : 'CHANGED '} ${a.path}`);
}

if (drifted === 0) {
  console.log('\nnothing drifted — the frozen baseline already matches. Nothing to do.');
  process.exit(0);
}

if (dryRun) {
  console.log(`\n${drifted} artifact(s) would be refrozen. Inspect the diff before dropping --dry-run:`);
  console.log(`  diff -u evals/baseline/<file> ${out}/<file>`);
  process.exit(0);
}

// Freezing is deliberately the last step and never silent about what it covers:
// a refresh that quietly absorbs a regression is worse than no baseline at all.
console.log(`\n${drifted} artifact(s) drifted — refreezing. Read the diff first if you have not.`);
execFileSync('node', [
  SKILLFACTORY, 'freeze',
  '--skill', 'shipreport',
  '--from', out,
  '--command', manifest.command,
  '--trap-command', TRAP_COMMAND,
], { cwd: REPO, stdio: 'inherit' });
