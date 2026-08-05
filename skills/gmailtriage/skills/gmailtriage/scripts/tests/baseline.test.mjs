import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const BASELINE = join(SKILL, 'evals', 'baseline');
const manifest = JSON.parse(readFileSync(join(BASELINE, 'MANIFEST.json'), 'utf8'));

// Pinned against a real run of gmailtriage against a real Gmail mailbox —
// its real inbox and its real label list, redacted by evals/baseline/redact.mjs.
//
//   REFRESH WITH:  bash evals/baseline/refresh.sh
//
// and read the diff before committing it. A golden that changed because the
// code changed is a finding; a golden refreshed without looking is a test that
// has stopped testing.

const sh = (cmd, cwd) => execFileSync('bash', ['-lc', cmd], { cwd, encoding: 'utf8' });

test('the frozen run covers real artifacts', () => {
  // Anti-vacuity floor: a manifest over zero artifacts would let every
  // assertion below iterate nothing and still report green.
  assert.ok(manifest.artifacts.length >= 7, 'the frozen run lost artifacts — refresh or explain');
  for (const a of manifest.artifacts) {
    assert.ok(existsSync(join(BASELINE, a.path)), `frozen artifact missing: ${a.path}`);
  }
});

test('the frozen corpus is big enough to be worth pinning', () => {
  // The corpus floor from skill-invariants.json, as code. A refresh that
  // collapsed the inbox to a handful of threads would let every golden below
  // pass over almost nothing while still looking complete.
  const threads = JSON.parse(readFileSync(join(BASELINE, 'threads.json'), 'utf8'));
  const labels = JSON.parse(readFileSync(join(BASELINE, 'labels.json'), 'utf8')).labels;
  const rules = JSON.parse(readFileSync(join(BASELINE, 'rules.json'), 'utf8')).rules;
  assert.ok(threads.length >= 50, `corpus shrank to ${threads.length} threads — refresh with bash evals/baseline/refresh.sh`);
  assert.ok(labels.length >= 20, `label list shrank to ${labels.length}`);
  // Both halves of the skill must be exercised, or the golden covers one.
  assert.ok(rules.some((r) => r.action === 'trash'), 'no trash rule left in the frozen set');
  assert.ok(rules.some((r) => r.action === 'label' && r.keepInInbox !== true), 'no ARCHIVING sort rule left — the move path is untested');
  assert.ok(rules.some((r) => r.action === 'label' && r.keepInInbox === true), 'no tag-in-place sort rule left');
});

test('re-running the frozen command reproduces it byte for byte', () => {
  const out = mkdtempSync(join(tmpdir(), 'gmailtriage-baseline-'));
  sh(manifest.command.replaceAll('$OUT', out), SKILL);
  for (const a of manifest.artifacts) {
    const produced = readFileSync(join(out, a.path));
    const frozen = readFileSync(join(BASELINE, a.path));
    assert.deepEqual(produced, frozen, `${a.path} drifted from the frozen run — inspect the diff before refreshing`);
  }
});

test('the known-bad case still fails', () => {
  // Two-sided. A baseline that only asserts good-input-passes goes green the
  // day someone weakens the checker.
  assert.throws(
    () => sh("node scripts/gmailtriage.js apply --plan evals/baseline/plan.json --trash evals/baseline/rogue-ids.json --receipt /tmp/gt-never.json", SKILL),
    'the known-bad input stopped failing — the checker has been weakened, not the input fixed',
  );
});

test('a sort authorisation is not a trash authorisation', () => {
  // The dangerous collapse. These thread ids ARE in the frozen plan — under a
  // label rule. Handing them to apply as a trash list must be refused, or a
  // plan to file a thread becomes a permission slip to destroy it.
  const plan = JSON.parse(readFileSync(join(BASELINE, 'plan.json'), 'utf8'));
  const filed = plan.taken.filter((t) => t.action === 'label').map((t) => t.threadId);
  assert.ok(filed.length >= 4, 'the frozen plan files nothing — this test would prove nothing');

  const ids = mkdtempSync(join(tmpdir(), 'gmailtriage-sort-')) + '/ids.json';
  writeFileSync(ids, JSON.stringify(filed));
  assert.throws(
    () => sh(`node scripts/gmailtriage.js apply --plan evals/baseline/plan.json --trash ${ids} --receipt /tmp/gt-never.json`, SKILL),
    'a filed thread was authorised for the trash — the two actions have collapsed into one permission',
  );
  // and the same ids under the RIGHT action still pass, or the check above is
  // just rejecting everything.
  sh(`node scripts/gmailtriage.js apply --plan evals/baseline/plan.json --sort ${ids} --receipt ${ids}.receipt.json --at 2026-08-05T12:00:00Z`, SKILL);
});

test('a label rule can never name one of Gmail\'s own labels', () => {
  // Sorting must not become a way around every trash guard in the skill.
  const dir = mkdtempSync(join(tmpdir(), 'gmailtriage-sys-'));
  for (const label of ['TRASH', 'SPAM', 'INBOX', 'CATEGORY_PROMOTIONS']) {
    const f = join(dir, `${label}.json`);
    writeFileSync(f, JSON.stringify({ version: 1, rules: [
      { id: 'sneaky', action: 'label', label, match: { from: 'a@b.com' }, note: 'destroys mail through the safe action' },
    ] }));
    assert.throws(
      () => sh(`node scripts/gmailtriage.js labels --rules ${f} --labels evals/baseline/labels.json`, SKILL),
      `"${label}" was accepted as a destination — sorting is now a route around the trash guards`,
    );
  }
});

test('apply refuses to run against a folder the mailbox does not have', () => {
  // The gate that keeps a run from failing on thread 27 of 50.
  const dir = mkdtempSync(join(tmpdir(), 'gmailtriage-missing-'));
  const f = join(dir, 'rules.json');
  writeFileSync(f, JSON.stringify({ version: 1, rules: [
    { id: 'nowhere', action: 'label', label: 'A Folder That Does Not Exist', match: { from: 'a@b.com' }, note: 'nowhere to go' },
  ] }));
  assert.throws(
    () => sh(`node scripts/gmailtriage.js labels --rules ${f} --labels evals/baseline/labels.json`, SKILL),
    'a missing destination stopped failing — apply can now die halfway through a run',
  );
});
