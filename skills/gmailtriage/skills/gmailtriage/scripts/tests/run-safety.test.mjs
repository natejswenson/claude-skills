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
import { prepareInbox } from '../../evals/baseline/prepare-inbox.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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
  writeFileSync(threads, JSON.stringify(prepareInbox(JSON.parse(readFileSync(join(BASELINE, 'threads.json'), 'utf8')))));
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
  const threads = join(out, 'threads.json');
  writeFileSync(threads, JSON.stringify(prepareInbox(JSON.parse(readFileSync(join(BASELINE, 'threads.json'), 'utf8')))));
  sh(`node scripts/gmailtriage.js plan --threads ${threads} --labels evals/baseline/labels.json --rules evals/baseline/rules.json --out ${out}/plan.json > /dev/null`, { env });
  sh(`node scripts/gmailtriage.js apply --plan ${out}/plan.json --at 2026-08-13T12:00:00Z > /dev/null`, { env });
  sh(`node scripts/gmailtriage.js apply --plan ${out}/plan.json --at 2026-08-13T13:00:00Z > /dev/null`, { env });
  const dir = join(home, '.gmailtriage', 'receipts');
  assert.ok(existsSync(dir), 'no default receipt landed in ~/.gmailtriage/receipts');
  const undo = sh('node scripts/gmailtriage.js undo --last', { env });
  assert.match(undo, /undoing the last recorded run/);
  assert.match(undo, /2026-08-13T13:00:00Z/, 'undo --last picked an older receipt over the newest');
});

// ── 0.7.0: the reverse coherence question, and rule removal ─────────────────

test('audit catches a rule that files into a folder that does not exist', () => {
  // The live 0.6.0 run's finding: a deleted folder left a dangling rule, and
  // audit reported "clean" over it. Two-sided against the frozen corpus: the
  // before-state carries sort-travel → Travel (no such folder) and must be
  // called out; the after-state drops the rule and must still audit clean
  // with exit 0 — or the new check can never be satisfied.
  const before = readFileSync(join(BASELINE, 'audit-before.txt'), 'utf8');
  const after = readFileSync(join(BASELINE, 'audit-after.txt'), 'utf8');
  assert.match(before, /RULES THAT FILE INTO A FOLDER THAT DOES NOT EXIST/);
  assert.match(before, /\| Travel\s+\| a rule\s+\| sort-travel/);
  assert.ok(!/FILE INTO A FOLDER THAT DOES NOT EXIST/.test(after), 'the clean mailbox is now reported as dangling');
  sh('node scripts/gmailtriage.js audit --labels evals/baseline/mailbox-after-labels.json --rules evals/baseline/mailbox-after-rules.json --threads evals/baseline/mailbox-after.json');
});

test('rules --remove deletes exactly the named rules, with a backup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gt-remove-'));
  const file = join(dir, 'rules.json');
  writeFileSync(file, readFileSync(join(BASELINE, 'rules.json')));
  const beforeCount = JSON.parse(readFileSync(file, 'utf8')).rules.length;

  const out = sh(`node scripts/gmailtriage.js rules --file ${file} --remove trash-packages --at 2026-08-13T12:00:00Z`);
  assert.match(out, /\| trash-packages \|/);
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(doc.rules.length, beforeCount - 1);
  assert.ok(!doc.rules.some((r) => r.id === 'trash-packages'));
  // the previous file survives beside it, byte-complete
  const bak = join(dir, 'rules.json.2026-08-13T12-00-00Z.bak');
  assert.ok(existsSync(bak), 'no backup was written before the removal');
  assert.equal(JSON.parse(readFileSync(bak, 'utf8')).rules.length, beforeCount);

  // Two-sided: an unknown id is refused and nothing changes.
  assert.throws(
    () => sh(`node scripts/gmailtriage.js rules --file ${file} --remove no-such-rule`),
    'removing a rule that does not exist should be an error, not a silent no-op',
  );
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).rules.length, beforeCount - 1);
  // and --add + --remove together is two intents, refused
  assert.throws(() => sh(`node scripts/gmailtriage.js rules --file ${file} --remove trash-leadgen --add ${file}`));
});

test('ingest --labels-only refreshes the label snapshot and nothing else', () => {
  const out = mkdtempSync(join(tmpdir(), 'gt-labelsonly-'));
  const text = sh(`node scripts/gmailtriage.js ingest --labels-only --labels evals/baseline/raw-labels.json --out-labels ${out}/labels.json`);
  assert.match(text, /label snapshot refreshed/);
  assert.ok(existsSync(join(out, 'labels.json')));
  assert.ok(!existsSync(join(out, 'threads.json')), 'labels-only wrote a thread snapshot');
  // Two-sided: mixing in a thread flag is refused — the flag means ONLY.
  assert.throws(
    () => sh(`node scripts/gmailtriage.js ingest --labels-only --inbox evals/baseline/raw-inbox.json --labels evals/baseline/raw-labels.json --out-labels ${out}/l2.json`),
  );
});

