import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { templates } from '../lib/patterns/github-flow/index.mjs';
import { renderTemplate } from '../lib/render.mjs';
import { computePlan } from '../lib/plan.mjs';
import { applyPlan } from '../lib/apply.mjs';
import { sha256 } from '../lib/gh.mjs';

const config = {
  workflowPattern: 'github-flow', branches: { main: 'main' },
  mergeMethod: { devToMainMethod: 'squash' },
  release: { releaseCredential: 'SHIPFLOW_AUTOMERGE_PAT' },
  protectionOwner: 'external', requiredChecks: ['ci / test'],
};
const [entry] = templates(config);
const source = readFileSync(entry.templateSourcePath, 'utf8');
const rendered = renderTemplate(source, entry.params);
const workflow = parse(rendered);
const repository = 'example/project';
const token = 'synthetic-test-token';

// This intentionally small interpreter evaluates the rendered guards. Unknown
// syntax fails the test instead of accidentally treating a new guard as true.
function operand(text, context) {
  if (text === 'true' || text === 'false') return text === 'true';
  if (/^'[^']*'$/.test(text)) return text.slice(1, -1);
  if (/^(github|secrets)(\.[a-zA-Z_][a-zA-Z_0-9]*)+$/.test(text)) {
    return text.split('.').reduce((value, key) => value?.[key], context) ?? '';
  }
  throw new Error('unsupported operand: ' + text);
}
function evaluate(expression, context) {
  const clauses = expression.split(/\s*&&\s*/).map((clause) => {
    const match = clause.trim().match(/^(.+?)\s*(==|!=)\s*(.+)$/);
    if (!match) throw new Error('unsupported guard: ' + clause);
    const left = operand(match[1].trim(), context);
    const right = operand(match[3].trim(), context);
    // Used operands have matching types. GitHub compares strings ignoring case.
    const equal = typeof left === 'string' && typeof right === 'string'
      ? left.toLowerCase() === right.toLowerCase() : left === right;
    return match[2] === '==' ? equal : !equal;
  });
  return clauses.every(Boolean);
}
function interpolate(text, context) {
  return text.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, expression) => String(operand(expression, context)));
}
function contextFor({ action = 'opened', draft = false, origin = repository, merged = false, credential = token } = {}) {
  return {
    github: { repository, event: { action, pull_request: {
      number: 42, draft, merged, base: { ref: 'main' },
      head: { repo: origin === null ? null : { full_name: origin } },
    } } },
    secrets: { SHIPFLOW_AUTOMERGE_PAT: credential },
  };
}
function admitted(context) {
  const trigger = workflow.on.pull_request;
  if (!trigger.types.includes(context.github.event.action)
    || !trigger.branches.includes(context.github.event.pull_request.base.ref)) return [];
  return Object.entries(workflow.jobs).filter(([, job]) => evaluate(job.if, context)).map(([name]) => name);
}
function runGenerated(context) {
  const directory = mkdtempSync(join(tmpdir(), 'shipflow-events-'));
  try {
    const recorder = join(directory, 'gh');
    const log = join(directory, 'calls.jsonl');
    writeFileSync(recorder, '#!' + process.execPath + '\n'
      + 'require("node:fs").appendFileSync(process.env.GH_RECORD, JSON.stringify(process.argv.slice(2)) + "\\n");\n');
    chmodSync(recorder, 0o755);
    let output = '';
    for (const name of admitted(context)) {
      for (const step of workflow.jobs[name].steps) {
        assert.equal(typeof step.run, 'string');
        const env = Object.fromEntries(Object.entries(step.env).map(([key, value]) => [key, interpolate(value, context)]));
        // Do not inherit real credentials or execute a real gh. Only this fake
        // recorder and the generated shell are used, with synthetic event data.
        const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', interpolate(step.run, context)], {
          cwd: directory, encoding: 'utf8', env: {
            PATH: directory + ':/usr/bin:/bin', TMPDIR: tmpdir(), GH_RECORD: log, ...env,
          },
        });
        assert.equal(result.status, 0, result.stderr);
        output += result.stdout + result.stderr;
      }
    }
    assert.ok(!output.includes(token), 'credential must not be printed');
    return { calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [], output };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
const mergeArgs = ['pr', 'merge', '--auto', '--squash', '42', '--repo', repository];
const labelArgs = ['pr', 'edit', '42', '--add-label', 'release-pending', '--repo', repository];

