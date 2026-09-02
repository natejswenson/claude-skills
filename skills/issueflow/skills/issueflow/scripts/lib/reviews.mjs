/**
 * The red team, declared once — the reviewer contracts, the finding grammar,
 * and the registrar that turns a review on disk into a verdict the gate can
 * read.
 *
 * Reviews are deliberately NOT a fifth entry in `STAGES`: a review is not a
 * step the run owes, it is a gate mechanism `auto` mode swaps in for the
 * human. Modelling it as a stage would put "review" rows on every board and a
 * fifth artifact in every corpus that pins `files.length === STAGES.length`.
 *
 * The registrar is what makes a red-team verdict real: a review only counts
 * once `registerReview` has parsed its findings, resolved every citation
 * against something that exists, derived the verdict from the severities, and
 * bound it to the sha of the artifact it read. `accept --auto` trusts nothing
 * but that persisted, hash-bound record.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { PER_ITEM_STAGES } from './stages.mjs';
import { RunError, artifactPath, hasSection, saveRun, sha256OfFile, worktreePath } from './run.mjs';

/**
 * Three blocked rounds is the ceiling. The house's adversarial doc reviews
 * converged in 7–10 rounds over whole designs; a single stage artifact that a
 * red team has refused three times is not converging, it is oscillating — and
 * an autonomous loop that keeps paying for oscillation is the failure mode a
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

/** The one line a finding is allowed to be. Anything else refuses the review. */
const FINDING_LINE = /^\s*[-*]\s+\[(critical|high|medium|low)\]\s+(\S(?:.*?\S)?)\s+—\s+(\S.*)$/;

/**
 * The four reviewers, one per stage. Same field shape as `STAGES` so the
 * corpus baseline freezes them the same way. All four run on opus: the red
 * team is the judgment the run is paying for — a reviewer on a cheaper model
 * than the stage it reviews is a gate that rubber-stamps.
 */
export const REVIEWS = [
  {
    id: 'investigate',
    title: 'Review: Investigate',
    model: 'opus',
    agent: 'general-purpose',
    asks: [
      'Open every `path:line` the investigation cites and check the code says what',
      'the artifact claims it says. A citation that does not support its claim is a',
      'finding at the severity of the claim.',
      'Hunt for an alternate root cause the artifact never ruled out. If you can',
      'name one it did not consider, that is a finding.',
      'Hunt for guesses dressed as findings: any claim presented as established',
      'that belongs in Unknowns.',
      'Check the "does the issue ask for the right fix" question was actually',
      'answered, not restated.',
    ],
  },
  {
    id: 'design',
    title: 'Review: Design',
    model: 'opus',
    agent: 'general-purpose',
    asks: [
      'Hunt for files the change must touch that the Files table misses — open the',
      'code and trace the call sites yourself.',
      'Check the Proof maps to the behaviour the issue reports, not merely to the',
      'code being changed. A proof that would pass without fixing the issue is a',
      'critical finding.',
      'Check the Rejected alternative is real. A strawman nobody would have built',
      'is a design with no rejected alternative.',
      'If there are Work items, check each one is reviewable and mergeable ALONE,',
      'and that the landing order is buildable.',
      'Check nothing here contradicts the approved investigation. A design that',
      'quietly re-decides the root cause is revisiting a decision it inherited.',
    ],
  },
  {
    id: 'implement',
    title: 'Review: Implement',
    model: 'opus',
    agent: 'general-purpose',
    asks: [
      'Review the DIFF, not the report. Run the diff command named in your working',
      'context and read every hunk; `implement.md` is the stage\'s account of',
      'itself, and the diff is what actually happened.',
      'Hunt for changes beyond the approved design — a file touched that the design',
      'never names, behaviour added that no ask covers.',
      'Hunt for design items silently dropped that the Deviations section does not',
      'confess.',
      'Hunt for bugs in the diff itself: broken edge cases, inverted conditions,',
      'resources left open, errors swallowed.',
      'Check the commits stage explicit paths — a `git add -A`-shaped commit may',
      'have swept in another session\'s work.',
      'Idiom mismatches with the surrounding code are findings at medium, never',
      'higher — they are notes for a human, not a reason to loop.',
    ],
  },
  {
    id: 'test',
    title: 'Review: Test',
    model: 'opus',
    agent: 'general-purpose',
    asks: [
      'Read the evidence file against the artifact\'s claims. A summary line that',
      'disagrees with what the artifact reports is a critical finding.',
      'Check the red run was a real red: an assertion watched failing on its own',
      'claim. A load or import error reported as the red side is a critical',
      'finding — it proves the file broke, not that the assertion bites.',
      'Hunt for assertions that would pass against the pre-fix code — read the diff',
      'the implement stage landed and ask what each assertion would do without it.',
      'Check the test proves what the design\'s Proof section promised, phrased so',
      'a reader can tell it maps to the issue.',
    ],
  },
];

