/**
 * Regressions from the 2026-08-03 accuracy audit.
 *
 * Each test here pins a defect that was measured against real session
 * transcripts, not imagined: eval scored 85.7% precision overall but 14% at
 * `high` severity, and its worst probe was wrong on 6 of 6 real firings.
 *
 * These live in their own file on purpose. `skillfactory freeze` regenerates
 * `baseline.test.mjs`, so a hand-written guard placed there is deleted the next
 * time the golden is refreshed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractContract } from '../lib/contract.mjs';
import { PROBES, runProbes, resolveFindings } from '../lib/probes.mjs';
import { buildProbeReport, coverageOf } from '../lib/report.mjs';

function fakeRepo(skillMd) {
  const root = mkdtempSync(join(tmpdir(), 'eval-regress-'));
  const dir = join(root, 'skills', 'widget', 'skills', 'widget');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), skillMd);
  return root;
}

const ev = (n, extra) => ({ id: `e${n}`, line: n, ...extra });
const bash = (n, command) => ev(n, { kind: 'tool-use', name: 'Bash', command });
const probe = (id) => PROBES.find((p) => p.id === id);
const clauseFor = (text, id = 'c-1', severity = 'high') => ({
  id,
  tag: 'skill',
  severity,
  text,
  source: { file: 'SKILL.md', line: 1 },
});

// --- 1. contract: bold-pair parity ----------------------------------------

test('a short bold span does not swallow the rule that follows it', () => {
  // `**Auth**` has a 4-character inner, so under /\*\*([\s\S]{5,400}?)\*\*/g it
  // cannot close on its own delimiter. The opener ran on to the NEXT `**`, and
  // from there the extractor captured the prose BETWEEN rules instead of the
  // rules — measured live: ghostwriter's contract lost "Never print or commit
  // secrets." and admitted the sentence after it at severity high.
  const repo = fakeRepo(`# widget

Set up **Auth** in the console.

- **Never print or commit secrets.** \`.env\` is gitignored; keep it that way. Don't echo them.
- **Never fabricate a detail to clear this bar.**
`);
  const texts = extractContract(repo, 'widget').clauses.map((c) => c.text);

  assert.ok(
    texts.includes('Never print or commit secrets.'),
    `the guardrail after a short bold span was dropped: ${JSON.stringify(texts)}`,
  );
  assert.ok(
    texts.includes('Never fabricate a detail to clear this bar.'),
    'a second rule past the desync was dropped',
  );
  assert.ok(
    !texts.some((t) => t.includes('is gitignored')),
    `gap text between two rules was graded as a rule: ${JSON.stringify(texts)}`,
  );
  assert.ok(!texts.some((t) => t.includes('Auth**')), 'a half-open bold span leaked into a clause');
});

// --- 2. pr-into-main ------------------------------------------------------

test('the mandated dev to main promotion is not a violation', () => {
  // Measured: every one of this probe's 6 real firings was the promotion
  // CLAUDE.md step 3 commands. It read --base and never --head, so the repo's
  // own release procedure was reported as breaking the repo's own rule.
  const hits = probe('pr-into-main').decide([bash(1, 'gh pr create --base main --head dev --title promote')], {
    clause: clauseFor('Never PR a feature branch straight into `main`.'),
    skill: 'widget',
  });
  assert.deepEqual(hits, [], `flagged the sanctioned dev to main promotion: ${JSON.stringify(hits)}`);
});

test('a feature branch PRed into main is still caught', () => {
  const hits = probe('pr-into-main').decide([bash(1, 'gh pr create --base main --head feature/x')], {
    clause: clauseFor('Never PR a feature branch straight into `main`.'),
    skill: 'widget',
  });
  assert.equal(hits.length, 1, 'the real violation stopped firing — the exemption is too wide');
});

test('a refspec push and a retargeted PR reach main too', () => {
  const ctx = { clause: clauseFor('Never push directly to `main`.'), skill: 'widget' };
  assert.equal(probe('pr-into-main').decide([bash(1, 'git push origin dev:main')], ctx).length, 1, 'refspec push to main missed');
  assert.equal(probe('pr-into-main').decide([bash(1, 'gh pr edit 12 --base main')], ctx).length, 1, 'PR retargeted onto main missed');
});

// --- 3. clause fan-out ----------------------------------------------------

test('one violating event yields one finding, not one per bound clause', () => {
  // `decide` ran once per bound clause, so a single act produced a finding for
  // every clause the probe matched — and the second one cited "Never push
  // directly to main" for an event that is not a push.
  const contract = {
    name: 'widget',
    sources: ['SKILL.md'],
    clauses: [
      clauseFor('Never PR a feature branch straight into `main`.', 'c-pr'),
      clauseFor('Never push directly to `main`.', 'c-push'),
    ],
  };
  const out = runProbes({ contract, events: [bash(1, 'gh pr create --base main --head feature/x')], skill: 'widget' });
  assert.equal(out.findings.length, 1, `one act produced ${out.findings.length} findings`);
  assert.equal(out.findings[0].clauseId, 'c-pr', 'the finding cited a clause the event cannot break');
});

