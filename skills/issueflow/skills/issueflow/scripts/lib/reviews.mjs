/**
 * The red team, declared once — the reviewer contract, the finding shape,
 * and the registrar that turns a review on disk into a verdict the gate can
 * read.
 *
 * Since 0.7.0 the red team attacks the PLAN, before any code is written: the
 * root cause, the approach, the rejected alternatives, the files, the proof
 * and the work items. Code is reviewed on the pull request, by the review
 * loop in `prreview.mjs`, where a finding can sit on the line it is about.
 * Attacking the same code twice — once on disk, once on GitHub — was the
 * round multiplier that made 0.6.0 slow.
 *
 * Reviews are deliberately NOT an entry in `STAGES`: a review is not a step
 * the run owes, it is a gate mechanism. Modelling it as a stage would put
 * "review" rows on every board and a review artifact in every corpus that
 * pins `files.length === STAGES.length`.
 *
 * The registrar is what makes a red-team verdict real: a review only counts
 * once `registerReview` has validated its findings, resolved every citation
 * against something that exists, derived the verdict from the severities, and
 * bound it to the sha of the artifact it read. `accept` trusts nothing but
 * that persisted, hash-bound record.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { PLAN_STAGE } from './stages.mjs';
import { RunError, artifactPath, hasSection, saveRun, sha256OfFile } from './run.mjs';

/**
 * Three blocked rounds is the ceiling. The house's adversarial doc reviews
 * converged in 7–10 rounds over whole designs; a single plan that a red team
 * has refused three times is not converging, it is oscillating — and an
 * autonomous loop that keeps paying for oscillation is the failure mode a
 * cap exists to name. On exhaustion the run stops and surfaces the open
 * findings; it never skips, never forces, never approves over them.
 */
export const MAX_ROUNDS = 3;

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];

/**
 * What blocks. Medium and low are notes — recorded, surfaced, never a reason
 * to send a stage back. A red team allowed to block on nitpicks is a loop
 * that never converges, and a loop that never converges teaches the operator
 * to turn the red team off.
 */
export const BLOCKING = ['critical', 'high'];

/**
 * The one reviewer, on opus: the red team is the judgment the run pays for —
 * a reviewer on a cheaper model than the stage it reviews is a gate that
 * rubber-stamps. Same field shape as `STAGES` so the corpus baseline freezes
 * it the same way.
 */
export const REVIEWS = [
  {
    id: 'investigate',
    title: 'Review: Investigate',
    model: 'opus',
    agent: 'general-purpose',
    asks: [
      'Open every `path:line` the plan cites and check the code says what the',
      'artifact claims it says. A citation that does not support its claim is a',
      'finding at the severity of the claim.',
      'Hunt for an alternate root cause the artifact never ruled out. If you can',
      'name one it did not consider, that is a finding.',
      'Hunt for guesses dressed as findings: any claim presented as established',
      'that belongs in Unknowns.',
      'Check the "does the issue ask for the right fix" question was actually',
      'answered, not restated.',
      'Hunt for files the change must touch that the Files section misses — open',
      'the code and trace the call sites yourself.',
      'Check the Proof maps to the behaviour the issue reports, not merely to the',
      'code being changed. A proof that would pass without fixing the issue is a',
      'critical finding.',
      'Check the Rejected alternative is real. A strawman nobody would have built',
      'is a plan with no rejected alternative.',
      'If there are Work items, attack the split before the items: `Why split:`',
      'must name a size or a layer a reviewer needs apart, and the Files section',
      'must bear it out. Several small independent fixes split into lanes is a',
      'high finding — each lane costs a pull request and a review loop, and one',
      'pull request with one commit per fix is the honest shape. Then check each',
      'item is reviewable and mergeable ALONE, and that the landing order is',
      'buildable.',
    ],
  },
];

export const review = (id) => REVIEWS.find((r) => r.id === id) ?? null;

/** Only the plan is red-teamed on disk; code is reviewed on its pull request. */
export const reviewable = (step) => step.stage.id === PLAN_STAGE;

/**
 * What every reviewer is forbidden, verbatim in every review brief. Each line
 * is a way a red team stops being a gate.
 */
export const REVIEW_FORBIDS =
  'Never edit the work or any file other than your own review — a reviewer that fixes ' +
  'what it found has destroyed the gate it was sent to hold. Never move the checkout: no ' +
  'checkout, merge, pull, fetch or fast-forward of the repository you were handed — if a ' +
  'citation does not resolve at the commit the plan names, read that commit with ' +
  '`git show <sha>:<path>` or a throwaway worktree, and say so in notExamined; a reviewer ' +
  'that moved the tree has changed what the next stage builds on. Never file a finding without a ' +
  'citation that resolves; an uncited finding is an opinion, and the registrar refuses the ' +
  'whole review over it. Each round re-hunts the current work from scratch — never weaken a ' +
  'finding to make a round converge, and never re-file a resolved one from memory. Never ' +
  'inflate severity: medium and low are notes, and a note filed as high to force a round is ' +
  'the reviewer gaming its own gate.';

