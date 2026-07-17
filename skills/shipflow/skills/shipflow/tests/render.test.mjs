import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTemplate, mergeMethodToFlag, assertTokenValidatorsComplete } from '../lib/render.mjs';

const TEMPLATE = 'dev={{DEV_BRANCH}} main={{MAIN_BRANCH}} flag={{MERGE_FLAG}}';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUTOMERGE_TEMPLATE_SOURCE = readFileSync(
  join(SKILL_ROOT, 'templates', 'dev-to-main-automerge.yml.tmpl'),
  'utf8'
);

test('renderTemplate substitutes all known tokens', () => {
  const out = renderTemplate(TEMPLATE, { devBranch: 'develop', mainBranch: 'trunk', mergeFlag: '--squash' });
  assert.equal(out, 'dev=develop main=trunk flag=--squash');
});

test('renderTemplate throws on a missing param', () => {
  assert.throws(
    () => renderTemplate(TEMPLATE, { devBranch: 'develop', mainBranch: 'trunk' }),
    /missing param.*MERGE_FLAG/
  );
});

test('renderTemplate is pure — same input always produces the same output', () => {
  const params = { devBranch: 'dev', mainBranch: 'main', mergeFlag: '--merge' };
  assert.equal(renderTemplate(TEMPLATE, params), renderTemplate(TEMPLATE, params));
});

test('mergeMethodToFlag maps known methods', () => {
  assert.equal(mergeMethodToFlag('squash'), '--squash');
  assert.equal(mergeMethodToFlag('rebase'), '--rebase');
  assert.equal(mergeMethodToFlag('merge'), '--merge');
});

test('mergeMethodToFlag defaults to --merge for an unknown value', () => {
  assert.equal(mergeMethodToFlag('bogus'), '--merge');
  assert.equal(mergeMethodToFlag(undefined), '--merge');
});

// Regression test for a bug found by dogfooding shipflow on its own repo:
// neither `gh` call in the rendered workflow had an explicit --repo, so both
// silently failed off a checkout-less runner ("not a git repository") the
// moment the workflow ran from a fork-less, checkout-less job — exactly how
// this template always runs. No prior test caught it because none read the
// actual .tmpl file's gh invocations.
test('auto-merge job passes --repo to gh pr merge (no checkout step to infer it from)', () => {
  const rendered = renderTemplate(AUTOMERGE_TEMPLATE_SOURCE, {
    devBranch: 'dev',
    mainBranch: 'main',
    mergeFlag: '--merge',
    releaseCredentialSecret: 'GITHUB_TOKEN',
  });
  const mergeLine = rendered.split('\n').find((l) => l.includes('run: gh pr merge'));
  assert.ok(mergeLine, 'expected a `gh pr merge` line in the rendered workflow');
  assert.match(mergeLine, /--repo "\$\{\{ github\.repository \}\}"/);
});

test('label-release-pending job passes --repo to gh pr edit (no checkout step to infer it from)', () => {
  const rendered = renderTemplate(AUTOMERGE_TEMPLATE_SOURCE, {
    devBranch: 'dev',
    mainBranch: 'main',
    mergeFlag: '--merge',
    releaseCredentialSecret: 'GITHUB_TOKEN',
  });
  const labelLine = rendered.split('\n').find((l) => l.includes('run: gh pr edit'));
  assert.ok(labelLine, 'expected a `gh pr edit` line in the rendered workflow');
  assert.match(labelLine, /--repo "\$\{\{ github\.repository \}\}"/);
});

// Regression test for a second, more serious bug found by the same dogfood
// run: a PR auto-merged under secrets.GITHUB_TOKEN completes (once checks
// pass) attributed to github-actions[bot], and GitHub's loop-prevention
// rule means that bot-attributed merge's `pull_request: closed` event never
// triggers this or any other workflow — so label-release-pending silently
// never ran at all (confirmed empirically: an otherwise-identical PR merged
// by a real, PAT-authenticated actor fired the closed event immediately).
// Both gh calls must use config.release.releaseCredential, not a hardcoded
// GITHUB_TOKEN, so a real PAT/App-token secret can be substituted in.
test('both gh calls use the configurable release-credential secret, not a hardcoded GITHUB_TOKEN', () => {
  const rendered = renderTemplate(AUTOMERGE_TEMPLATE_SOURCE, {
    devBranch: 'dev',
    mainBranch: 'main',
    mergeFlag: '--merge',
    releaseCredentialSecret: 'SHIPFLOW_AUTOMERGE_PAT',
  });
  const ghTokenLines = rendered.split('\n').filter((l) => l.includes('GH_TOKEN:'));
  assert.equal(ghTokenLines.length, 2, 'expected exactly 2 GH_TOKEN env lines (auto-merge + label-release-pending)');
  for (const line of ghTokenLines) {
    assert.match(line, /secrets\.SHIPFLOW_AUTOMERGE_PAT/);
    assert.doesNotMatch(line, /secrets\.GITHUB_TOKEN/);
  }
});

