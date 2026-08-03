/**
 * The report — findings, and the honest size of what nobody looked at.
 *
 * The single most misleading thing an eval can do is list what it found and
 * stop. A reader converts "3 findings" into "3 problems exist", when the true
 * statement is "3 problems exist among the clauses something actually checked".
 * So every report here carries its coverage gap in the same breath as its
 * findings, and names, per applicable probe, the part of each clause that was
 * handed to judgment rather than decided.
 *
 * Nothing in here is time-stamped. A report that embeds the clock cannot be
 * byte-compared, and a baseline that cannot be byte-compared is a fixture
 * somebody edits until it goes green.
 */
import { SEVERITY_ORDER } from './contract.mjs';
import { PROBES } from './probes.mjs';

export const table = (headers, rows) => {
  if (rows.length === 0) return '';
  const cells = rows.map((r) => r.map((c) => String(c ?? '')));
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((r) => (r[i] ?? '').length)));
  const line = (r) => `| ${r.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' | ')} |`;
  return [line(headers), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...cells.map(line)].join('\n');
};

const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const bySeverity = (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);

/**
 * Coverage is probe coverage PLUS whatever judgment cited.
 *
 * `probed` only knows what the machine looked at, so a clause a judgment
 * finding is built on stays in `probed.unexamined` — which prints it in the gap
 * table directly underneath the finding that examined it, and makes the gap
 * sentence ("no probe and no judgment finding") false about its own report.
 *
 * The increment is counted off the unexamined list rather than off `judgment`,
 * so a clause both a probe and a judgment finding touched is not counted twice.
 * Lives here, exported, because the CLI prints the same numbers to the terminal
 * and two copies of this arithmetic is how one of them goes stale.
 */
export function coverageOf({ probed, judgment = [] }) {
  const judged = new Set(judgment.map((f) => f.clauseId));
  const judgmentExamined = probed.unexamined.filter((id) => judged.has(id));
  const gapIds = probed.unexamined.filter((id) => !judged.has(id));
  return {
    probeExamined: probed.examined.length,
    judgmentExamined: judgmentExamined.length,
    examined: probed.examined.length + judgmentExamined.length,
    gapIds,
    gap: gapIds.length,
  };
}

/** The findings a run produced, as the machine decided them. */
export function buildProbeReport({ contract, trace, probed, skill, judgment = [] }) {
  const applicable = PROBES.filter((p) => contract.clauses.some((c) => p.appliesTo.test(c.text)));
  return {
    $comment:
      'Machine-decided findings only. Every finding cites one clause id that exists in the contract and one event id that exists in the trace; anything that failed to resolve is in `rejected`, never softened into a maybe.',
    skill,
    contract: { sources: contract.sources, clauses: contract.clauses.length },
    trace: { events: trace.events.length },
    coverage: {
      examined: probed.examined.length,
      unexamined: probed.unexamined.length,
      probesApplied: applicable.map((p) => p.id).sort(),
    },
    findings: probed.findings,
    rejected: probed.rejected,
    judgment,
    handedToJudgment: applicable
      .map((p) => ({ probe: p.id, cannot: p.cannot }))
      .sort((a, b) => (a.probe < b.probe ? -1 : 1)),
  };
}

/** The same facts, for a person. */
export function renderReport({ contract, trace, probed, skill, judgment = [] }) {
  const byId = new Map(contract.clauses.map((c) => [c.id, c]));
  const eventById = new Map(trace.events.map((e) => [e.id, e]));
  const all = [...probed.findings, ...judgment].sort(bySeverity);
  const applicable = PROBES.filter((p) => contract.clauses.some((c) => p.appliesTo.test(c.text)));

  const cov = coverageOf({ probed, judgment });
  // The split is shown only when there is one, so a machine-only run renders
  // exactly as it did before judgment existed.
  const examinedCell =
    cov.judgmentExamined > 0
      ? `${cov.examined} of ${contract.clauses.length} (${cov.probeExamined} probe, ${cov.judgmentExamined} judgment)`
      : `${cov.examined} of ${contract.clauses.length}`;

  const tally = all.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});

  const out = [];
  out.push(`# eval — ${skill}`);
  out.push('');
  out.push(
    table(
      ['Measure', 'Value'],
      [
        ['skill graded', skill],
        ['contract sources', contract.sources.join(', ')],
        ['clauses extracted', contract.clauses.length],
        ['clauses examined', examinedCell],
        ['trace events', trace.events.length],
        ['findings (machine)', probed.findings.length],
        ['findings (judgment)', judgment.length],
        ['citations rejected', probed.rejected.length],
      ],
    ),
  );
  out.push('');

  out.push('## Findings');
  out.push('');
  if (all.length === 0) {
    out.push('None. This is a statement about the clauses that were examined, not about the run.');
  } else {
    out.push(
      table(
        ['Severity', 'Finding', 'Clause', 'Event', 'What'],
        all.map((f) => [
          f.severity,
          f.id,
          `${f.clauseId} (${byId.get(f.clauseId)?.source.file ?? '?'}:${byId.get(f.clauseId)?.source.line ?? '?'})`,
          `${f.eventId} (line ${eventById.get(f.eventId)?.line ?? '?'})`,
          clip(f.detail, 110),
        ]),
      ),
    );
    out.push('');
    out.push(
      table(
        ['Severity', 'count'],
        Object.entries(tally)
          .sort((a, b) => (SEVERITY_ORDER[a[0]] ?? 9) - (SEVERITY_ORDER[b[0]] ?? 9))
          .map(([k, v]) => [k, v]),
      ),
    );
  }
  out.push('');

  out.push('## The clauses nobody examined');
  out.push('');
  out.push(
    `${cov.gap} of ${contract.clauses.length} clauses had no probe and no judgment finding. ` +
      'Their absence from Findings above means nothing was checked, not that nothing was wrong.',
  );
  out.push('');
  const gap = cov.gapIds.map((id) => byId.get(id)).filter(Boolean).sort(bySeverity);
  if (gap.length > 0) {
    out.push(
      table(
        ['Severity', 'Clause', 'Source', 'Text'],
        gap.map((c) => [c.severity, c.id, `${c.source.file}:${c.source.line}`, clip(c.text, 96)]),
      ),
    );
  }
  out.push('');

  out.push('## What the machine did not decide');
  out.push('');
  if (applicable.length === 0) {
    out.push('No probe applied to any clause in this contract.');
  } else {
    out.push(table(['Probe', 'Cannot decide'], applicable.map((p) => [p.id, clip(p.cannot, 150)])));
  }
  out.push('');
  return `${out.join('\n')}`;
}