const keyOf = (step) => step.key.replace('/', '-');

/**
 * The reviewer's findings for round `n`, and the verdict the registrar writes
 * beside them. JSON since 0.7.0: the one-line grammar it replaced refused a
 * whole review over a backtick around a citation, twice in twenty-four real
 * rounds — a parser that fails a review on punctuation is a parser that
 * teaches the reviewer to write less.
 */
export const reviewPath = (dir, step, round) => join(dir, 'reviews', `${keyOf(step)}-r${round}.findings.json`);
export const verdictPath = (dir, step, round) => join(dir, 'reviews', `${keyOf(step)}-r${round}.verdict.json`);
export const reviewBriefPath = (dir, step, round) => join(dir, 'briefs', `review-${keyOf(step)}-r${round}.md`);
export const reviewProgressPath = (dir, step, round) => join(dir, 'progress', `review-${keyOf(step)}-r${round}.log`);

/** The round the next review of this step would be — one past what is registered. */
export const nextRound = (step) => (step.stage.review?.rounds.length ?? 0) + 1;

/** The most recent registered round, or null before any review has run. */
export const latestRound = (step) => step.stage.review?.rounds.at(-1) ?? null;

/** True when the cap is spent: MAX_ROUNDS reviews registered and the last one still blocked. */
export const roundsExhausted = (step) => {
  const rounds = step.stage.review?.rounds ?? [];
  if (rounds.length < MAX_ROUNDS || rounds.at(-1)?.verdict !== 'blocked') return false;
  // A recorded user override for the next round re-opens the stage — the cap
  // stops the autonomous loop, not the person it works for.
  const overrides = step.stage.review?.overrides ?? [];
  return !overrides.some((o) => o.round === rounds.length + 1);
};

/**
 * Parse and validate the reviewer's JSON. Strict on purpose — a finding with
 * no severity, no citation or no text refuses the whole review, because a
 * finding that silently fails to validate is a finding that silently stops
 * existing. What it is NOT strict about is punctuation: a citation wrapped in
 * backticks is a citation.
 */
export function parseFindings(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { error: `is not valid JSON (${String(err.message).split('\n')[0]})` };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'must be a JSON object' };
  if (!Array.isArray(data.findings)) return { error: 'has no `findings` array' };
  const findings = [];
  for (const [i, f] of data.findings.entries()) {
    const where = `findings[${i}]`;
    if (!f || typeof f !== 'object') return { error: `${where} is not an object` };
    if (!SEVERITIES.includes(f.severity)) return { error: `${where}.severity must be one of ${SEVERITIES.join('|')}` };
    if (typeof f.cite !== 'string' || !f.cite.trim()) return { error: `${where}.cite is missing — a finding that cites nothing is an opinion` };
    if (typeof f.text !== 'string' || !f.text.trim()) return { error: `${where}.text is missing` };
    findings.push({ severity: f.severity, cite: f.cite.trim().replace(/^`+|`+$/g, ''), text: f.text.trim() });
  }
  const notExamined = Array.isArray(data.notExamined)
    ? data.notExamined.map((s) => String(s).trim()).filter(Boolean)
    : typeof data.notExamined === 'string' && data.notExamined.trim()
      ? [data.notExamined.trim()]
      : null;
  if (notExamined === null) return { error: 'has no `notExamined` list — a review names what nobody looked at' };
  const verdict = typeof data.verdict === 'string' ? data.verdict.trim().toLowerCase() : null;
  if (verdict !== 'pass' && verdict !== 'blocked') return { error: '`verdict` must be "pass" or "blocked"' };
  return { findings, notExamined, verdict };
}

/**
 * Resolve one citation against what exists, or return the reason it does not.
 *
 * Two forms, each deterministically checkable:
 *   `path:line` / `path:l1-l2` — the file exists under one of `roots` and the
 *     line is within it;
 *   `<file>.md § <Heading>` — the heading exists in the reviewed artifact.
 *
 * `strict` is the only mode: one unresolvable citation refuses the whole
 * review. A red team whose findings cannot be checked is a red team whose
 * findings cannot be trusted — the eval skill's rule, adopted as code.
 */
export function resolveCitation(cite, { roots = [], artifactText = '' } = {}) {
  const heading = /^\S+\.md\s+§\s+(.+)$/.exec(cite);
  if (heading) {
    return hasSection(artifactText, heading[1].trim())
      ? { ok: true }
      : { ok: false, reason: `no "${heading[1].trim()}" heading in the reviewed artifact` };
  }

  const loc = /^(.+?):(\d+)(?:-(\d+))?$/.exec(cite);
  if (loc) {
    const [, path, l1] = loc;
    for (const root of roots) {
      const full = isAbsolute(path) ? path : join(root, path);
      if (!existsSync(full) || !statSync(full).isFile()) continue;
      const total = readFileSync(full, 'utf8').split('\n').length;
      return Number(l1) <= total
        ? { ok: true }
        : { ok: false, reason: `${path} has ${total} lines, cited line ${l1}` };
    }
    return { ok: false, reason: `${path} not found under ${roots.length} search roots` };
  }

  return { ok: false, reason: 'not a `path:line` or `<file>.md § Heading` citation' };
}

