#!/usr/bin/env node
// Refresh the shipflow rendered-workflow baseline from this monorepo's live
// dogfood state. Run this ONLY when a template or config change is intentional:
//
//   node evals/baseline/update.mjs
//
// It re-copies the repo's `.github/shipflow.json` and the workflow that shipflow
// rendered from it. It deliberately does NOT re-render the golden itself from the
// template — copying the LIVE file is what keeps the fixture tied to reality. If
// you changed the template, run `shipflow apply` on the repo FIRST so the live
// workflow and renderedTemplateHashes are current, then run this.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(HERE, '..', '..');
const REPO_ROOT = resolve(SKILL_ROOT, '..', '..', '..', '..');

// GitHub-flow cutover evidence is a separate real read-only audit. Never replace
// the historical promotion input/output pair with this repository's new policy.
const config = JSON.parse(readFileSync(join(REPO_ROOT, '.github/shipflow.json')));
if (config.workflowPattern === 'github-flow') {
  const arg = process.argv.indexOf('--audit');
  if (arg === -1 || !process.argv[arg + 1]) {
    throw new Error('Run tools/github_flow_cutover.py audit first, then update.mjs --audit <file>. Historical dev/main goldens are retained.');
  }
  const audit = JSON.parse(readFileSync(process.argv[arg + 1]));
  if (audit.schema !== 1 || audit.repository !== 'natejswenson/claude-skills' || !audit.evidenceHash
      || !audit.branches.main || !audit.components.length) throw new Error('incomplete real audit');
  const workflow = readFileSync(join(REPO_ROOT, '.github/workflows/main-automerge.yml'));
  const recorded = {
    schema: 1, phase: 'pre-cutover-read-only', repository: audit.repository,
    capturedAt: audit.capturedAt, sourceAuditHash: audit.evidenceHash,
    branches: audit.branches, uniqueDevCommits: audit.uniqueDevCommits,
    openPRs: audit.openPRs.map(p => ({ number: p.number, base: p.base.ref, head: p.head.ref })),
    pendingReminderCount: audit.pendingReminders.length,
    components: audit.components, settings: audit.settings,
    requiredChecks: audit.protection.main.required_status_checks.contexts,
    rulesetCount: audit.rulesets.length, activeRunCount: audit.activeRuns.length,
    renderedWorkflowHash: createHash('sha256').update(workflow).digest('hex'),
    execution: 'not performed; requires merged code and separate authorization',
  };
  writeFileSync(join(HERE, 'github-flow-cutover.json'), JSON.stringify(recorded, null, 2) + '\n');
  console.log('Recorded real cutover audit projection; historical dev/main goldens unchanged.');
  process.exit(0);
}

const PAIRS = [
  [join(REPO_ROOT, '.github', 'shipflow.json'), join(HERE, 'dogfood-shipflow.json')],
  [
    join(REPO_ROOT, '.github', 'workflows', 'dev-to-main-automerge.yml'),
    join(HERE, 'dogfood-dev-to-main-automerge.yml'),
  ],
];

mkdirSync(HERE, { recursive: true });
for (const [src, dest] of PAIRS) {
  if (!existsSync(src)) {
    console.error(`missing source: ${src}`);
    process.exit(1);
  }
  copyFileSync(src, dest);
  console.log(`updated ${dest.replace(SKILL_ROOT + '/', '')}`);
}
console.log('\nBaseline refreshed. Re-run `npm test` to confirm it is consistent.');
