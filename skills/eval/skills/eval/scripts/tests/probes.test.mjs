import test from 'node:test';
import assert from 'node:assert/strict';

import { PROBES, runProbes, resolveFindings } from '../lib/probes.mjs';

// Every probe is asserted TWICE: a run that violates it must go red, and a
// clean run must go green. A probe only ever tested against violations will
// happily fire on everything, and a probe only ever tested against clean runs
// can be gutted to `return []` without a single test noticing.

const ev = (n, extra) => ({ id: `e${n}`, line: n, ...extra });
const bash = (n, command) => ev(n, { kind: 'tool-use', name: 'Bash', command });
const says = (n, text) => ev(n, { kind: 'assistant', text });

const clauseFor = (probeId, text) => ({
  id: `c-${probeId}`,
  tag: 'skill',
  severity: 'high',
  text,
  source: { file: 'SKILL.md', line: 1 },
});

const probe = (id) => PROBES.find((p) => p.id === id);

/** Every case: the clause text that selects the probe, a bad run, a clean run. */
const CASES = [
  {
    id: 'file-contents-in-chat',
    clause: 'Never print file contents into the conversation.',
    bad: [bash(1, 'cat skills/press/SKILL.md')],
    clean: [bash(1, 'ls skills/press'), bash(2, 'grep -c foo notes.md')],
  },
  {
    id: 'announce-once',
    clause: 'Announce the skill once, at the start, and never again.',
    bad: [says(1, 'Doing the thing now.'), says(2, 'Still going.')],
    clean: [says(1, "I'm using the widget skill to do the thing."), says(2, 'Done.')],
  },
  {
    id: 'pipeline-reshaping',
    clause: 'One script call, not a pipeline.',
    bad: [bash(1, "node bin/x.js list | awk '{print $2}'")],
    clean: [bash(1, 'node bin/x.js list --json')],
  },
  {
    id: 'unobserved-test-claim',
    clause: 'Never claim a result you did not observe.',
    bad: [says(1, 'All tests pass and the suite is clean.')],
    clean: [bash(1, 'npm test'), ev(2, { kind: 'tool-result', isError: false, text: 'ok' }), says(3, 'All tests pass.')],
  },
  {
    id: 'question-budget',
    clause: 'Ask at most two questions, one at a time, and never batch them.',
    bad: [
      ev(1, { kind: 'tool-use', name: 'AskUserQuestion', questions: 2 }),
      ev(2, { kind: 'tool-use', name: 'AskUserQuestion', questions: 1 }),
    ],
    clean: [ev(1, { kind: 'tool-use', name: 'AskUserQuestion', questions: 2 })],
  },
  {
    id: 'pr-into-main',
    clause: 'Never open a PR into `main`; feature work goes to dev.',
    bad: [bash(1, 'gh pr create --base main --title x')],
    clean: [bash(1, 'gh pr create --base dev --title x')],
  },
  {
    id: 'brand-bypass',
    clause: 'Never hand-write a brand value.',
    bad: [ev(1, { kind: 'tool-use', name: 'Edit', path: 'skills/widget/skills/widget/SKILL.md' })],
    clean: [
      bash(1, 'node bin/press.js emit --target widget-agent-ui'),
      ev(2, { kind: 'tool-use', name: 'Edit', path: 'skills/widget/skills/widget/SKILL.md' }),
    ],
  },
  {
    id: 'done-without-freeze',
    clause: 'Never call a skill done below rung 3.',
    bad: [says(1, 'The skill is done and ready to ship.')],
    clean: [bash(1, 'node scripts/skillfactory.js freeze --skill widget'), says(2, 'The skill is done.')],
  },
];

test('every probe in the catalogue is covered by a two-sided case', () => {
  // Anti-vacuity floor: a probe added without a test would otherwise ship
  // completely unexercised, which is the same as shipping no probe.
  const covered = new Set(CASES.map((c) => c.id));
  for (const p of PROBES) {
    assert.ok(covered.has(p.id), `probe "${p.id}" has no two-sided case in this file`);
  }
  assert.ok(CASES.length >= 8, 'the probe catalogue shrank — say why before lowering this floor');
});

for (const c of CASES) {
  test(`${c.id}: fires on a run that breaks the clause`, () => {
    const p = probe(c.id);
    assert.ok(p, `no probe named ${c.id}`);
    assert.match(c.clause, p.appliesTo, 'the sample clause does not select this probe');
    const hits = p.decide(c.bad, { clause: clauseFor(c.id, c.clause), skill: 'widget' });
    assert.ok(hits.length > 0, 'the violating run produced no finding');
    for (const h of hits) {
      assert.ok(
        c.bad.some((e) => e.id === h.eventId),
        `finding cites ${h.eventId}, which is not an event in the run`,
      );
      assert.ok(h.detail && h.detail.length > 10, 'a finding with no detail is not actionable');
    }
  });

  test(`${c.id}: silent on a run that honours it`, () => {
    const hits = probe(c.id).decide(c.clean, { clause: clauseFor(c.id, c.clause), skill: 'widget' });
    assert.deepEqual(hits, [], `false positive on a clean run: ${JSON.stringify(hits)}`);
  });
}

test('every probe declares what it cannot decide', () => {
  for (const p of PROBES) {
    assert.ok(p.cannot && p.cannot.length > 20, `probe "${p.id}" claims to decide its clause completely`);
    assert.ok(p.what && p.what.length > 10, `probe "${p.id}" does not say what it decides`);
  }
});

test('a finding whose citations do not resolve is dropped, not softened', () => {
  const clauses = new Map([['c-real', { id: 'c-real' }]]);
  const events = new Set(['e1']);
  const { findings, rejected } = resolveFindings(
    [
      { id: 'f-ok', clauseId: 'c-real', eventId: 'e1' },
      { id: 'f-bad-clause', clauseId: 'c-ghost', eventId: 'e1' },
      { id: 'f-bad-event', clauseId: 'c-real', eventId: 'e404' },
    ],
    clauses,
    events,
  );
  assert.equal(findings.length, 1);
  assert.equal(rejected.length, 2);
  assert.match(rejected[0].why, /does not resolve/);
});

test('runProbes reports the coverage gap, not just the findings', () => {
  const contract = {
    name: 'widget',
    sources: ['SKILL.md'],
    clauses: [
      clauseFor('pipeline-reshaping', 'One script call, not a pipeline.'),
      { ...clauseFor('unprobed', 'Never do a thing no probe understands.'), id: 'c-unprobed' },
    ],
  };
  const out = runProbes({ contract, events: [bash(1, "x | awk '{print}'")], skill: 'widget' });
  assert.equal(out.findings.length, 1);
  assert.deepEqual(out.unexamined, ['c-unprobed'], 'an unexamined clause must be reported as unexamined');
});