for (const action of ['opened', 'reopened', 'synchronize', 'ready_for_review']) {
  test(action + ': ready same-repository PR enables native auto-merge', () => {
    const context = contextFor({ action });
    assert.deepEqual(admitted(context), ['auto-merge']);
    assert.deepEqual(runGenerated(context).calls, [mergeArgs]);
  });
  for (const draft of [false, true]) {
    for (const origin of [repository, 'contributor/fork', null]) {
      if (!draft && origin === repository) continue;
      test(action + ': draft=' + draft + ', origin=' + origin + ' skips both commands', () => {
        const context = contextFor({ action, draft, origin });
        assert.deepEqual(admitted(context), []);
        assert.deepEqual(runGenerated(context).calls, []);
      });
    }
  }
}
for (const merged of [false, true]) {
  for (const origin of [repository, 'contributor/fork', null]) {
    test('closed: merged=' + merged + ', origin=' + origin, () => {
      const context = contextFor({ action: 'closed', merged, origin });
      const supported = merged && origin === repository;
      assert.deepEqual(admitted(context), supported ? ['label-release-pending'] : []);
      assert.deepEqual(runGenerated(context).calls, supported ? [labelArgs] : []);
    });
  }
}
for (const event of [{ action: 'opened' }, { action: 'closed', merged: true }]) {
  for (const credential of ['', undefined]) {
    test(event.action + ': unavailable credential skips cleanly', () => {
      const context = contextFor(event);
      context.secrets.SHIPFLOW_AUTOMERGE_PAT = credential;
      const { calls, output } = runGenerated(context);
      assert.deepEqual(calls, []);
      assert.match(output, /skip.*GH_TOKEN.*(unavailable|not configured)/i);
    });
  }
}

test('only declared PR events and main base are admitted', () => {
  assert.deepEqual(Object.keys(workflow.on), ['pull_request']);
  assert.deepEqual(workflow.on.pull_request.types, ['opened', 'reopened', 'synchronize', 'ready_for_review', 'closed']);
  assert.deepEqual(admitted(contextFor({ action: 'edited' })), []);
  const otherBase = contextFor();
  otherBase.github.event.pull_request.base.ref = 'feature/stack';
  assert.deepEqual(admitted(otherBase), []);
});