test('a probe that binds no clause is reported, not silently skipped', () => {
  // `question-budget` binds 0 of the 12 shipped contracts. A probe that finds
  // nothing to attach to leaves no trace in any output today, so the report
  // reads clean over a rule it never located.
  const contract = { name: 'widget', sources: ['SKILL.md'], clauses: [clauseFor('Never push directly to `main`.', 'c-push')] };
  const out = runProbes({ contract, events: [], skill: 'widget' });
  assert.ok(Array.isArray(out.unbound), 'runProbes does not report which probes bound nothing');
  assert.ok(out.unbound.includes('question-budget'), `a probe that bound nothing went unreported: ${JSON.stringify(out.unbound)}`);
  assert.ok(!out.unbound.includes('pr-into-main'), 'a probe that did bind was reported as unbound');
});

// --- 4. probe.json coverage ----------------------------------------------

test('probe.json pairs its finding count with the same gap report.md prints', () => {
  // The 0.2.1 fix taught report.md and the CLI to count judgment coverage, but
  // buildProbeReport still read probe-only numbers — so the machine-readable
  // artifact shipped a finding count beside a gap that ignored those findings.
  const contract = {
    name: 'widget',
    sources: ['SKILL.md'],
    clauses: [clauseFor('a', 'c-probed'), clauseFor('b', 'c-judged'), clauseFor('c', 'c-nobody')],
  };
  const probed = { findings: [], rejected: [], examined: ['c-probed'], unexamined: ['c-judged', 'c-nobody'], unbound: [] };
  const judgment = [{ id: 'j-1', clauseId: 'c-judged', eventId: 'e1', severity: 'high', detail: 'x' }];

  const built = buildProbeReport({ contract, trace: { events: [{ id: 'e1' }] }, probed, skill: 'widget', judgment });
  const cov = coverageOf({ probed, judgment });

  assert.equal(built.coverage.examined, cov.examined, 'probe.json disagrees with the coverage math report.md uses');
  assert.equal(built.coverage.unexamined, cov.gap, 'probe.json reported a gap that ignores its own judgment findings');
});

// --- 5. judgment findings are rejected, never swallowed --------------------

test('judgment findings with a missing or duplicate id are rejected and counted', () => {
  // `if (seen.has(f.id)) continue` was built for content-addressed probe ids.
  // Applied to caller-supplied judgment, two findings with no id collapsed into
  // one and the loss was reported nowhere — `Supplied 2 | resolve 1 | Rejected 0`.
  const clauses = new Map([['c-real', { id: 'c-real' }]]);
  const events = new Set(['e1']);
  const { findings, rejected } = resolveFindings(
    [
      { clauseId: 'c-real', eventId: 'e1', severity: 'high', detail: 'first' },
      { clauseId: 'c-real', eventId: 'e1', severity: 'critical', detail: 'second, different finding' },
    ],
    clauses,
    events,
    { strict: true },
  );
  assert.equal(findings.length, 0, 'an id-less judgment finding was accepted');
  assert.equal(rejected.length, 2, `a supplied finding vanished without being counted: ${JSON.stringify(rejected)}`);
  assert.match(rejected[0].why, /id/);
});

test('a judgment finding with an unrecognised severity is rejected', () => {
  const { findings, rejected } = resolveFindings(
    [{ id: 'j-1', clauseId: 'c-real', eventId: 'e1', severity: 'catastrophic-nonsense', detail: 'x' }],
    new Map([['c-real', { id: 'c-real' }]]),
    new Set(['e1']),
    { strict: true },
  );
  assert.equal(findings.length, 0, 'an unranked severity sorts last and silently understates a finding');
  assert.match(rejected[0].why, /severity/);
});

test('probe-internal dedupe still collapses a genuinely identical finding', () => {
  // Non-strict callers keep today's behaviour: probe ids are content-addressed,
  // so a repeat really is the same fact and dropping it is correct.
  const { findings, rejected } = resolveFindings(
    [
      { id: 'f-same', clauseId: 'c-real', eventId: 'e1', severity: 'high' },
      { id: 'f-same', clauseId: 'c-real', eventId: 'e1', severity: 'high' },
    ],
    new Map([['c-real', { id: 'c-real' }]]),
    new Set(['e1']),
  );
  assert.equal(findings.length, 1);
  assert.equal(rejected.length, 0);
});