const CATEGORY_FIXTURES = join(HERE, 'fixtures', 'category-flow');
const categoryCli = (args) => {
  const result = spawnSync(process.execPath, ['scripts/gmailtriage.js', ...args], { cwd: SKILL, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
};
const readCategoryJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const ingestCategoryFixture = (fetches = ['promos', 'updates']) => {
  const dir = mkdtempSync(join(tmpdir(), 'gt-category-'));
  const threads = join(dir, 'threads.json');
  const labels = join(dir, 'labels.json');
  const result = categoryCli(['ingest', '--inbox', join(CATEGORY_FIXTURES, 'raw-inbox.json'),
    '--labels', join(CATEGORY_FIXTURES, 'raw-labels.json'), '--out-threads', threads, '--out-labels', labels,
    ...fetches.flatMap((name) => [`--${name}`, join(CATEGORY_FIXTURES, `raw-${name}.json`)])]);
  return { dir, threads, labels, result };
};
const categoryPlan = ({ dir, threads, labels }, rules = join(CATEGORY_FIXTURES, 'rules.json')) => {
  const out = join(dir, 'plan.json');
  categoryCli(['plan', '--threads', threads, '--labels', labels, '--rules', rules, '--out', out]);
  return readCategoryJson(out);
};

test('category flow: raw ingest to plan matches observed categories without category label ids', () => {
  const files = ingestCategoryFixture();
  const p = categoryPlan(files);
  assert.deepEqual(p.taken.map((t) => [t.threadId, t.ruleId]), [['promo', 'promotions'], ['update', 'updates']],
    'primary is first, so a false primary match cannot hide behind a correct category');
  const snapshot = readCategoryJson(files.threads);
  assert.equal(snapshot.length, 4);
  assert.ok(snapshot.every((t) => !t.labelIds.some((l) => l.startsWith('CATEGORY_'))));
  assert.deepEqual(snapshot.find((t) => t.id === 'overlap').categoryEvidence,
    { status: 'conflict', categories: ['promotions', 'updates'] });
  assert.equal(snapshot.find((t) => t.id === 'missing').category, null);
  assert.match(files.result.stderr, /category evidence: unknown=1 conflict=1/);
  assert.match(files.result.stderr, /overlap.*promotions.*updates/);
  assert.ok(!files.result.stdout.includes('category evidence:'), 'diagnostics must not alter frozen stdout tables');
  assert.match(readFileSync(join(CATEGORY_FIXTURES, 'raw-inbox.json'), 'utf8'), /category-secret-000000/);
  assert.ok(!readFileSync(files.threads, 'utf8').includes('category-secret-000000'));
  assert.ok(!readFileSync(files.threads, 'utf8').includes('snippet'));
});

test('category flow: absent or partial fetches do not make nonmembers primary', () => {
  for (const [fetches, expected] of [[[], []], [['promos'], ['promo', 'overlap']], [['updates'], ['update', 'overlap']]]) {
    const files = ingestCategoryFixture(fetches);
    assert.deepEqual(categoryPlan(files).taken.map((t) => t.threadId), expected);
    const snapshot = readCategoryJson(files.threads);
    assert.equal(snapshot.filter((t) => t.category === null).length, 4 - expected.length);
    assert.match(files.result.stderr, new RegExp(`category evidence: unknown=${4 - expected.length} conflict=0`));
  }
});

test('category flow: proxy trash and label plans reject ambiguous legacy true booleans', () => {
  const files = ingestCategoryFixture();
  const snapshot = readCategoryJson(files.threads);
  snapshot.push(
    { ...snapshot[0], id: 'invalid', category: 'unknown' },
    { ...snapshot[0], id: 'disagree', labelIds: ['INBOX', 'CATEGORY_UPDATES'] },
  );
  // Simulate legacy snapshots whose boolean predates conflict handling.
  for (const t of snapshot) t.hasUnsubscribe = true;
  writeFileSync(files.threads, JSON.stringify(snapshot));
  for (const action of ['trash', 'label']) {
    const rules = join(files.dir, 'proxy-rules.json');
    writeFileSync(rules, JSON.stringify({ version: 1, rules: [{
      id: 'bulk', action, ...(action === 'label' ? { label: 'Filed' } : {}),
      match: { from: 'offers@shop.example', hasUnsubscribe: true }, note: 'Bulk proxy regression',
    }] }));
    assert.deepEqual(categoryPlan(files, rules).taken.map((t) => [t.threadId, t.action]),
      [['promo', action], ['update', action]]);
  }
});