export const review = (id) => REVIEWS.find((r) => r.id === id) ?? null;

/** Every review artifact must carry these, checked like `accept` checks stages. */
export const REVIEW_REQUIRES = ['Findings', 'Not examined', 'Verdict'];

/**
 * What every reviewer is forbidden, verbatim in every review brief. Each line
 * is a way a red team stops being a gate.
 */
export const REVIEW_FORBIDS =
  'Never edit the work or any file other than your own review artifact — a reviewer ' +
  'that fixes what it found has destroyed the gate it was sent to hold. Never file a ' +
  'finding without a citation that resolves; an uncited finding is an opinion, and the ' +
  'registrar refuses the whole review over it. Each round re-hunts the current work ' +
  'from scratch — never weaken a finding to make a round converge, and never re-file a ' +
  'resolved one from memory. Never inflate severity: medium and low are notes, and a ' +
  'note filed as high to force a round is the reviewer gaming its own gate.';

const keyOf = (step) => step.key.replace('/', '-');

/** The reviewer's artifact for round `n`, and the verdict the registrar writes beside it. */
export const reviewPath = (dir, step, round) => join(dir, 'reviews', `${keyOf(step)}-r${round}.md`);
export const verdictPath = (dir, step, round) => join(dir, 'reviews', `${keyOf(step)}-r${round}.json`);
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

/** The body of one `## <name>` section, or null when the heading is absent. */
function sectionBody(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^\\s{0,3}#{1,6}\\s+${escaped}\\s*$`, 'im').exec(text);
  if (!heading) return null;
  const rest = text.slice(heading.index + heading[0].length);
  const end = /^\s{0,3}#{1,6}\s+/m.exec(rest);
  return (end ? rest.slice(0, end.index) : rest).trim();
}

/**
 * Parse the `## Findings` section. Strict on purpose: a list line that does
 * not match the declared shape refuses the whole review, because a finding
 * that silently fails to parse is a finding that silently stops existing.
 */
export function parseFindings(text) {
  const body = sectionBody(text, 'Findings');
  if (body === null) return { findings: null, malformed: [] };
  const findings = [];
  const malformed = [];
  for (const line of body.split('\n')) {
    if (!/^\s*[-*]\s+/.test(line)) continue;
    const m = FINDING_LINE.exec(line);
    if (m) findings.push({ severity: m[1], cite: m[2], text: m[3].trim() });
    else malformed.push(line.trim());
  }
  return { findings, malformed };
}

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** The commit a code review is bound to, so a later commit invalidates the verdict. */
export function headOf(workdir) {
  try {
    return git(['rev-parse', 'HEAD'], workdir);
  } catch {
    return null;
  }
}

/**
 * Resolve one citation against what exists, or return the reason it does not.
 *
 * Three forms, each deterministically checkable:
 *   `path:line` / `path:l1-l2` — the file exists under one of `roots` and the
 *     line is within it;
 *   `<file>.md § <Heading>` — the heading exists in the reviewed artifact;
 *   `diff:<path>` — the path appears in the lane's diff over its base.
 *
 * `strict` is the only mode: one unresolvable citation refuses the whole
 * review. A red team whose findings cannot be checked is a red team whose
 * findings cannot be trusted — the eval skill's rule, adopted as code.
 */
