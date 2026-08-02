// Baseline eval: pinned against real runs, offline and $0.
//
// Runs inside `ci / release` with the normal suite. No network, no model — a
// gate that can spend money is a gate that turns every release into a coin flip.
//
// Three kinds, deliberately different in strictness:
//
//   golden  Frozen REAL `release-status` output re-rendered through the draft
//           grouper and byte-compared. Byte-exact is right here: the rendered
//           draft IS the thing the author edits, so a dropped bullet is a lost
//           change. The INPUT is frozen, so this does not rot when a component
//           is released.
//   trap    The known-bad half. Every assertion above would keep passing if the
//           grouper started silently discarding commits, or the CLI stopped
//           refusing a component with nothing to release — so those are
//           asserted directly.
//   corpus  Live state, asserted with a FLOOR rather than equality: every
//           component declared in .github/shipflow.json must resolve to real
//           files, and every skill in skills/ must be declared. A resolver that
//           matches nothing must go red, not green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { groupCommits, renderDraft, resolveShipflow } from '../release.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(HERE, '..', '..');
const BASELINE = join(SKILL_ROOT, 'evals', 'baseline');
// skills/release/skills/release -> the repo root is four levels up.
const REPO_ROOT = resolve(SKILL_ROOT, '..', '..', '..', '..');
const REFRESH = 'node evals/baseline/update.mjs';

const frozen = (name) => JSON.parse(readFileSync(join(BASELINE, `status-${name}.json`), 'utf8'));

// ─── golden ──────────────────────────────────────────────────────────────────

test('baseline: a real status still renders its frozen changelog draft byte-for-byte', () => {
  for (const name of ['ghostwriter', 'press']) {
    const status = frozen(name);
    const golden = readFileSync(join(BASELINE, `changelog-draft-${name}.md`), 'utf8');
    const rendered = `${renderDraft(groupCommits(status.commits))}\n`;
    if (rendered !== golden) {
      const a = rendered.split('\n');
      const b = golden.split('\n');
      const i = a.findIndex((line, idx) => line !== b[idx]);
      assert.fail(
        `The draft for ${name} diverges from the frozen golden at line ${i + 1}:\n` +
          `  rendered: ${JSON.stringify(a[i])}\n` +
          `  golden:   ${JSON.stringify(b[i])}\n\n` +
          `If the change is INTENTIONAL, refresh with:\n  ${REFRESH}`
      );
    }
  }
});

test('baseline: the frozen runs still describe the shapes they were chosen for', () => {
  // The fixture set is only meaningful if it still spans the three shapes the
  // grouper and the state machine behave differently on. A refresh that
  // collapsed them all to "no commits" would leave every assertion above
  // passing over nothing.
  assert.ok(frozen('ghostwriter').commits.length >= 5, 'the many-commit fixture no longer has many commits');
  assert.equal(frozen('press').commits.length, 1, 'the single-commit fixture changed shape');
  assert.equal(frozen('eval').commits.length, 0, 'the no-commit fixture changed shape');
  const types = new Set(frozen('ghostwriter').commits.map((c) => c.type));
  assert.ok(types.size >= 3, `the many-commit fixture spans only ${types.size} commit type(s) — it no longer exercises grouping`);
});

// ─── trap: the known-bad half ────────────────────────────────────────────────

test('trap: grouping never silently drops a commit', () => {
  // A grouper that discards a commit still produces a plausible,
  // complete-looking entry. That is the failure nobody would ever notice, so
  // the code counts what it placed and refuses rather than trusting itself.
  const commit = (over) => ({ sha: 'deadbeef', type: 'feat', scope: null, subject: 's', breaking: false, conventional: true, ...over });

  // An unrecognised type must land in Uncategorised, never vanish.
  const weird = groupCommits([commit({ type: 'notatype', sha: 'cafe0000' })]);
  assert.equal(weird.flatMap((g) => g.commits).length, 1, 'an unknown commit type was dropped');
  assert.equal(weird[0].title, 'Uncategorised');

  // And a non-conventional commit, which carries type: null.
  const plain = groupCommits([commit({ type: null, conventional: false, sha: 'f00d0000' })]);
  assert.equal(plain.flatMap((g) => g.commits).length, 1, 'a non-conventional commit was dropped');

  // No commits must produce no sections — never an empty-looking entry.
  assert.equal(groupCommits([]).length, 0);
});

