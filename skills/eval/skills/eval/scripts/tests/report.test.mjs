import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../lib/report.mjs';

const clause = (id, text) => ({ id, tag: 'skill', text, severity: 'high', source: { file: 'SKILL.md', line: 1 } });

const fixture = ({ judgment = [], unexamined = ['c-judged', 'c-nobody'] } = {}) => ({
  skill: 'widget',
  contract: {
    sources: ['SKILL.md'],
    clauses: [clause('c-probed', 'A clause a probe decided.'), clause('c-judged', 'A clause only judgment reached.'), clause('c-nobody', 'A clause nothing looked at.')],
  },
  trace: { events: [{ id: 'e1', line: 7 }] },
  probed: { findings: [], rejected: [], examined: ['c-probed'], unexamined },
  judgment,
});

const judged = [{ id: 'j-1', clauseId: 'c-judged', eventId: 'e1', severity: 'high', detail: 'it happened' }];

test('a clause a judgment finding cites is not also listed as unexamined', () => {
  // The defect this pins: `probed` only knows what the machine looked at, so a
  // judgment-cited clause printed in the gap table directly under the finding
  // built on it, and the gap sentence contradicted its own report.
  const md = renderReport(fixture({ judgment: judged }));
  const gap = md.slice(md.indexOf('## The clauses nobody examined'));
  assert.ok(!gap.includes('c-judged'), 'a clause judgment examined was still counted in the coverage gap');
  assert.ok(gap.includes('c-nobody'), 'the genuinely unexamined clause vanished from the gap');
  assert.match(gap, /^1 of 3 clauses had no probe and no judgment finding/m);
});

test('coverage counts judgment beside probes, and shows the split', () => {
  const md = renderReport(fixture({ judgment: judged }));
  assert.match(md, /clauses examined\s*\|\s*2 of 3 \(1 probe, 1 judgment\)/);
});

test('a clause both a probe and judgment reached is counted once', () => {
  // Counting the increment off `judgment` rather than off the unexamined list
  // would report 3 of 3 examined here, over a 3-clause contract with one
  // clause nobody touched.
  const md = renderReport(
    fixture({ judgment: [{ ...judged[0], clauseId: 'c-probed' }], unexamined: ['c-judged', 'c-nobody'] }),
  );
  assert.match(md, /clauses examined\s*\|\s*1 of 3\s*\|/, 'a doubly-examined clause inflated the coverage count');
});

test('a machine-only run renders exactly as it did before judgment existed', () => {
  // The frozen baseline is byte-compared against a run with no --judgment, so
  // the judgment split must be absent, not zero-valued.
  const md = renderReport(fixture());
  assert.match(md, /clauses examined\s*\|\s*1 of 3\s*\|/);
  assert.ok(!md.includes('probe, 0 judgment'), 'an empty judgment set leaked a split into the report');
  assert.match(md, /^2 of 3 clauses had no probe and no judgment finding/m);
});
