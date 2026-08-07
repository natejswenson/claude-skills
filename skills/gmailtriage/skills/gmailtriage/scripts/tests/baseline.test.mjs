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

// ── the sub-label half, pinned against the real retroactive run ─────────────

test('the sub-label corpus is big enough, and structurally intact', () => {
  // Anti-vacuity, and specifically anti-COLLAPSE. The corpus is pseudonymised
  // — no organisation the mailbox owner deals with is named in it — and the
  // failure mode of pseudonymising is merging: if every sender collapsed to
  // one address, `subdivide` would see one cluster, report "still one thing",
  // and every assertion below would pass over nothing.
  const filed = JSON.parse(readFileSync(join(BASELINE, 'filed.json'), 'utf8'));
  const after = JSON.parse(readFileSync(join(BASELINE, 'filed-after.json'), 'utf8'));
  const labels = JSON.parse(readFileSync(join(BASELINE, 'filed-labels.json'), 'utf8')).labels;
  assert.ok(filed.length >= 12, `the folder corpus shrank to ${filed.length} threads`);
  assert.equal(after.length, filed.length, 'the before/after corpora describe different mailboxes');

  const domains = new Set(filed.map((t) => t.from.split('@')[1]));
  assert.ok(domains.size >= 4, `only ${domains.size} sender domain(s) — the split has nothing to find`);
  // and at least one cluster big enough that merging it would be obvious
  const biggest = Math.max(...[...domains].map((d) => filed.filter((t) => t.from.endsWith(`@${d}`)).length));
  assert.ok(biggest >= 6, `the largest cluster is ${biggest} — a corpus of singletons proves nothing`);

  // Both halves of the naming problem must be present, or the vendor guard is
  // untested: senders that name their organisation, and senders that do not.
  assert.ok(filed.some((t) => /ashbyhq|workablemail|greenhouse|lever/.test(t.from)),
    'no vendor-hosted sender left in the corpus — the guard that cannot be auto-named is untested');

  // Every label a thread claims must exist in the frozen label list, or the
  // corpus describes a mailbox where nothing resolves while looking complete.
  const known = new Set(labels.map((l) => l.name));
  for (const t of after) {
    for (const l of t.labels ?? []) assert.ok(known.has(l), `thread carries "${l}", which is in no label list`);
  }
  // and the nesting survived redaction — a flattened name tests nothing
  assert.ok(labels.some((l) => l.name.startsWith('Recruiting/')), 'the sub-labels lost their parent');
});

// The "nothing real is in the corpus" guard used to live here. It now lives in
// scripts/tests/no-real-data.test.mjs — its own file, because `skillfactory
// freeze` rewrites this one, and that is the guard that must survive a refresh.

test('a retroactive pass converges — the second run takes nothing', () => {
  // Two-sided, and the two sides are the whole point. The same rules over the
  // same folder must take all 13 threads before the labels are applied and
  // ZERO after. If label ids stop resolving to names, or the already-filed
  // short-circuit stops firing, the first number stays right, the second
  // becomes 13, and the skill re-files the same mail forever while every table
  // still reads correctly.
  const before = readFileSync(join(BASELINE, 'retro-plan.txt'), 'utf8');
  const after = readFileSync(join(BASELINE, 'retro-converged.txt'), 'utf8');
  const filed = (t) => Number(/\|\s*label:Recruiting\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/.exec(t)?.[3] ?? -1);
  assert.equal(filed(before), 13, 'the first retroactive pass no longer files the whole folder');
  assert.equal(filed(after), 0, 'a retroactive pass stopped converging — it would re-file the same mail every run');

  // and it moves nothing but labels: no trash, and nothing leaves an inbox
  // these threads already left.
  assert.match(before, /\| label:Recruiting +\| 13 +\| 0 +\| 13 +\| 0 +\|/,
    'the retroactive pass now trashes or archives — it must only add labels');
});