test('trap: every frozen commit reaches the rendered draft', () => {
  for (const name of ['ghostwriter', 'press']) {
    const status = frozen(name);
    const draft = readFileSync(join(BASELINE, `changelog-draft-${name}.md`), 'utf8');
    assert.ok(status.commits.length > 0, `${name} froze with no commits — this assertion would check nothing`);
    for (const c of status.commits) {
      assert.ok(draft.includes(c.sha), `${name}: commit ${c.sha} ("${c.subject}") is missing from the draft`);
    }
  }
});

test('trap: a component with nothing to release is refused, not drafted', () => {
  // `eval` was frozen at zero unreleased commits, and is still at zero live.
  // Drafting notes for it must fail: a release whose entry says nothing is how
  // notes ship saying nothing.
  const r = run(['changelog-draft', '--repo', REPO_ROOT, '--component', 'eval']);
  assert.notEqual(r.status, 0, 'changelog-draft on a component with nothing to release must exit non-zero');
  assert.match(r.stderr, /nothing to write notes about/);
});

test('trap: cut refuses without a status hash', () => {
  // The TOCTOU guard is the last thing standing between an approved table and
  // an irreversible tag. A cut that proceeded without it would look identical
  // to one that was checked.
  const r = run(['cut', '--repo', REPO_ROOT, '--component', 'press']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--expect-status-hash is required/);
});

// ─── corpus: live state, with floors ─────────────────────────────────────────

const config = JSON.parse(readFileSync(join(REPO_ROOT, '.github', 'shipflow.json'), 'utf8'));
const declared = (config.release?.components ?? []).map((e) => (typeof e === 'string' ? e : e?.name)).filter(Boolean);
const MIN_COMPONENTS = 12;

test('corpus: every declared component resolves to real files, over a real floor', () => {
  assert.ok(
    declared.length >= MIN_COMPONENTS,
    `Only ${declared.length} component(s) declared in .github/shipflow.json, floor is ${MIN_COMPONENTS}. ` +
      `A resolver that matches nothing reports every component healthy over an empty set — ` +
      `this floor is what makes that go red instead of green.`
  );
  const layout = config.release.componentLayout;
  for (const name of declared) {
    const expand = (p) => join(REPO_ROOT, p.replaceAll('{name}', name));
    assert.ok(existsSync(expand(layout.changelog)), `${name}: no CHANGELOG at ${layout.changelog.replaceAll('{name}', name)}`);
    assert.ok(
      layout.versionFiles.some((f) => existsSync(expand(f))),
      `${name}: none of its declared versionFiles exist — it can never be released`
    );
    assert.ok(
      existsSync(join(REPO_ROOT, '.github', 'workflows', layout.workflowFile.replaceAll('{name}', name))),
      `${name}: no caller workflow — nothing would cut its tag`
    );
  }
});

test('corpus: every skill in the repo is declared as a component', () => {
  // The failure this catches: a new skill ships, nobody adds it to
  // release.components, and `release preflight` reports on 12 of 13 while
  // looking complete.
  const skills = readdirSync(join(REPO_ROOT, 'skills'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  assert.ok(skills.length >= MIN_COMPONENTS, `only ${skills.length} skills found — the corpus resolver matched nothing`);
  const missing = skills.filter((s) => !declared.includes(s));
  assert.deepEqual(
    missing,
    [],
    `These skills exist but are not declared in .github/shipflow.json's release.components, ` +
      `so \`release\` cannot see them: ${missing.join(', ')}`
  );
});

test('corpus: the shipflow this skill would call is new enough to have the commands', () => {
  const bin = resolveShipflow(REPO_ROOT);
  assert.equal(bin.where, 'in-repo', 'a checkout that ships shipflow must use its own copy, never the registry');
  const help = execFileSync(bin.cmd, [...bin.args, '--help'], { encoding: 'utf8' });
  for (const cmd of ['release-status', 'release-prepare', 'release-cut']) {
    assert.match(help, new RegExp(cmd), `shipflow does not offer ${cmd} — every mutating step of this skill depends on it`);
  }
});

// ─── helper ──────────────────────────────────────────────────────────────────

// spawnSync, not execFileSync: these calls are EXPECTED to exit non-zero, and
// execFileSync throws on that, which would turn "the refusal fired correctly"
// into a test error.
function run(args) {
  const r = spawnSync(process.execPath, [join(SKILL_ROOT, 'scripts', 'release.js'), ...args], {
    encoding: 'utf8',
    timeout: 120_000,
    // NODE_TEST_CONTEXT is inherited by child processes. Any child that is
    // itself a node test runner would exit 0 having executed nothing, silently
    // inverting every "did it fail?" assertion here. release.js is not a test
    // runner, but the variable is scrubbed so it cannot quietly become one.
    env: { ...process.env, NODE_TEST_CONTEXT: undefined },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
