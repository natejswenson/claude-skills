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

/**
 * Every magnitude signal below is a tier, not a threshold, and the reason is a
 * real run.
 *
 * On 2026-08-05 a release-heavy week ranked twelve items at *exactly* 70 —
 * `release+50 minor+10 corroborated+10` and nothing else — so the line between
 * what reached the report and what did not was drawn by a timestamp tiebreak.
 * Every session in that window scored exactly 32 for the same reason: `edits>=20`
 * and `turns>=60` are thresholds that top out, so a twenty-edit session and a
 * two-hundred-edit session were indistinguishable, and no session reached the
 * report at all.
 *
 * A threshold answers "did this clear a bar". Ranking needs "how much", so these
 * keep climbing.
 */
const tier = (n, steps) => {
  let bonus = 0;
  for (const [floor, points] of steps) if (n >= floor) bonus = points;
  return bonus;
};

// Deliberately capped below `major`'s +20: a pull request count measures how
// finely work was split as much as how much of it there was, so a well-squashed
// breaking release must never be out-ranked by a fragmented routine one.
const BACKING_TIERS = [[1, 4], [2, 7], [3, 10], [6, 13], [12, 16]];
const NOTES_TIERS = [[200, 3], [1000, 6], [2500, 9]];
const EDIT_TIERS = [[1, 1], [5, 3], [20, 6], [50, 9], [100, 12]];
const TURN_TIERS = [[60, 4], [150, 7], [300, 10]];
// There is deliberately no duration signal. A digest's start and end bound the
// wall-clock span of the transcript, not the work in it — real sessions span
// thirty hours across two days — so it saturates immediately and ranks sitting
// still above shipping. Edits and turns are the magnitude; elapsed time is not.

/** `feat(press): …` → `press`. The scope is how a release finds its own work. */
export const scopeOf = (title) => {
  const m = /^(?:feat|fix|perf|refactor|docs|test|chore|build|ci|style|revert)(?:\(([^)]*)\))?!?:/i.exec(String(title ?? ''));
  return m?.[1]?.trim().toLowerCase() || null;
};

/**
 * How much in-window work stands behind a release.
 *
 * `corroborated+10` is cross-source evidence — a session happened in a directory
 * named like this repo — and it fires identically for a release backed by fifteen
 * pull requests and one backed by none. That is a yes/no fact, and a ranking
 * needs a quantity, so this is a separate signal rather than a rewrite of it.
 *
 * A component tag (`press-v0.9.0`) counts only the work scoped to that component,
 * which is what stops every skill in a monorepo from claiming the same backing.
 * A repo-level tag (`v0.50.0`) counts the whole repo, because that is what it
 * released.
 */
export function backingCount(item, ctx) {
  const repo = ctx.backing.get(item.repo);
  if (!repo) return 0;
  const component = item.kind === 'release' ? (parseTag(item.tag)?.component ?? '') : '';
  if (component && repo.byScope.has(component)) return repo.byScope.get(component);
  if (component) return 0;
  return repo.total;
}

/**
 * A component's first release is news in a way its fourth minor is not, and it
 * scored identically until now.
 *
 * Both conditions are required. "Nothing earlier in the corpus" alone would call
 * any release first once it fell off the back of the year-long backfill; an
 * initial version number alone would be fooled by a repo that re-cut 0.1.0.
 */