test('a parent rule in front of its own sub-label rule is refused', () => {
  // The drift nesting invites. Two-sided: the bad pair must fail AND the
  // corrected set must pass, or the check could be satisfied by refusing
  // nesting outright.
  const dir = mkdtempSync(join(tmpdir(), 'gmailtriage-nest-'));
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify({ version: 1, rules: [
    { id: 'broad', action: 'label', label: 'Recruiting', match: { from: '@org-a-13a7.example' }, note: 'the whole folder' },
    { id: 'narrow', action: 'label', label: 'Recruiting/Folder c9d2', match: { from: '@org-a-13a7.example' }, note: 'one organisation' },
  ] }));
  assert.throws(
    () => sh(`node scripts/gmailtriage.js labels --rules ${bad} --labels evals/baseline/filed-labels.json`, SKILL),
    'a parent rule in front of its own sub-label rule was accepted — mail now splits by arrival time',
  );

  // the corrected shape — the broad rule files into the sub-label instead
  sh(`node scripts/gmailtriage.js labels --rules evals/baseline/rules-recruiting.json --labels evals/baseline/filed-labels.json`, SKILL);
});

test('subdivide never names a cluster after the vendor that hosts it', () => {
  // Frozen from the real run: both applicant-tracking senders must come back
  // needing a name, however tempting their domain looks. Auto-naming one files
  // every organisation behind that vendor into a single folder.
  const out = readFileSync(join(BASELINE, 'subdivide.txt'), 'utf8');
  const vendorRows = out.split('\n').filter((l) => /hosts many orgs/.test(l));
  assert.ok(vendorRows.length >= 2, 'the vendor-hosted senders stopped being flagged');
  for (const row of vendorRows) {
    assert.match(row, /needs a name/, 'a vendor-hosted cluster was given a destination automatically');
  }
  assert.match(out, /Vendor-hosted \|/);
  // and the candidates file must carry them as unhoused, never as ready rules
  const cands = JSON.parse(readFileSync(join(BASELINE, 'subdivide-candidates.json'), 'utf8'));
  // Clusters whose sub-label already exists DO become ready rules — that is the
  // command working. The vendor-hosted ones must never be among them, however
  // tempting their domain looks.
  assert.ok(cands.sortCandidates.length >= 1, 'no cluster was housed at all — the child matcher has stopped matching');
  for (const r of cands.sortCandidates) {
    assert.ok(!/greenhouse|workable|lever|ashby/.test(r.match.from),
      `a vendor-hosted cluster reached the ready-to-add list: ${r.match.from}`);
  }
  assert.ok(cands.unhoused.length >= 2, 'the vendor-hosted clusters stopped being held back');
});

// ── hygiene, pinned against the real label cleanup ──────────────────────────

const readB = (f) => readFileSync(join(BASELINE, f), 'utf8');
const summary = (text) => {
  // the last row of the closing summary table: labels, managed, unmanaged,
  // duplicates, unclaimed, coverage
  const rows = text.trim().split('\n').filter((l) => l.startsWith('|'));
  const cells = rows[rows.length - 1].split('|').map((c) => c.trim()).filter(Boolean);
  return { labels: +cells[0], managed: +cells[1], unmanaged: +cells[2], duplicates: +cells[3], unclaimed: +cells[4], coverage: cells[5] };
};

test('the frozen hygiene corpus has something to find', () => {
  // Anti-vacuity. An audit golden over a mailbox with nothing wrong proves the
  // command runs, not that it looks — and the "after" half is exactly that
  // mailbox, so the "before" half has to carry the findings.
  const before = summary(readB('audit-before.txt'));
  assert.ok(before.labels >= 15, `only ${before.labels} labels in the corpus`);
  assert.ok(before.unmanaged >= 4, `only ${before.unmanaged} unmanaged folders — nothing to find`);
  assert.ok(before.duplicates >= 2, 'the transposed duplicate pair is gone from the corpus');
  assert.ok(before.unclaimed >= 10, `only ${before.unclaimed} unclaimed threads`);
  // A floor, not the literal — the corpus is generated, and pinning the exact
  // percentage would make every generator tweak look like a regression. What
  // must hold is that the "before" state is meaningfully incomplete.
  assert.ok(Number(before.coverage.replace('%', '')) <= 80,
    `coverage is already ${before.coverage} before the cleanup — the corpus has nothing to fix`);

  // Both remedies must be represented, or the classification is half-tested.
  assert.match(readB('audit-before.txt'), /UNMANAGED — holds mail/);
  assert.match(readB('audit-before.txt'), /UNMANAGED — and empty/);
  assert.match(readB('audit-before.txt'), /SAME AS/);
});

