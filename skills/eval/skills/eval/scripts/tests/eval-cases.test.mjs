import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { extractContract } from '../lib/contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(HERE, '..', '..');
const REPO = resolve(SKILL, '..', '..', '..', '..');
const CONTRACTS = join(SKILL, 'evals', 'fixtures', 'contracts');

const cli = (args) => execFileSync('node', [join(SKILL, 'scripts', 'eval.js'), ...args], { cwd: SKILL, encoding: 'utf8', stdio: 'pipe' });

// --- baseline: every-shipped-contract -------------------------------------
//
// Frozen contracts for every skill this repo ships. The floor is the whole
// point: a resolver that matched nothing would otherwise iterate an empty list
// and report "all clean" over zero clauses -- a clean grade of an empty rubric.

test('the frozen contract corpus is real and above its floor', () => {
  assert.ok(existsSync(CONTRACTS), `no frozen contracts at ${CONTRACTS} — run evals/baseline/update.mjs`);
  const files = readdirSync(CONTRACTS).filter((f) => f.endsWith('.json'));

  // Against the LIVE skill list, not a constant. A static floor cannot notice a
  // newly shipped skill never entering the corpus: the corpus held 12 of the 14
  // skills in this repo and still cleared a floor of 10, so it reported on 12
  // and looked complete — the exact failure mode this skill grades others for.
  const shipped = readdirSync(join(REPO, 'skills')).filter((n) =>
    existsSync(join(REPO, 'skills', n, 'skills', n, 'SKILL.md')),
  );
  const frozen = new Set(files.map((f) => f.replace(/\.json$/, '')));
  const missing = shipped.filter((n) => !frozen.has(n));
  assert.deepEqual(
    missing,
    [],
    `these shipped skills have no frozen contract, so the corpus reports on ${frozen.size} of ${shipped.length} and looks complete: ${missing.join(', ')} — run evals/baseline/update.mjs --contracts`,
  );

  for (const f of files) {
    const contract = JSON.parse(readFileSync(join(CONTRACTS, f), 'utf8'));
    assert.ok(contract.clauses.length > 0, `${f} froze zero clauses — the extractor found no rules in a real skill`);
    for (const c of contract.clauses) {
      assert.ok(c.id && c.text && c.source?.file, `${f} has a clause that cannot be cited: ${JSON.stringify(c)}`);
    }
  }
});

test('the extractor still finds rules in every skill shipped today', () => {
  // A floor, not a byte comparison. Skills change constantly; what must never
  // change is that a real contract yields SOMETHING. This is the check that
  // goes red when a new skill uses a rule form the extractor cannot read.
  const names = readdirSync(join(REPO, 'skills')).filter((n) => existsSync(join(REPO, 'skills', n, 'skills', n, 'SKILL.md')));
  assert.ok(names.length >= 10, `only ${names.length} skills resolved — the discovery glob is matching almost nothing`);
  for (const name of names) {
    const contract = extractContract(REPO, name);
    assert.ok(contract.clauses.length > 0, `${name}: extracted zero clauses from a real SKILL.md`);
  }
});

// --- baseline: green-case-refused -----------------------------------------
//
// The trap. A generated case that passes on arrival has never been observed
// failing, so it proves nothing and will never go red. It must be refused AND
// removed -- leaving the file behind would quietly grow the decorative suite
// this command exists to prevent.

const ABSENT = 'xyzzy-this-string-is-not-in-any-committed-file-42';

test('a case that passes on arrival is refused and deleted', () => {
  const generated = join(SKILL, 'scripts', 'tests', 'generated', 'trap-green-case.test.mjs');
  let failed = false;
  let output = '';
  try {
    output = cli(['case', '--skill', 'eval', '--repo', REPO, '--in', 'SKILL.md', '--prove', '--finding', 'trap-green-case', '--assert-absent', ABSENT]);
  } catch (err) {
    failed = true;
    output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  assert.ok(failed, 'a green case was accepted — the skill is now generating evals that have never been observed failing');
  assert.match(output, /PASSED on arrival|green case refused/);
  assert.ok(!existsSync(generated), 'the refused case was left on disk, which grows the decorative suite it was refused for');
});

test('a case generated without --prove is refused', () => {
  assert.throws(
    () => cli(['case', '--skill', 'eval', '--repo', REPO, '--in', 'SKILL.md', '--assert-absent', ABSENT]),
    'a case was written without ever being run',
  );
});

test('a case that IS red today is kept', () => {
  // The other side of the trap. If this stops passing, `case` has become
  // incapable of keeping anything and the refusal above proves nothing.
  const id = 'trap-red-case';
  const generated = join(SKILL, 'scripts', 'tests', 'generated', `${id}.test.mjs`);
  const present = 'Never assert what it did not observe';
  try {
    const out = cli(['case', '--skill', 'eval', '--repo', REPO, '--in', 'SKILL.md', '--prove', '--finding', id, '--assert-absent', present]);
    assert.match(out, /yes/);
    assert.ok(existsSync(generated), 'a case observed failing was not kept');
  } finally {
    if (existsSync(generated)) execFileSync('rm', ['-f', generated]);
  }
});
