/**
 * Scoring, and the line.
 *
 * The point of scoring in code rather than in the model is that the reason an
 * item did or did not reach the report is visible before any prose exists — so
 * an argument about the report is an argument about weights, not about taste.
 * `references/ranking.md` is the prose version of exactly this file.
 */

export const KIND_BASE = { release: 50, pr: 30, session: 10, commit: 6 };

const CONVENTIONAL = /^(feat|fix|perf|refactor|docs|test|chore|build|ci|style|revert)(\([^)]*\))?!?:/i;
const TYPE_BONUS = { feat: 12, fix: 8, perf: 8, revert: 6, refactor: 2, build: 1, ci: 1, docs: 1, test: 0, style: 0, chore: 0 };

const NOISE = [
  [/^merge (branch|pull request|remote)/i, 30, 'merge-commit'],
  [/^chore\(brand\): adopt press/i, 25, 'generated-commit'],
  [/^(bump|update) .* from .* to /i, 25, 'dependency-bump'],
  [/^release: /i, 0, null], // release PRs are not noise; they are corroboration, handled below
];

const SQUASH_REF = /\(#(\d+)\)\s*$/;

/**
 * A squash-merged PR appears twice — once as the PR and once as the squash
 * commit whose subject ends `(#123)`. Folding is not cosmetic: without it the
 * same piece of work outranks work that landed once.
 */
export function foldSquashCommits(items) {
  const prNumbers = new Set(items.filter((i) => i.kind === 'pr').map((i) => `${i.repo}#${i.number}`));
  const kept = [];
  const folded = [];
  for (const it of items) {
    if (it.kind === 'commit') {
      const m = SQUASH_REF.exec(it.title ?? '');
      if (m && prNumbers.has(`${it.repo}#${m[1]}`)) { folded.push(it); continue; }
    }
    kept.push(it);
  }
  return { kept, folded };
}

const TAG = /^(?:(.+)-)?v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

/** `shipflow-v0.3.2` → component shipflow, 0.3.2. `v0.40.0` → the repo itself. */
export function parseTag(tag) {
  const m = TAG.exec(String(tag ?? ''));
  if (!m) return null;
  return { component: m[1] ?? '', major: +m[2], minor: +m[3], patch: +m[4] };
}

const cmpVer = (a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch;

/**
 * Three patch releases of the same component in one window are one story, not
 * three. Collapsing them is mechanical — the model's judgment is for merging
 * *different* items, not for noticing that 0.3.0, 0.3.1 and 0.3.2 are a series.
 *
 * The collapsed releases are not discarded: they ride along as extra receipts,
 * so the claim "shipped three times this week" stays citable.
 */
export function collapseReleaseSeries(items) {
  const groups = new Map();
  const rest = [];
  for (const it of items) {
    const p = it.kind === 'release' ? parseTag(it.tag) : null;
    if (!p) { rest.push(it); continue; }
    const key = `${it.repo}::${p.component}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ it, p });
  }

  const collapsed = [];
  for (const entries of groups.values()) {
    entries.sort((a, b) => cmpVer(a.p, b.p));
    const first = entries[0];
    const last = entries[entries.length - 1];
    // With a predecessor in the window the bump is observed. With only one
    // release it has to be inferred from the version itself — otherwise a lone
    // 2.0.0, which is the biggest news a component can produce, scores as
    // though nothing about it were known.
    const bump = entries.length > 1
      ? (last.p.major > first.p.major ? 'major' : last.p.minor > first.p.minor ? 'minor' : 'patch')
      : (last.p.patch === 0 && last.p.minor === 0 && last.p.major > 0 ? 'major'
        : last.p.patch === 0 ? 'minor' : 'patch');
    collapsed.push({
      ...last.it,
      releaseCount: entries.length,
      bump,
      fromVersion: `${first.p.major}.${first.p.minor}.${first.p.patch}`,
      alsoReceipts: entries.slice(0, -1).map((e) => e.it.receipt),
    });
  }
  return [...collapsed, ...rest];
}

const BUMP_BONUS = { major: 20, minor: 10, patch: 2, single: 0 };

const projectMatchesRepo = (project, repo) => {
  if (!project || !repo) return false;
  return repo.split('/')[1] === project;
};

export function scoreItem(item, ctx) {
  const signals = [];
  let score = KIND_BASE[item.kind] ?? 0;
  signals.push(`${item.kind}+${KIND_BASE[item.kind] ?? 0}`);

  const title = item.title ?? '';

  const m = CONVENTIONAL.exec(title);
  if (m) {
    const t = m[1].toLowerCase();
    const bonus = TYPE_BONUS[t] ?? 0;
    if (bonus) { score += bonus; signals.push(`${t}+${bonus}`); }
  }

  for (const [re, penalty, label] of NOISE) {
    if (penalty && re.test(title)) { score -= penalty; signals.push(`${label}-${penalty}`); }
  }

  if (item.kind === 'release') {
    const bonus = BUMP_BONUS[item.bump] ?? 0;
    if (bonus) { score += bonus; signals.push(`${item.bump}+${bonus}`); }
    if ((item.releaseCount ?? 1) >= 3) { score += 6; signals.push(`x${item.releaseCount}+6`); }
  }

  if (item.kind === 'session') {
    if (item.edits >= 20) { score += 6; signals.push('heavy-edit+6'); }
    else if (item.edits >= 5) { score += 3; signals.push('edited+3'); }
    if (item.assistantTurns >= 60) { score += 4; signals.push('long+4'); }
    if (item.edits === 0 && item.userTurns < 4) { score -= 15; signals.push('lookaround-15'); }
    if ((item.skills ?? []).length) { score += 2; signals.push('skill-run+2'); }
    // A session whose project matches a repo that shipped in this window is
    // evidence from a second source, which is the strongest signal available.
    if (ctx.shippedRepos.some((r) => projectMatchesRepo(item.project, r))) {
      score += 10; signals.push('corroborated+10');
    }
  } else if (ctx.sessionProjects.size && ctx.sessionProjects.has(item.repo?.split('/')[1])) {
    score += 10; signals.push('corroborated+10');
  }

  return { score, signals };
}

/**
 * Rank everything in the window and draw the line. `top` and `floor` are both
 * caps: an item must beat the floor AND make the cut.
 */
export function rankItems(items, { top = 12, floor = 20 } = {}) {
  const series = collapseReleaseSeries(items);
  const collapsed = items.filter((i) => i.kind === 'release').length - series.filter((i) => i.kind === 'release').length;
  const { kept, folded } = foldSquashCommits(series);
  const shippedRepos = [...new Set(kept.filter((i) => i.kind === 'pr' || i.kind === 'release').map((i) => i.repo))];
  const sessionProjects = new Set(kept.filter((i) => i.kind === 'session').map((i) => i.project));
  const ctx = { shippedRepos, sessionProjects };

  const scored = kept.map((i) => ({ ...i, ...scoreItem(i, ctx) }))
    .sort((a, b) => b.score - a.score || String(a.at).localeCompare(String(b.at)) || a.id.localeCompare(b.id));

  let placed = 0;
  for (const it of scored) {
    it.above = it.score >= floor && placed < top;
    if (it.above) placed += 1;
  }
  return { ranked: scored, folded, collapsed, above: scored.filter((i) => i.above), top, floor };
}