test('metadata-only jobs retain scoped permissions and safe command inputs', () => {
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(Object.keys(workflow.jobs), ['auto-merge', 'label-release-pending']);
  for (const job of Object.values(workflow.jobs)) {
    assert.deepEqual(job.permissions, { 'pull-requests': 'write' });
    assert.equal(job.uses, undefined);
    assert.equal(job.steps.length, 1);
    const [step] = job.steps;
    assert.equal(step.uses, undefined);
    assert.equal(step.env.GH_TOKEN, '${{ secrets.SHIPFLOW_AUTOMERGE_PAT }}');
    assert.equal(step.env.PR_NUMBER, '${{ github.event.pull_request.number }}');
    assert.equal(step.env.PR_REPO, '${{ github.repository }}');
    assert.doesNotMatch(step.run, /\$\{\{|checkout|\bgit\b|\brelease\s+(create|run)|workflow\s+run/);
    assert.match(step.run, /"\$PR_NUMBER"/);
    assert.match(step.run, /"\$PR_REPO"/);
  }
  const unusual = contextFor();
  // Shell metacharacters remain argv data, even for this impossible API value.
  unusual.github.event.pull_request.number = '42; printf injected';
  const { calls, output } = runGenerated(unusual);
  assert.deepEqual(calls, [[...mergeArgs.slice(0, 4), '42; printf injected', ...mergeArgs.slice(5)]]);
  assert.doesNotMatch(output, /injected/);
});

test('guard evaluator rejects syntax outside the tested grammar', () => {
  assert.throws(() => evaluate('always()', contextFor()), /unsupported/);
  assert.throws(() => evaluate("github.event.action == 'opened' || true", contextFor()), /unsupported/);
});

// Actual generated main workflow at a52a9fd (shipflow 0.6.0), retained inline
// so migration is tested without requiring git history or a mutable live file.
const previousGenerated = [
  "name: auto-merge to main",
  "",
  "# Rendered by shipflow's apply.mjs from this template. Do not hand-edit",
  "# without also updating .github/shipflow.json's renderedTemplateHashes entry",
  "# for this file, or shipflow's next apply will refuse to overwrite it",
  "# (handEditDetected) until an explicit --force is passed. Commit both files",
  "# together in the same commit.",
  "#",
  "# GitHub Flow has no separate \"promotion\" branch \u2014 every PR into main",
  "# is eligible for auto-merge and every merge is release-worthy, so unlike",
  "# dev-main-promotion's template, neither job here restricts on head.ref.",
  "#",
  "# GH_TOKEN uses config.release.releaseCredential, NOT a hardcoded",
  "# secrets.GITHUB_TOKEN, because of GitHub's loop-prevention rule: a PR",
  "# auto-merged via `gh pr merge --auto` run under the default GITHUB_TOKEN",
  "# completes (later, asynchronously, once checks pass) attributed to the",
  "# github-actions[bot] identity \u2014 and a `pull_request: closed` event",
  "# resulting from that bot-attributed merge does NOT trigger this or any",
  "# other workflow's `on: pull_request` handlers. Confirmed empirically:",
  "# an identical PR merged by a real, PAT-authenticated actor fired the",
  "# closed-event trigger immediately; one completed by GITHUB_TOKEN-enabled",
  "# auto-merge fired no run at all. releaseCredential must therefore name a",
  "# real PAT/App-installation-token secret (not GITHUB_TOKEN) for",
  "# label-release-pending to ever actually run.",
  "",
  "on:",
  "  pull_request:",
  "    types: [opened, reopened, synchronize, closed]",
  "    branches: [main]",
  "",
  "# Deny by default at the workflow level, grant per job. A workflow-level grant",
  "# applies to every job in the file, including ones added later that never",
  "# needed it \u2014 which is why zizmor's excessive-permissions rule flags it, and",
  "# why the fix is to scope rather than to waive.",
  "#",
  "# `contents: write` is dropped entirely, not moved. `gh pr merge --auto` only",
  "# *enables* native auto-merge, a pull-requests operation; GitHub performs the",
  "# merge itself afterwards, under its own automation rather than this token.",
  "permissions: {}",
  "",
  "jobs:",
  "  # Enables native GitHub auto-merge on open/reopen/synchronize \u2014 this job",
  "  # does NOT wait for checks itself; it turns on auto-merge and exits. The",
  "  # actual merge happens asynchronously, later, whenever GitHub's own",
  "  # required-checks gate is satisfied (see the design's discussion of why a",
  "  # bespoke polling/blocking job was rejected).",
  "  auto-merge:",
  "    if: github.event.action != 'closed'",
  "    runs-on: ubuntu-latest",
  "    permissions:",
  "      pull-requests: write",
  "    steps:",
  "      - name: Enable auto-merge",
  "        run: gh pr merge --auto --squash \"${{ github.event.pull_request.number }}\" --repo \"${{ github.repository }}\"",
  "        env:",
  "          GH_TOKEN: ${{ secrets.SHIPFLOW_AUTOMERGE_PAT }}",
  "",
  "  # Fires once, when a PR actually merges (a separate event from the job",
  "  # above, which only *enables* auto-merge). Applies a durable",
  "  # release-pending label so a later, disconnected shipflow invocation can",
  "  # find this merge and ask about a release \u2014 the merge completion has no",
  "  # live Claude session attached to react to it directly.",
  "  label-release-pending:",
  "    if: >-",
  "      github.event.action == 'closed' &&",
  "      github.event.pull_request.merged == true",
  "    runs-on: ubuntu-latest",
  "    permissions:",
  "      pull-requests: write",
  "    steps:",
  "      - name: Apply release-pending label",
  "        run: gh pr edit \"${{ github.event.pull_request.number }}\" --add-label release-pending --repo \"${{ github.repository }}\"",
  "        env:",
  "          GH_TOKEN: ${{ secrets.SHIPFLOW_AUTOMERGE_PAT }}",
  '',
].join('\n');

function stateFor(contents) {
  return {
    stateHash: sha256(contents), repoSettings: { deleteBranchOnMerge: true },
    rulesets: [], protection: { main: { requiredChecks: ['ci / test'] } },
    releasePendingLabelExists: true,
    templateFiles: { [entry.targetPath]: { exists: true, sha256: sha256(contents) } },
  };
}

test('recognized previous render migrates through plan/apply and persisted receipts converge', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shipflow-migration-'));
  try {
    const file = join(directory, entry.targetPath);
    const configFile = join(directory, '.github/shipflow.json');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, previousGenerated);
    assert.equal(sha256(previousGenerated), 'c3d9150170792d69390ad4816e83b1a4e7340da55369816b3fa77c6ebc287174');
    const priorConfig = { ...config, renderedTemplateHashes: { [entry.targetPath]: sha256(previousGenerated) } };
    writeFileSync(configFile, JSON.stringify(priorConfig));
    const sources = { [entry.id]: source };
    const state = stateFor(readFileSync(file, 'utf8'));
    const plan = computePlan(state, JSON.parse(readFileSync(configFile, 'utf8')), sources);
    assert.deepEqual(plan.creates, []);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.updates[0].handEditDetected, false);
    assert.deepEqual(plan.liveRequiredChecks, ['ci / test']);
    const result = applyPlan(plan, {
      currentStateHash: state.stateHash, repoPath: directory, config: priorConfig,
      ownerRepo: repository,
    });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.skipped, []);
    assert.equal(result.applied.length, 1);
    assert.equal(result.applied[0].forced, undefined);
    assert.equal(readFileSync(file, 'utf8'), rendered);
    assert.deepEqual(result.renderedTemplateHashes, { [entry.targetPath]: sha256(rendered) });
    writeFileSync(configFile, JSON.stringify({ ...priorConfig, renderedTemplateHashes: result.renderedTemplateHashes }));
    const persisted = JSON.parse(readFileSync(configFile, 'utf8'));
    const next = computePlan(stateFor(readFileSync(file, 'utf8')), persisted, sources);
    assert.deepEqual(next.creates, []);
    assert.deepEqual(next.updates, []);
    assert.equal(next.noops.length, 4);

    const edited = rendered + '\n# user edit\n';
    writeFileSync(file, edited);
    const changed = stateFor(readFileSync(file, 'utf8'));
    const blockedPlan = computePlan(changed, persisted, sources);
    assert.equal(blockedPlan.updates[0].handEditDetected, true);
    const blocked = applyPlan(blockedPlan, { currentStateHash: changed.stateHash, repoPath: directory, config: persisted, ownerRepo: repository });
    assert.deepEqual(blocked.applied, []);
    assert.match(blocked.skipped[0].reason, /hand-edit detected/);
    assert.equal(readFileSync(file, 'utf8'), edited);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
