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
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PREFLIGHT_HEADERS, groupCommits, renderDraft, resolveShipflow } from '../release.js';

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
  // grouper behaves differently on (all three fixtures are state: "clean" —
  // this does not span the state machine; that is pinned separately by
  // shipflow's own tests/release.test.mjs). A refresh that collapsed them all
  // to "no commits" would leave every assertion above passing over nothing.
  assert.ok(frozen('ghostwriter').commits.length >= 5, 'the many-commit fixture no longer has many commits');
  assert.equal(frozen('press').commits.length, 1, 'the single-commit fixture changed shape');
  assert.equal(frozen('eval').commits.length, 0, 'the no-commit fixture changed shape');
  const types = new Set(frozen('ghostwriter').commits.map((c) => c.type));
  assert.ok(types.size >= 3, `the many-commit fixture spans only ${types.size} commit type(s) — it no longer exercises grouping`);
});

test('preflight: the On dev column cannot silently vanish', () => {
  // Issue #173: dev carrying a newer version than main is the fact that was
  // silently dropped. Layer 1 (shipflow) makes `cut` refuse the ambiguity;
  // this is the layer-2 half — the table the operator actually reads must
  // show `On main` and `On dev` side by side so the mismatch is visible
  // before `cut` is ever called, not just after it refuses.
  assert.ok(PREFLIGHT_HEADERS.includes('On main'), 'the On main column is missing from the preflight table');
  assert.ok(PREFLIGHT_HEADERS.includes('On dev'), 'the On dev column is missing from the preflight table');
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
  // Drafting notes for a component with no unreleased commits must fail: a
  // release whose entry says nothing is how notes ship saying nothing.
  //
  // This drives the FROZEN zero-commit status through `--from`, deliberately
  // never touching git. The first version of this test shelled out to
  // `changelog-draft --component eval` against the live repo, which was
  // environment-dependent and went green locally while failing in CI: the
  // caller's checkout is shallow with NO TAGS, so `lastTag` resolved to null,
  // `commitsSince` returned every commit ever touching skills/eval instead of
  // none, the command succeeded, and the "must exit non-zero" assertion
  // inverted. A full clone (including a `git worktree`, which is how this was
  // verified) has tags and cannot reproduce it. A baseline that reads live git
  // state is not a baseline — this skill's own invariants say so.
  const dir = mkdtempSync(join(tmpdir(), 'release-trap-'));
  try {
    copyFileSync(join(BASELINE, 'status-eval.json'), join(dir, 'status-eval.json'));
    const r = run(['changelog-draft', '--from', dir, '--out', join(dir, 'out')]);
    assert.notEqual(r.status, 0, 'a status set with zero unreleased commits must exit non-zero, not emit an empty draft');
    assert.match(r.stderr, /zero commits|render was a no-op/);
    assert.ok(!existsSync(join(dir, 'out', 'changelog-draft-eval.md')), 'no draft file may be written for a component with nothing to release');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test('corpus: no release job can be triggered by a push — dispatch is the only release path', () => {
  // The single most important structural property of this repo's release model,
  // and the one most likely to be undone by a well-meaning edit.
  //
  // Until 2026-08-02 the release jobs also ran on `push` to main, so a
  // `dev -> main` merge tagged and npm-published every bumped component within
  // seconds — no dispatch, no decision. It cost two releases: city-report-v0.4.0
  // shipped with stale notes, and shipflow-v0.4.0 went to npm off a merge nobody
  // had approved as a release.
  //
  // `release cut` now dispatches deliberately, so re-adding `push` here would
  // double-release; and this assertion is what makes that impossible to do
  // quietly.
  // Match on the `uses:` line specifically, not a bare mention of the filename:
  // press-propagate.yml discusses `_release.yml` in a comment while having no
  // release job at all, and a looser filter reported it as unguarded. An audit
  // that flags a file which can never release anything is the "cries wolf"
  // failure this repo already fixed once, in CLAUDE.md's required-check audit.
  const dir = join(REPO_ROOT, '.github', 'workflows');
  const callers = readdirSync(dir).filter(
    (f) => f.endsWith('.yml') && /^\s*uses:\s*\.\/\.github\/workflows\/_release\.yml\s*$/m.test(readFileSync(join(dir, f), 'utf8'))
  );
  assert.ok(
    callers.length >= MIN_COMPONENTS,
    `only ${callers.length} caller workflow(s) found, floor is ${MIN_COMPONENTS} — the resolver matched nothing and would report every caller safe`
  );
  for (const file of callers) {
    const yaml = readFileSync(join(dir, file), 'utf8');
    const releaseJob = yaml.slice(yaml.indexOf('\n  release:'));
    const cond = /^\s*if:\s*(.+)$/m.exec(releaseJob)?.[1] ?? '';
    assert.ok(cond, `${file}: the release job has no if: condition at all — it would run on every trigger`);
    assert.ok(
      cond.includes("github.event_name == 'workflow_dispatch'"),
      `${file}: the release job must be gated on workflow_dispatch, got: ${cond}`
    );
    assert.ok(
      !cond.includes("'push'"),
      `${file}: the release job admits push events again — a dev -> main merge would cut a tag with no dispatch. This is the exact regression that released city-report-v0.4.0 with stale notes and shipflow-v0.4.0 to npm unasked.`
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
    // A plain substring check, not a constructed regex: these are literal
    // command names, and there is no reason to hand them to a regex engine.
    assert.ok(help.includes(cmd), `shipflow does not offer ${cmd} — every mutating step of this skill depends on it`);
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
