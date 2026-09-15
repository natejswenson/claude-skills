import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkScope, observedRisk } from '../lib/contracts.mjs';
import { contractPreflight } from '../lib/preflight.mjs';

// Synthetic form of the design-only run that was rejected by the `persist` path
// heuristic. Normative prose and JSON records describe future behavior.
const designPath = 'docs/design/persistent-memory.md';
const design = '# Persistent memory design\n\nThe module must retain corrections and never dispatch actions from recalled data.\n\n```json\n{"op":"recall","scope":"project"}\n```\n';
const docsContract = (path) => ({
  schema: 2, risk: 'docs',
  criteria: [{ id: 'D1', description: 'Review the memory design document.' }],
  nonGoals: ['Implementing a memory engine'], allowedPaths: [path],
  checks: [{ id: 'document', type: 'command', argv: ['git', 'diff', '--check'], cwd: '.', mode: 'read-only', criteria: ['D1'] }],
});

test('design topics and normative prose do not become executable scope', () => {
  for (const path of [designPath, 'docs/design/authentication.md', 'docs/plans/concurrent-writes.rst']) {
    assert.equal(observedRisk([path], () => design).kind, 'fast-docs', path);
  }
  assert.equal(observedRisk(['docs/records.md'], () => '```json\n{"key":"value"}\n```\n').kind, 'fast-docs');
});

test('documentation does not hide executable files, instructions, protected locations or code fences', () => {
  for (const path of ['src/persistence.js', '.github/workflows/check.yml', '.github/README.md', '.github.yml', 'migrations.sql', 'security/README.md', 'docs/security/policy.md']) {
    assert.equal(observedRisk([path], () => design).kind, 'deep', path);
  }
  for (const path of ['README.js', 'docs/design/SKILL.md', 'docs/design/AGENTS.md', 'docs/design/AGENTS.override.md', 'docs/design/CLAUDE.md', 'docs/design/REVIEW.md']) {
    assert.notEqual(observedRisk([path], () => design).kind, 'fast-docs', path);
  }
  for (const language of ['js', 'javascript', 'sh', 'bash', 'python', 'yaml']) {
    for (const fence of ['```', '~~~']) {
      assert.notEqual(observedRisk([designPath], () => `${fence}${language}\nexecute()\n${fence}\n`).kind, 'fast-docs', `${fence}${language}`);
    }
  }
  for (const prose of ['Execute the deployment now.', '- You must dispatch the worker.', 'Never run the cleanup script.']) {
    assert.notEqual(observedRisk([designPath], () => prose).kind, 'fast-docs', prose);
  }
  assert.notEqual(observedRisk(['docs/runbook.md'], () => 'Operators must dispatch the worker.').kind, 'fast-docs');
  assert.equal(observedRisk([designPath, 'src/persistence.js'], () => design).kind, 'deep');
});

test('the same docs contract passes preflight and committed-scope verification, but later executable content fails', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'issueflow-design-scope-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-qb', 'main');
  git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('commit', '--allow-empty', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  const contract = docsContract(designPath);
  const planText = '## Files\n- `' + designPath + '`\n';
  assert.equal(contractPreflight(repo, contract, { planText }).ok, true, 'new design file');
  mkdirSync(dirname(join(repo, designPath)), { recursive: true });
  writeFileSync(join(repo, designPath), design);
  const facts = contractPreflight(repo, contract, { planText });
  assert.equal(facts.ok, true, facts.problems.join('; '));
  git('add', designPath); git('commit', '-qm', 'design');
  assert.equal(checkScope(repo, base, 'HEAD', contract).kind, 'fast-docs');
  writeFileSync(join(repo, designPath), design + '\n```bash\ndeploy production\n```\n');
  assert.equal(contractPreflight(repo, contract, { planText }).ok, false);
  git('add', designPath); git('commit', '-qm', 'operational instructions');
  assert.throws(() => checkScope(repo, base, 'HEAD', contract), /docs checks cannot authorize behavioral work/);
});