export function isFirstRelease(item, ctx) {
  const p = parseTag(item.tag);
  if (!p) return false;
  const initial = (p.major === 0 && p.minor === 1 && p.patch === 0)
    || (p.major === 1 && p.minor === 0 && p.patch === 0);
  if (!initial) return false;
  const earliest = ctx.firstSeen.get(`${item.repo}::${p.component}`);
  return !earliest || earliest >= item.at;
}

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
    if (isFirstRelease(item, ctx)) { score += 12; signals.push('first+12'); }

    const backed = backingCount(item, ctx);
    const backedBonus = tier(backed, BACKING_TIERS);
    if (backedBonus) { score += backedBonus; signals.push(`backed×${backed}+${backedBonus}`); }

    // The changelog is the only measure of a release's size the corpus holds.
    // Zero here means "no body cached", which a corpus indexed before bodies
    // were cached will report for everything — see `index --full`.
    const notes = tier(String(item.body ?? '').length, NOTES_TIERS);
    if (notes) { score += notes; signals.push(`notes+${notes}`); }
  }

  if (item.kind === 'session') {
    const editBonus = tier(item.edits ?? 0, EDIT_TIERS);
    if (editBonus) { score += editBonus; signals.push(`edits×${item.edits}+${editBonus}`); }
    const turnBonus = tier(item.assistantTurns ?? 0, TURN_TIERS);
    if (turnBonus) { score += turnBonus; signals.push(`turns×${item.assistantTurns}+${turnBonus}`); }
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
export const repoOwner = (repo) => String(repo ?? '').split('/')[0] || null;

/**
 * A release of somebody else's project is not your shipped work.
 *
 * Releases are fetched for every repo the user touched, so a single drive-by
 * contribution imports that project's whole release history. One docs pull
 * request to an external repo pulled eleven of its releases into a three-month
 * window and ranked one of them seventh.
 *
 * The receipts gate cannot catch this: the release is real, so the citation
 * resolves. The one rule stops fabrication, not misattribution — which is why
 * this is a separate filter and not a stricter receipt.
 *
 * Pull requests and commits in an external repo are kept. Contributing to
 * someone else's project IS your work; releasing it is not.
 */
export function dropForeignReleases(items, owners) {
  if (!owners || owners.size === 0) return { kept: items, foreign: [] };
  const kept = [];
  const foreign = [];
  for (const it of items) {
    if (it.kind === 'release' && !owners.has(repoOwner(it.repo))) foreign.push(it);
    else kept.push(it);
  }
  return { kept, foreign };
}

/**
 * How much work backs each repo in the window, and when each component was first
 * seen releasing. `history` is the WHOLE corpus, not the window — "is this the
 * first release" is a question the window cannot answer.
 */
export function buildContext(kept, history = []) {
  const backing = new Map();
  for (const it of kept) {
    if (it.kind !== 'pr' && it.kind !== 'commit') continue;
    if (!backing.has(it.repo)) backing.set(it.repo, { total: 0, byScope: new Map() });
    const b = backing.get(it.repo);
    b.total += 1;
    const scope = scopeOf(it.title);
    if (scope) b.byScope.set(scope, (b.byScope.get(scope) ?? 0) + 1);
  }

  const firstSeen = new Map();
  for (const it of history) {
    if (it.kind !== 'release' || !it.at) continue;
    const p = parseTag(it.tag);
    if (!p) continue;
    const key = `${it.repo}::${p.component}`;
    const prev = firstSeen.get(key);
    if (!prev || it.at < prev) firstSeen.set(key, it.at);
  }

  return { backing, firstSeen };
}

export function rankItems(items, { top = 12, floor = 20, owners = null, history = null } = {}) {
  const { kept: owned, foreign } = dropForeignReleases(items, owners);
  const series = collapseReleaseSeries(owned);
  const collapsed = owned.filter((i) => i.kind === 'release').length - series.filter((i) => i.kind === 'release').length;
  const { kept, folded } = foldSquashCommits(series);
  const shippedRepos = [...new Set(kept.filter((i) => i.kind === 'pr' || i.kind === 'release').map((i) => i.repo))];
  const sessionProjects = new Set(kept.filter((i) => i.kind === 'session').map((i) => i.project));
  const ctx = { shippedRepos, sessionProjects, ...buildContext(kept, history ?? items) };

  const scored = kept.map((i) => ({ ...i, ...scoreItem(i, ctx) }))
    .sort((a, b) => b.score - a.score || String(a.at).localeCompare(String(b.at)) || a.id.localeCompare(b.id));

  let placed = 0;
  for (const it of scored) {
    it.above = it.score >= floor && placed < top;
    if (it.above) placed += 1;
  }
  const above = scored.filter((i) => i.above);
  return { ranked: scored, folded, collapsed, foreign, above, top, floor, tie: tieAtTheLine(scored, above) };
}

/**
 * Whether the line was drawn by the ranking or by a tiebreak.
 *
 * When the last item above the line and the first item below it share a score,
 * the cut is arbitrary — the sort falls through to timestamp and then to id, and
 * neither is a reason one piece of work reached the report and another did not.
 *
 * This used to be prose asking the agent to notice a table of identical numbers.
 * It is the deterministic half's job: `rank` draws the line, so `rank` is what
 * has to say when the line means nothing.
 */
export function tieAtTheLine(scored, above) {
  if (above.length === 0 || above.length === scored.length) return null;
  const last = above[above.length - 1];
  const next = scored[above.length];
  if (!next || next.score !== last.score) return null;
  const shared = scored.filter((i) => i.score === last.score);
  return {
    score: last.score,
    count: shared.length,
    included: shared.filter((i) => i.above).length,
    excluded: shared.filter((i) => !i.above).length,
  };
}