test('a cleaned-up label system audits clean, and that state is reachable', () => {
  // The other half of two-sided. Without it the audit could satisfy every
  // assertion above by reporting findings unconditionally, and a user could
  // never get to zero however much they fixed.
  const after = summary(readB('audit-after.txt'));
  assert.deepEqual(
    { unmanaged: after.unmanaged, duplicates: after.duplicates, unclaimed: after.unclaimed, coverage: after.coverage },
    { unmanaged: 0, duplicates: 0, unclaimed: 0, coverage: '100%' },
  );
  assert.match(readB('audit-after.txt'), /every folder has a rule, no folder is spelled two ways, and no mail is unclaimed/);
  // and it must EXIT ZERO, or the gate can never be satisfied
  sh('node scripts/gmailtriage.js audit --labels evals/baseline/mailbox-after-labels.json --rules evals/baseline/mailbox-after-rules.json --threads evals/baseline/mailbox-after.json', SKILL);
  // while the before state must still exit non-zero
  assert.throws(
    () => sh('node scripts/gmailtriage.js audit --labels evals/baseline/mailbox-before-labels.json --rules evals/baseline/mailbox-before-rules.json --threads evals/baseline/mailbox-before.json', SKILL),
    'a mailbox with 5 unmanaged folders and a duplicate pair audited clean',
  );
});

test('audit does not call correctly-filed mail unclaimed', () => {
  // The defect the first live audit had: it reused `plan`, which answers "is
  // there work to do" and says no for a thread already in the folder its rule
  // files into — the most claimed thread in the mailbox. That reported 47 of
  // 48 threads unclaimed, rendering a clean mailbox as a broken one.
  const after = JSON.parse(readFileSync(join(BASELINE, 'mailbox-after.json'), 'utf8'));
  const filed = after.filter((t) => (t.labels ?? []).some((l) => !/^(INBOX|SENT|UNREAD|IMPORTANT|DRAFT)$/.test(l)));
  assert.ok(filed.length >= 25, `only ${filed.length} filed threads — this test would prove little`);
  // every one of them is in the corpus the clean audit reported 0 unclaimed over
  assert.equal(summary(readB('audit-after.txt')).unclaimed, 0);
});

test('a merge labels before it unlabels, and records a fold that moved nothing', () => {
  const out = readB('merge.txt');
  const iLabel = out.indexOf('LABEL "');
  const iUnlabel = out.indexOf('remove "');
  const iDelete = out.indexOf('delete the "');
  assert.ok(iUnlabel > 0 && iDelete > iUnlabel, 'the delete must come after the unlabel');
  if (iLabel >= 0) assert.ok(iLabel < iUnlabel, 'the target label must go on before the source comes off');
  assert.match(out, /Removing the old label first leaves the mail in neither folder/);

  // The real case moved no mail — its one thread already carried the target —
  // and it must STILL be recorded, or the deleted folder cannot come back.
  const receipt = JSON.parse(readFileSync(join(BASELINE, 'merge-receipt.json'), 'utf8'));
  assert.ok(receipt.entries.length >= 1, 'a merge that moved no mail recorded nothing, so it cannot be undone');
  assert.equal(receipt.entries[0].action, 'unlabel');
  assert.ok(receipt.entries[0].removed.length >= 1);
});
