/**
 * The 0.6.0 run-safety guards, at the CLI boundary.
 *
 * Deliberately NOT in baseline.test.mjs — `skillfactory freeze` rewrites that
 * file, and these are guards that must survive every refresh. Same reasoning
 * as no-real-data.test.mjs, and the same failure mode being guarded: the ways
 * a real run put real mailbox data somewhere it should never live, and the
 * ways a run stopped being undoable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const BASELINE = join(SKILL, 'evals', 'baseline');

const sh = (cmd, opts = {}) => execFileSync('bash', ['-lc', cmd], { cwd: SKILL, encoding: 'utf8', ...opts });

test('a snippet never reaches disk — the frozen ingest output carries none', () => {
  // The raw fixtures plant `Your verification code is 000000` in every
  // message snippet, because a real run's snippets have carried live codes.
  // The frozen output must carry neither the field nor the content.
  const planted = readFileSync(join(BASELINE, 'raw-inbox.json'), 'utf8');
  assert.match(planted, /000000/, 'the raw fixtures lost the planted snippet — this test now proves nothing');
  for (const f of ['ingested-threads.json', 'ingested-labels.json']) {
    const out = readFileSync(join(BASELINE, f), 'utf8');
    assert.ok(!out.includes('snippet'), `${f} carries a snippet field`);
    assert.ok(!out.includes('000000'), `${f} carries snippet content — a live code would have been persisted`);
  }
});

test('ingest refuses a metadata-only fetch, and --force overrides', () => {
  const out = mkdtempSync(join(tmpdir(), 'gt-ingest-'));
  assert.throws(
    () => sh(`node scripts/gmailtriage.js ingest --inbox evals/baseline/raw-inbox-metadata.json --labels evals/baseline/raw-labels.json --out-threads ${out}/t.json --out-labels ${out}/l.json`),
    'a subject-less fetch was ingested — the next audit will report ghosts as unclaimed mail',
  );
  assert.ok(!existsSync(join(out, 't.json')), 'the refusal still wrote a snapshot');
  // Two-sided: --force is the documented escape hatch.
  sh(`node scripts/gmailtriage.js ingest --inbox evals/baseline/raw-inbox-metadata.json --labels evals/baseline/raw-labels.json --out-threads ${out}/t.json --out-labels ${out}/l.json --force`);
  assert.ok(existsSync(join(out, 't.json')));
});

test('mailbox data is refused inside a git repository, and --allow-repo overrides', () => {
  const repo = mkdtempSync(join(tmpdir(), 'gt-repo-'));
  sh(`git init -q ${repo}`);
  const inner = join(repo, 'deep', 'dir');
  mkdirSync(inner, { recursive: true });
  assert.throws(
    () => sh(`node scripts/gmailtriage.js plan --threads evals/baseline/threads.json --labels evals/baseline/labels.json --rules evals/baseline/rules.json --out ${inner}/plan.json`),
    'a mailbox snapshot was written into a git working tree — one git add away from public',
  );
  assert.ok(!existsSync(join(inner, 'plan.json')));
  // Two-sided, both ways: the escape hatch works, and a plain tmpdir never trips it.
  sh(`node scripts/gmailtriage.js plan --threads evals/baseline/threads.json --labels evals/baseline/labels.json --rules evals/baseline/rules.json --out ${inner}/plan.json --allow-repo`);
  assert.ok(existsSync(join(inner, 'plan.json')));
  const plain = mkdtempSync(join(tmpdir(), 'gt-plain-'));
  sh(`node scripts/gmailtriage.js plan --threads evals/baseline/threads.json --labels evals/baseline/labels.json --rules evals/baseline/rules.json --out ${plain}/plan.json`);
});

test('apply --update-threads makes a re-plan converge without re-fetching', () => {
  const out = mkdtempSync(join(tmpdir(), 'gt-update-'));
  const threads = join(out, 'threads.json');
  writeFileSync(threads, readFileSync(join(BASELINE, 'threads.json')));
  sh(`node scripts/gmailtriage.js plan --threads ${threads} --labels evals/baseline/labels.json --rules evals/baseline/rules.json --out ${out}/plan.json > ${out}/plan1.txt`);
  sh(`node scripts/gmailtriage.js apply --plan ${out}/plan.json --receipt ${out}/receipt.json --update-threads ${threads} --at 2026-08-13T12:00:00Z > ${out}/apply.txt`);
  // The receipt is untouched by the snapshot update — it is the undo.
  const receipt = JSON.parse(readFileSync(join(out, 'receipt.json'), 'utf8'));
  assert.ok(receipt.entries.length >= 10, 'the frozen corpus stopped producing a real apply');
  // A second plan over the updated snapshot must take zero threads: the
  // trashed are gone, the filed carry their labels, the archived left the inbox.
  const replan = sh(`node scripts/gmailtriage.js plan --threads ${threads} --labels evals/baseline/labels.json --rules evals/baseline/rules.json`);
  const rows = replan.trim().split('\n').filter((l) => l.startsWith('|'));
  const cells = rows[rows.length - 1].split('|').map((c) => c.trim()).filter(Boolean);
  // Scope, Scanned, Would trash, Would file, Would leave the inbox, ...
  assert.equal(Number(cells[2]), 0, `re-plan would still trash ${cells[2]} — trashed threads survived the update`);
  assert.equal(Number(cells[3]), 0, `re-plan would still file ${cells[3]} — the update did not converge`);
});

test('receipts default to the durable store, and undo --last finds the newest', () => {
  // HOME is redirected so the test never touches the runner's real state dir.
  const home = mkdtempSync(join(tmpdir(), 'gt-home-'));
  const out = mkdtempSync(join(tmpdir(), 'gt-receipts-'));
  const env = { ...process.env, HOME: home };
  sh(`node scripts/gmailtriage.js plan --threads evals/baseline/threads.json --labels evals/baseline/labels.json --rules evals/baseline/rules.json --out ${out}/plan.json > /dev/null`, { env });
  sh(`node scripts/gmailtriage.js apply --plan ${out}/plan.json --at 2026-08-13T12:00:00Z > /dev/null`, { env });
  sh(`node scripts/gmailtriage.js apply --plan ${out}/plan.json --at 2026-08-13T13:00:00Z > /dev/null`, { env });
  const dir = join(home, '.gmailtriage', 'receipts');
  assert.ok(existsSync(dir), 'no default receipt landed in ~/.gmailtriage/receipts');
  const undo = sh('node scripts/gmailtriage.js undo --last', { env });
  assert.match(undo, /undoing the last recorded run/);
  assert.match(undo, /2026-08-13T13:00:00Z/, 'undo --last picked an older receipt over the newest');
});
