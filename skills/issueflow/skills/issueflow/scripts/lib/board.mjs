/**
 * The pick-table, and the detail signal behind its last column.
 *
 * The column deliberately does NOT estimate size. Nothing readable from issue
 * prose knows how much work an issue is — an issue that says "port the admin CMS
 * to the new stack" in five lines is weeks of work, and every text heuristic
 * calls it small. A column that says `S` there is not a weak signal, it is a
 * wrong answer wearing a confident label.
 *
 * What the text CAN answer is how much of the work the issue actually
 * specifies. That is worth a column on its own terms — a thin issue under a
 * broad title is precisely the one that comes back from the design stage as
 * several work items — and it is true rather than merely useful.
 *
 * Every column is derived from the issue payload only — nothing is computed
 * against "now" — so the same issues render the same bytes tomorrow. A relative
 * age column would make this table impossible to freeze.
 */

const CHECKLIST = /^\s*[-*]\s*\[[ xX]\]/gm;
const HEADING = /^#{1,6}\s+\S/gm;
const CROSSREF = /(^|\s)#\d+\b/g;
const BROAD_LABEL = /^(epic|large|xl|feature|refactor|redesign|migration|phase)$/i;

const count = (text, re) => (text.match(re) ?? []).length;

/**
 * How much of the work this issue actually specifies.
 *
 * Character count, not line count: issue prose is soft-wrapped, so a real issue
 * this was developed against is three "lines" and 461 characters. Counting
 * newlines reads every wrapped paragraph as a one-liner.
 */
export function detailOf(issue) {
  const body = issue.body ?? '';
  const labels = (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name ?? ''));
  const signals = {
    chars: body.trim().length,
    checklist: count(body, CHECKLIST),
    headings: count(body, HEADING),
    crossrefs: count(body, CROSSREF),
    broadLabel: labels.some((l) => BROAD_LABEL.test(l)),
  };
  const score =
    (signals.chars >= 1500 ? 2 : signals.chars >= 600 ? 1 : 0) +
    (signals.checklist >= 5 ? 2 : signals.checklist >= 2 ? 1 : 0) +
    (signals.headings >= 3 ? 1 : 0) +
    (signals.crossrefs >= 3 ? 1 : 0);
  return { ...signals, score, detail: score >= 4 ? 'full' : score >= 2 ? 'some' : 'thin' };
}

const truncate = (text, max) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

const labelNames = (issue) =>
  (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name ?? '')).filter(Boolean).join(', ');

/**
 * One row per open issue, in the order `gh` returned them (most recent activity
 * first).
 *
 * `thin !` marks a broad label over a thin body — the combination that most
 * often comes back from the design stage as several work items. It is a flag on
 * two facts, not an estimate.
 */
export function issueRows(issues) {
  return issues.map((issue) => {
    const { detail, broadLabel } = detailOf(issue);
    return [
      String(issue.number),
      truncate(issue.title, 52),
      truncate(labelNames(issue), 24) || '—',
      String(Array.isArray(issue.comments) ? issue.comments.length : (issue.comments ?? 0)),
      String(issue.updatedAt ?? '').slice(0, 10) || '—',
      broadLabel && detail === 'thin' ? 'thin !' : detail,
    ];
  });
}

export const ISSUE_COLUMNS = ['#', 'Issue', 'Labels', 'Comments', 'Updated', 'Detail'];
export const BOARD_COLUMNS = ['Step', 'Model', 'State', 'Gate'];

/** One row per gate step, from `run.board()`. */
export const boardRows = (rows) => rows.map((r) => [r.step, r.model, r.state, r.gate]);