export function resolveCitation(cite, { roots = [], artifactText = '', diffFiles = null } = {}) {
  const heading = /^\S+\.md\s+§\s+(.+)$/.exec(cite);
  if (heading) {
    return hasSection(artifactText, heading[1].trim())
      ? { ok: true }
      : { ok: false, reason: `no "${heading[1].trim()}" heading in the reviewed artifact` };
  }

  const diff = /^diff:(.+)$/.exec(cite);
  if (diff) {
    const path = diff[1].trim();
    if (diffFiles === null) return { ok: false, reason: 'diff: citations only resolve for a stage with a branch' };
    return diffFiles.includes(path) ? { ok: true } : { ok: false, reason: `${path} is not in this lane's diff` };
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

  return { ok: false, reason: 'not a `path:line`, `<file>.md § Heading`, or `diff:<path>` citation' };
}

/** The files a lane's branch changed over its base — the universe `diff:` cites into. */
export function diffFiles(workdir, base) {
  try {
    const out = git(['diff', '--name-only', `${base}...HEAD`], workdir);
    return out ? out.split('\n').filter(Boolean) : [];
  } catch {
    return null;
  }
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
export function registerReview(dir, run, step, { workdir = null } = {}) {
  if (step.stage.state === 'approved' || step.stage.state === 'skipped') {
    throw new RunError(`cannot review ${step.key}: the stage is already ${step.stage.state}`);
  }
  const artifact = artifactPath(dir, step);
  if (!existsSync(artifact) || readFileSync(artifact, 'utf8').trim().length === 0) {
    throw new RunError(`cannot review ${step.key}: no artifact at ${artifact} — there is nothing to review`);
  }

  const round = nextRound(step);
  const reviewMd = reviewPath(dir, step, round);
  if (!existsSync(reviewMd) || readFileSync(reviewMd, 'utf8').trim().length === 0) {
    throw new RunError(`cannot register round ${round} of ${step.key}: no review at ${reviewMd}`);
  }
  const text = readFileSync(reviewMd, 'utf8');

  const missing = REVIEW_REQUIRES.filter((section) => !hasSection(text, section));
  if (missing.length > 0) {
    throw new RunError(
      `cannot register the review of ${step.key}: it has no ${missing.join(' section, no ')} section — ` +
        `a review owes a heading for each of ${REVIEW_REQUIRES.join(', ')}`,
    );
  }

  const { findings, malformed } = parseFindings(text);
  if (malformed.length > 0) {
    throw new RunError(
      `cannot register the review of ${step.key}: ${malformed.length} finding ` +
        `line${malformed.length === 1 ? ' does' : 's do'} not match ` +
        '`- [severity] <citation> — <finding>`. First: ' + JSON.stringify(malformed[0]),
    );
  }

  if (findings.length === 0) {
    const notExamined = sectionBody(text, 'Not examined') ?? '';
    if (notExamined.length === 0) {
      throw new RunError(
        `cannot register the review of ${step.key}: zero findings and an empty "Not examined" section — ` +
          '"clean" without naming what nobody looked at is indistinguishable from "unreviewed"',
      );
    }
  }

  const artifactText = readFileSync(artifact, 'utf8');
  const isCodeStage = PER_ITEM_STAGES.includes(step.stage.id);
  const tree = workdir ?? (step.lane && existsSync(worktreePath(dir, step.lane)) ? worktreePath(dir, step.lane) : run.repo.path);
  const changed = isCodeStage && step.lane ? diffFiles(tree, step.lane.base) : null;
  const roots = [tree, run.repo.path, join(dir, step.laneSlug ?? 'shared')];

  for (const f of findings) {
    const resolved = resolveCitation(f.cite, { roots, artifactText, diffFiles: changed });
    if (!resolved.ok) {
      throw new RunError(
        `cannot register the review of ${step.key}: the citation "${f.cite}" does not resolve ` +
          `(${resolved.reason}). A finding that cites nothing is an opinion — fix the review, not the gate.`,
      );
    }
  }

  const derived = deriveVerdict(findings);
  const declaredBody = (sectionBody(text, 'Verdict') ?? '').toLowerCase();
  const declared = /\bblocked\b/.test(declaredBody) ? 'blocked' : /\bpass\b/.test(declaredBody) ? 'pass' : null;
  if (declared === null) {
    throw new RunError(`cannot register the review of ${step.key}: the Verdict section names neither pass nor blocked`);
  }
  if (declared !== derived) {
    throw new RunError(
      `cannot register the review of ${step.key}: the review declares ${declared} but its own findings ` +
        `derive ${derived} — the severities decide, and a review that disagrees with itself registers nothing`,
    );
  }

  let head = null;
  if (isCodeStage) {
    head = headOf(tree);
    if (!head) {
      throw new RunError(
        `cannot register the review of ${step.key}: no commit to bind it to in ${tree} — ` +
          'a code review that names no commit cannot say which code it reviewed',
      );
    }
  }

  const counts = countsOf(findings);
  const verdict = {
    step: step.key,
    round,
    verdict: derived,
    findings: counts,
    artifactSha: sha256OfFile(artifact),
    head,
    review: `reviews/${keyOf(step)}-r${round}.md`,
  };
  // No timestamps in this file: round timing lives on the run entry, which the
  // baseline strips — a timestamp here would make every frozen verdict churn.
  writeFileSync(verdictPath(dir, step, round), `${JSON.stringify(verdict, null, 2)}\n`);

  step.stage.review.rounds.push({ ...verdict, items: findings });
  step.stage.review.feedback = derived === 'blocked' ? verdict.review : null;
  saveRun(dir, run);

  return { ...verdict, items: findings };
}