const countsOf = (findings) => {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
};

/** Blocking findings decide; the declared verdict only gets to agree. */
export const deriveVerdict = (findings) =>
  findings.some((f) => BLOCKING.includes(f.severity)) ? 'blocked' : 'pass';

/**
 * Register a completed review: validate it, derive its verdict, bind it to the
 * artifact it read, and record the round on the run.
 *
 * Everything here refuses rather than repairs. The registrar never edits a
 * review to make it registrable, for the same reason the orchestrator never
 * edits an artifact to get it past `accept` — the refusal is the product.
 */
/** Record that round `round`'s reviewer has been briefed — the clock `next` waits against. */
export function markReviewBriefed(dir, run, step, round, now = () => new Date().toISOString()) {
  step.stage.review.briefed = { round, at: now() };
  saveRun(dir, run);
  return run;
}

export function registerReview(dir, run, step, { now = () => new Date().toISOString() } = {}) {
  if (!reviewable(step)) {
    throw new RunError(`cannot review ${step.key}: only the plan is red-teamed on disk — code is reviewed on its pull request`);
  }
  if (step.stage.state === 'approved' || step.stage.state === 'skipped') {
    throw new RunError(`cannot review ${step.key}: the stage is already ${step.stage.state}`);
  }
  const artifact = artifactPath(dir, step);
  if (!existsSync(artifact) || readFileSync(artifact, 'utf8').trim().length === 0) {
    throw new RunError(`cannot review ${step.key}: no artifact at ${artifact} — there is nothing to review`);
  }

  const round = nextRound(step);
  const file = reviewPath(dir, step, round);
  if (!existsSync(file) || readFileSync(file, 'utf8').trim().length === 0) {
    throw new RunError(`cannot register round ${round} of ${step.key}: no review at ${file}`);
  }

  // A review written before the artifact's last change reviewed different
  // bytes; binding its verdict to the current sha would launder a stale pass.
  if (statSync(file).mtimeMs < statSync(artifact).mtimeMs) {
    throw new RunError(
      `cannot register round ${round} of ${step.key}: the artifact changed after the review was written — ` +
        're-brief the reviewer on the current artifact',
    );
  }
  const parsed = parseFindings(readFileSync(file, 'utf8'));
  if (parsed.error) {
    throw new RunError(`cannot register the review of ${step.key}: ${file} ${parsed.error}`);
  }
  const { findings, notExamined, verdict: declared } = parsed;

  if (findings.length === 0 && notExamined.length === 0) {
    throw new RunError(
      `cannot register the review of ${step.key}: zero findings and an empty notExamined list — ` +
        '"clean" without naming what nobody looked at is indistinguishable from "unreviewed"',
    );
  }

  const artifactText = readFileSync(artifact, 'utf8');
  const roots = [run.repo.path, join(dir, step.laneSlug ?? 'shared')];
  for (const f of findings) {
    const resolved = resolveCitation(f.cite, { roots, artifactText });
    if (!resolved.ok) {
      throw new RunError(
        `cannot register the review of ${step.key}: the citation "${f.cite}" does not resolve ` +
          `(${resolved.reason}). A finding that cites nothing is an opinion — fix the review, not the gate.`,
      );
    }
  }

  const derived = deriveVerdict(findings);
  if (declared !== derived) {
    throw new RunError(
      `cannot register the review of ${step.key}: the review declares ${declared} but its own findings ` +
        `derive ${derived} — the severities decide, and a review that disagrees with itself registers nothing`,
    );
  }

  const counts = countsOf(findings);
  const verdict = {
    step: step.key,
    round,
    verdict: derived,
    findings: counts,
    artifactSha: sha256OfFile(artifact),
    review: `reviews/${keyOf(step)}-r${round}.findings.json`,
  };
  // No timestamps in this file: round timing lives on the run entry, which the
  // baseline strips — a timestamp here would make every frozen verdict churn.
  writeFileSync(verdictPath(dir, step, round), `${JSON.stringify(verdict, null, 2)}\n`);

  // `at` lives on the run entry only — the verdict file stays timestamp-free.
  step.stage.review.rounds.push({ ...verdict, items: findings, notExamined, at: now() });
  step.stage.review.feedback = derived === 'blocked' ? verdict.review : null;
  saveRun(dir, run);

  return { ...verdict, items: findings, notExamined };
}
