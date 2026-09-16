/** Explicit user-approved input replaces planning, never implementation evidence. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { contractFromPlan, hash, validateContract } from './contracts.mjs';
import { RunError, classifyIssue } from './run.mjs';
import { assertPreflight } from './preflight.mjs';
import { planningTree } from './execution.mjs';

const fail = message => { throw new RunError(`approved spec: ${message}`); };
const requiredText = (value, flag) => {
  if (typeof value !== 'string' || !value.trim()) fail(`${flag} requires a nonempty value`);
  return value;
};

export function readSpecSelection(args) {
  if (!args.approvedSpec) {
    if (args.specContract || args.specApproval) fail('--spec-contract and --spec-approval require --approved-spec');
    return null;
  }
  if (args.reviewPlan) fail('--approved-spec and --review-plan select different entry paths');
  const source = resolve(requiredText(args.approvedSpec, '--approved-spec'));
  const approval = requiredText(args.specApproval, '--spec-approval (existing user direction or review reference)');
  const bytes = readFileSync(source);
  const text = bytes.toString('utf8');
  if (!text.trim() || bytes.length > 1024 * 1024 || text.includes('\0') || !bytes.equals(Buffer.from(text))) fail('spec must be nonempty UTF-8 text, at most 1 MiB');
  if (args.specContract && /^```issueflow-contract\b/m.test(text)) fail('choose an embedded contract or --spec-contract, not both');
  const contract = args.specContract
    ? validateContract(JSON.parse(readFileSync(resolve(requiredText(args.specContract, '--spec-contract')), 'utf8')))
    : contractFromPlan(text);
  if (contract.lanes) fail('approved-spec entry supports one implementation lane; supply one bounded issue and contract');
  return { schema: 1, source, approval, text, sha256: hash(bytes), contract, contractHash: hash(contract) };
}

export function assertSameSpecSelection(run, selected) {
  if (!selected) return;
  const original = run.approvedSpec;
  if (!original || original.sha256 !== selected.sha256 || original.contractHash !== selected.contractHash || original.approval !== selected.approval) {
    fail('start cannot replace the accepted input of an existing run; retain its snapshot or use the reviewed amendment flow');
  }
}

export function selectApprovedSpec(run, selected) {
  if (!selected) return;
  run.approvedSpec = { ...selected, importedAt: new Date().toISOString() };
  // A thin issue must not hide the supplied specification's behavioral scope.
  const observed = classifyIssue({ title: run.issue.title, body: selected.text + '\n' + JSON.stringify(selected.contract) });
  const rounds = Math.max(run.complexity.reviewRounds, observed.reviewRounds,
    selected.contract.risk === 'sensitive' ? 4 : selected.contract.risk === 'standard' ? 2 : 1);
  if (rounds > run.complexity.reviewRounds) {
    run.complexity = { ...run.complexity, kind: rounds >= 4 ? 'deep' : 'standard', reviewRounds: rounds,
      reason: 'approved specification and execution contract scope' };
    for (const lane of run.lanes) lane.review.maxRounds = rounds;
  }
}

export function specEntryActive(run) {
  const input = run.approvedSpec;
  return Boolean(run.schema >= 5 && input?.schema === 1 && input.approval?.trim() &&
    hash(input.text) === input.sha256 && hash(input.contract) === input.contractHash &&
    run.stages.find(s => s.id === 'investigate')?.state === 'skipped' &&
    run.harness?.contractHash === input.contractHash && hash(run.harness?.contract) === input.contractHash &&
    !run.harness?.pendingAmendment);
}

export function specPath(dir) { return join(dir, 'inputs/approved-spec.md'); }

export function assertSpecInput(dir, run) {
  const input = run.approvedSpec;
  if (!input) return;
  if (input.schema !== 1 || !input.approval?.trim() || hash(input.text) !== input.sha256 || hash(input.contract) !== input.contractHash) fail('frozen input identity changed');
  validateContract(input.contract);
  const path = specPath(dir);
  if (existsSync(path)) {
    if (hash(readFileSync(path)) !== input.sha256) fail('frozen spec changed');
  } else if (run.initialization?.phase === 'active') fail('frozen spec is missing');
  if (run.stages.find(s => s.id === 'investigate')?.state === 'skipped' && !specEntryActive(run)) fail('accepted contract changed; use the reviewed amendment flow');
}

/** Retryable startup step. The original source is never read after selection. */
export function initializeApprovedSpec(dir, run) {
  const input = run.approvedSpec;
  if (!input) return;
  assertSpecInput(dir, run);
  mkdirSync(join(dir, 'inputs'), { recursive: true });
  if (!existsSync(specPath(dir))) writeFileSync(specPath(dir), input.text, { flag: 'wx' });
  run.preflight = assertPreflight(planningTree(dir, run), input.contract);
  run.harness.contract = structuredClone(input.contract);
  run.harness.contractHash = input.contractHash;
  const plan = run.stages.find(s => s.id === 'investigate');
  plan.state = 'skipped';
  plan.skipReason = 'User-approved spec supplied; planning and plan review skipped.';
  plan.at.skipped = input.importedAt;
}

export function specIntent(dir, run) {
  assertSpecInput(dir, run);
  return [
    '## Approved specification', '',
    `Read the frozen specification at \`${specPath(dir)}\` before making or reviewing changes.`,
    `Spec SHA-256: \`${run.approvedSpec.sha256}\`.`,
    'Planning and plan review were skipped under the recorded user approval; no in-run plan-review pass is claimed.',
    'Implement the supplied design and its criteria. Report unmet prerequisites or contradictions; use a reviewed amendment for changed scope.',
    '', 'Execution contract:', '```json', JSON.stringify(run.harness.contract, null, 2), '```',
  ].join('\n');
}