// Regression tests for a Critical finding from a Siege security audit
// (2026-07-15): renderTemplate did pure string substitution with zero
// escaping, and DEV_BRANCH/MAIN_BRANCH/RELEASE_CREDENTIAL_SECRET all come
// from .github/shipflow.json — editable by anyone with repo WRITE access,
// not just the admin who ran shipflow's setup. A branch name containing a
// single quote broke out of the auto-merge job's single-quoted `if:`
// comparison, making it unconditionally true (auto-merge would enable on
// ANY pull request to main, not just genuine dev-branch promotions) — a
// privilege escalation from repo-write to effectively-admin-scoped mutation.
test('renderTemplate rejects a branch name that would break out of the single-quoted if: comparison', () => {
  assert.throws(
    () =>
      renderTemplate(AUTOMERGE_TEMPLATE_SOURCE, {
        devBranch: "dev' || 'x'=='x",
        mainBranch: 'main',
        mergeFlag: '--merge',
        releaseCredentialSecret: 'GITHUB_TOKEN',
      }),
    /unsafe value.*DEV_BRANCH/
  );
});

test('renderTemplate rejects a branch name containing a newline (YAML/step injection)', () => {
  assert.throws(
    () =>
      renderTemplate(AUTOMERGE_TEMPLATE_SOURCE, {
        devBranch: 'dev',
        mainBranch: 'main\n  evil-job:\n    runs-on: ubuntu-latest',
        mergeFlag: '--merge',
        releaseCredentialSecret: 'GITHUB_TOKEN',
      }),
    /unsafe value.*MAIN_BRANCH/
  );
});

test('renderTemplate rejects a release-credential secret name outside GitHub\'s secret-naming rules', () => {
  assert.throws(
    () =>
      renderTemplate(AUTOMERGE_TEMPLATE_SOURCE, {
        devBranch: 'dev',
        mainBranch: 'main',
        mergeFlag: '--merge',
        releaseCredentialSecret: "X}}\nenv:\n  EVIL: true",
      }),
    /unsafe value.*RELEASE_CREDENTIAL_SECRET/
  );
});

test('renderTemplate still accepts ordinary branch names and secret names', () => {
  const rendered = renderTemplate(AUTOMERGE_TEMPLATE_SOURCE, {
    devBranch: 'feature/dev-branch',
    mainBranch: 'main',
    mergeFlag: '--merge',
    releaseCredentialSecret: 'SHIPFLOW_AUTOMERGE_PAT',
  });
  assert.match(rendered, /feature\/dev-branch/);
});

test('renderTemplate substitutes RELEASE_BRANCH_PREFIX and HOTFIX_BRANCH_PREFIX', () => {
  const out = renderTemplate("release={{RELEASE_BRANCH_PREFIX}} hotfix={{HOTFIX_BRANCH_PREFIX}}", {
    devBranch: 'dev', mainBranch: 'main', mergeFlag: '--merge',
    releaseCredentialSecret: 'RELEASE_PAT',
    releaseBranchPrefix: 'release/', hotfixBranchPrefix: 'hotfix/',
  });
  assert.strictEqual(out, 'release=release/ hotfix=hotfix/');
});

test('renderTemplate rejects a release/hotfix branch prefix containing a quote or newline', () => {
  assert.throws(() => renderTemplate('{{RELEASE_BRANCH_PREFIX}}', {
    devBranch: 'dev', mainBranch: 'main', mergeFlag: '--merge',
    releaseCredentialSecret: 'RELEASE_PAT', releaseBranchPrefix: "release/' || 'x'=='x",
    hotfixBranchPrefix: 'hotfix/',
  }), /unsafe value/);
});

test('assertTokenValidatorsComplete throws when a TOKEN_TO_PARAM key has no matching TOKEN_VALIDATORS key', () => {
  assert.throws(
    () => assertTokenValidatorsComplete({ FOO: 'foo', BAR: 'bar' }, { FOO: () => true }),
    /BAR/
  );
});

test('assertTokenValidatorsComplete does not throw when every key is covered', () => {
  assert.doesNotThrow(() => assertTokenValidatorsComplete({ FOO: 'foo' }, { FOO: () => true }));
});
