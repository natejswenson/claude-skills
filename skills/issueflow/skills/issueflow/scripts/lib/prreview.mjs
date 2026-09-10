import { activePath, readDelivery } from './execution.mjs';
/**
 * The pull request review loop — the deterministic half of it.
 *
 * A round is: finders write candidates, verifiers rule on them and on every
 * finding still open from earlier rounds, the registrar (this file) decides
 * what is real enough to post and where, one GitHub review goes up with one
 * thread per inline finding, prior threads are resolved or replied to, and a
 * fixer addresses what is open. The loop converges when no major is open.
 *
 * Everything that decides is here, as code: which line a finding may sit on,
 * whether a nit may post after round one, when a plausible finding on
 * untouched code is a note rather than a major, what "fixed" requires, how
 * many rounds there are. The reviewers judge; this file refuses.
 *
 * The finding ids are the loop's memory. An id is assigned once, at the
 * round a finding is first registered, and later rounds address it by id —
 * they never re-hash a reworded summary. That is what lets a thread be
 * resolved when its finding is fixed rather than a second thread opened.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HandBack, RunError, laneTree, saveRun } from './run.mjs';
import { GQL, graphql } from './gh.mjs';
import { dispatchProfile } from './runtime.mjs';

/**
 * Four rounds. A round costs two to five opus finders, up to eight opus
 * verifiers, a fix and a re-review; a pull request that still has an open
 * major after four of them is not converging on fixes, it is oscillating on
 * discovery, and the person the loop works for should see the open majors
 * rather than pay for a fifth.
 */
export const MAX_REVIEW_ROUNDS = 4;

/** What a verified finding may be rated. Only `major` blocks. */
export const SEVERITIES = ['major', 'nit', 'pre-existing'];

/** What a finder may propose. After round 1 only a proposed major reaches a verifier. */
export const PROPOSED_SEVERITIES = ['major', 'nit'];

/** How many nits a round may post inline. The rest are counted in the body. */
export const NIT_CAP = 5;

/** The hard cap on a finding's one-line claim. The brief asks for 60; a finder that writes 64 is not refused. */
export const SHORT_SUMMARY_CAP = 80;

/** Under this many changed lines, one finder carries every angle and two verifiers suffice. */
export const SMALL_DIFF_LINES = 60;

/** The angle catalogue, in the order finders are dealt them. Cleanup angles run in round 1 only. */
export const CORE_ANGLES = ['line-by-line', 'removed-behaviour', 'cross-file', 'intent', 'conventions', 'language-pitfalls'];
export const CLEANUP_ANGLES = ['reuse', 'simplification', 'efficiency', 'altitude'];

export const FINDER_MODEL = 'opus';
export const VERIFIER_MODEL = 'opus';

export const finderProfile = (run) => dispatchProfile(run, 'finder');
export const verifierProfile = (run) => dispatchProfile(run, 'verifier');

const VERDICTS_NEW = ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'];
const VERDICTS_PRIOR = ['fixed', 'still-open', 'withdrawn'];

// ---------------------------------------------------------------------------
// Where a round lives on disk.
// ---------------------------------------------------------------------------
export const reviewDir = (dir, lane, round) => activePath(dir, lane.slug, 'review', `r${round}`);
export const diffPath = (dir, lane, round) => join(reviewDir(dir, lane, round), 'diff.patch');
/** Round 2+: what the last fix changed, with context — the finders' primary read. */
export const fixPatchPath = (dir, lane, round) => join(reviewDir(dir, lane, round), 'fix.patch');
export const candidatesPath = (dir, lane, round, n) => join(reviewDir(dir, lane, round), `candidates-${n}.json`);
export const verdictsPath = (dir, lane, round, n) => join(reviewDir(dir, lane, round), `verdicts-${n}.json`);
export const registeredPath = (dir, lane, round) => join(reviewDir(dir, lane, round), 'registered.json');
export const payloadPath = (dir, lane, round) => join(reviewDir(dir, lane, round), 'review-payload.json');
export const fixReportPath = (dir, lane, round) => join(reviewDir(dir, lane, round), 'fix-report.json');
export const finderBriefPath = (dir, lane, round, n) => activePath(dir, 'briefs', `${lane.slug}-review-r${round}-finder-${n}.md`);
export const verifierBriefPath = (dir, lane, round, n) => activePath(dir, 'briefs', `${lane.slug}-review-r${round}-verifier-${n}.md`);
export const fixBriefPath = (dir, lane, round) => activePath(dir, 'briefs', `${lane.slug}-fix-r${round}.md`);

export const currentRound = (lane) => lane.review?.rounds.at(-1) ?? null;
export const nextReviewRound = (lane) => (lane.review?.rounds.length ?? 0) + 1;

/** True when the cap is spent: MAX_REVIEW_ROUNDS registered and the last still has an open major. */
export const reviewExhausted = (lane) => {
  const rounds = lane.review?.rounds ?? [];
  const last = rounds.at(-1);
  const cap = lane.review?.maxRounds ?? MAX_REVIEW_ROUNDS;
  return rounds.length >= cap && Boolean(last?.registered) && last.verdict !== 'converged';
};

/** The persisted lane cap, with the legacy four-round default for old runs. */
export const reviewCap = (lane) => lane.review?.maxRounds ?? MAX_REVIEW_ROUNDS;

/** Every finding still open on the lane, majors first. */
export const openFindings = (lane) =>
  (lane.review?.findings ?? []).filter((f) => f.status === 'open').sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));

export const openMajors = (lane) => openFindings(lane).filter((f) => f.severity === 'major');

/** A fixer that cannot clear the same major twice is not making progress. */
export const repeatedReviewMajors = (lane) => openMajors(lane).filter((f) => (f.stillOpenRounds ?? 0) >= 2);

/** Stable enough to compare hosted-check failures across review rounds. */
export const ciFailureFingerprint = (checks) => (checks ?? [])
  .filter((c) => c.bucket === 'fail')
  .map((c) => `${c.name ?? ''}|${c.detail ?? c.conclusion ?? c.status ?? ''}`.toLowerCase().replace(/\s+/g, ' ').trim())
  .sort().join('\n');

/**
 * Which model fixes this round. Sonnet when every open major is new; opus
 * the moment one is `still-open` — round 3 exists mostly because round 2's
 * fix did not fix, and repeating the model that already missed the mechanism
 * is the expensive branch.
 */
export const fixerProfile = (run, lane) => dispatchProfile(
  run,
  openMajors(lane).some((f) => f.stillOpenRounds > 0) ? 'fixerEscalated' : 'fixer',
);

/** Claude-compatible convenience retained for callers that only need the model string. */
export const fixerModel = (lane, run = null) => fixerProfile(run, lane).model;

const git = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  } catch (err) {
    throw new RunError(String(err.stderr ?? err.message ?? '').trim().split('\n')[0] || `git ${args[0]} failed`);
  }
};

export const headOf = (tree) => git(['rev-parse', 'HEAD'], tree).trim();

/** The ref the lane's diff is measured against: the remote copy of its base when there is one. */
export function baseRef(tree, base) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${base}`], { cwd: tree, stdio: 'ignore' });
    return `origin/${base}`;
  } catch {
    return base;
  }
}

/** The lane's whole diff over its base — three-dot, so a moved base does not bleed into it. */
export const laneDiff = (tree, base) => git(['diff', '--unified=3', `${baseRef(tree, base)}...HEAD`], tree);

/** The diff between two heads — what the last fix touched. No context: the registrar's `touched` rule reads it. */
export const deltaDiff = (tree, from, to) => git(['diff', '--unified=0', from, to], tree);

/** The same delta with three lines of context — what a round-2+ finder reads first. */
export const fixDiff = (tree, from, to) => git(['diff', '--unified=3', from, to], tree);

// ---------------------------------------------------------------------------
// Reading a unified diff. Enough of it to answer two questions: may a
// comment sit on this line, and how big is this change.
// ---------------------------------------------------------------------------

/**
 * Files and hunks out of a unified diff. Each hunk carries its old and new
 * ranges INCLUDING context lines — GitHub anchors a thread on any line
 * inside a hunk, context included, and a finding on the unchanged line just
 * below a removed guard is exactly the kind that must be inline.
 */
export function parseDiff(text) {
  const files = [];
  let file = null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      file = { path: header[2], oldPath: header[1], hunks: [], added: 0, deleted: 0, newLines: new Set(), oldLines: new Set() };
      files.push(file);
      continue;
    }
    if (!file) continue;
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      const h = {
        oldStart: Number(hunk[1]), oldLines: hunk[2] === undefined ? 1 : Number(hunk[2]),
        newStart: Number(hunk[3]), newLines: hunk[4] === undefined ? 1 : Number(hunk[4]),
      };
      file.hunks.push(h);
      // Walk the hunk body to record which exact lines were added or removed.
      let oldN = h.oldStart;
      let newN = h.newStart;
      for (i += 1; i < lines.length; i += 1) {
        const body = lines[i];
        if (body.startsWith('diff --git') || body.startsWith('@@')) { i -= 1; break; }
        if (body.startsWith('+') && !body.startsWith('+++')) { file.added += 1; file.newLines.add(newN); newN += 1; }
        else if (body.startsWith('-') && !body.startsWith('---')) { file.deleted += 1; file.oldLines.add(oldN); oldN += 1; }
        else if (body.startsWith('\\')) { /* no newline marker */ }
        else { oldN += 1; newN += 1; }
      }
    }
  }
  return files;
}

export const changedLines = (files) => files.reduce((n, f) => n + f.added + f.deleted, 0);

/** A converged code review can still require a fixer when CI is red. */
export function assertFixRequired(entry, checks, laneSlug = null) {
  if (entry.verdict === 'converged' && checks.length === 0) {
    const lane = laneSlug ? ` of ${laneSlug}` : '';
    throw new RunError(`round ${entry.round}${lane} converged and CI has no failing checks — there is nothing to fix; \`issueflow ready\``);
  }
}

/**
 * Size reviewer fanout by semantic review load, not generated/test bulk. Every
 * file remains in the brief and diff; this only prevents fixtures and indexes
 * from buying duplicate readers of the same small production change.
 */
export function semanticChangedLines(files) {
  return Math.ceil(files.reduce((n, f) => {
    const lines = f.added + f.deleted;
    if (/(^|\/)(evals\/baseline|scripts\/tests\/generated)\//.test(f.path)) return n;
    if (/^skills\/skillhelp\/skills\/skillhelp\/index\//.test(f.path)) return n;
    if (/(^|\/)(CHANGELOG\.md|package-lock\.json|MANIFEST\.json)$/.test(f.path)) return n;
    if (/(^|\/)(tests?|__tests__)\//.test(f.path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f.path)) return n + (lines * 0.25);
    return n + lines;
  }, 0));
}

export const riskSensitiveChange = (files) => files.some((f) =>
  /(^|\/)(\.github\/workflows|auth|security|migrations?|permissions?)(\/|$)/i.test(f.path)
  || /(^|\/)(package\.json|plugin\.json|skill-invariants\.json)$/.test(f.path));

/** May a thread sit on `path:line`? Inside any hunk's range on that side, context lines included. */
export function inlineEligible(files, path, line, side = 'RIGHT') {
  const file = files.find((f) => (side === 'LEFT' ? f.oldPath : f.path) === path);
  if (!file) return false;
  return file.hunks.some((h) => (side === 'LEFT'
    ? line >= h.oldStart && line < h.oldStart + Math.max(h.oldLines, 1)
    : line >= h.newStart && line < h.newStart + Math.max(h.newLines, 1)));
}

/** Was `path:line` (new side) added or changed by this diff? The discovery-oscillation rule reads this. */
export function touched(files, path, line) {
  const file = files.find((f) => f.path === path);
  return Boolean(file && file.newLines.has(line));
}

/** Is `path` byte-identical between two commits? A finding in such a file cannot have changed status. */
export function fileUnchanged(tree, from, to, path) {
  if (!from || !to || from === to) return from === to;
  try {
    const out = execFileSync('git', ['diff', '--name-only', from, to, '--', path], { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.trim() === '';
  } catch {
    return false;
  }
}

/** How many lines a file has at a commit, or null when the file is not there. */
export function lineCountAt(tree, head, path) {
  try {
    const out = execFileSync('git', ['show', `${head}:${path}`], { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
    return out.split('\n').length;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The fleet.
// ---------------------------------------------------------------------------

/**
 * How many finders, and which angles each carries. Round 1 is sized to the
 * whole diff the way Claude Code's own reviewer sizes its fleet —
 * `clamp(ceil(lines/150), 2, 5)` — with one degrade rule: a change under
 * sixty lines gets one finder carrying every angle and at most two verifiers,
 * because two opus finders on a twenty-line diff is ceremony.
 *
 * Round 2+ is sized to the FIX, not the pull request: `clamp(ceil(lines/300),
 * 1, 3)` finders and at most four verifiers. The two measured local-fitness
 * runs (#241, #242) spent 83–94% of their tokens in the loop, and most of it
 * re-reviewing a diff that grew 1286 → 3993 lines with five finders and eight
 * verifiers every round — rounds whose only job was to check a fix.
 */
export function fleetPlan(lines, round, { ofFix = false, risk = false } = {}) {
  const angles = round === 1 ? [...CORE_ANGLES, ...CLEANUP_ANGLES] : [...CORE_ANGLES];
  if (lines < SMALL_DIFF_LINES && !risk) return { finders: 1, maxVerifiers: 2, angles: [angles] };
  const floor = risk ? 2 : (ofFix ? 1 : 2);
  const finders = ofFix ? Math.min(3, Math.max(floor, Math.ceil(lines / 300))) : Math.min(5, Math.max(floor, Math.ceil(lines / 150)));
  const dealt = Array.from({ length: finders }, () => []);
  angles.forEach((a, i) => dealt[i % finders].push(a));
  return { finders, maxVerifiers: ofFix ? 4 : 8, angles: dealt };
}

/** Split items into at most `maxBatches` batches of about `per` each. */
export function batchItems(items, { per = 3, maxBatches = 8 } = {}) {
  if (items.length === 0) return [];
  const size = Math.max(per, Math.ceil(items.length / maxBatches));
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// What the reviewers hand back, validated. Refused rather than repaired.
// ---------------------------------------------------------------------------

const str = (v) => typeof v === 'string' && v.trim().length > 0;

/** A finder's file: `{ candidates: [...], notExamined: [...] }`. */
export function validateCandidates(text, finder) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { error: `is not valid JSON (${String(err.message).split('\n')[0]})` };
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.candidates)) return { error: 'has no `candidates` array' };
  if (!Array.isArray(data.notExamined)) return { error: 'has no `notExamined` list — a finder names what it did not look at' };
  const candidates = [];
  for (const [i, c] of data.candidates.entries()) {
    const where = `candidates[${i}]`;
    if (!c || typeof c !== 'object') return { error: `${where} is not an object` };
    if (!str(c.file)) return { error: `${where}.file is missing` };
    if (!Number.isInteger(c.line) || c.line < 1) return { error: `${where}.line must be a positive integer` };
    if (!str(c.category)) return { error: `${where}.category is missing — name the angle that produced it` };
    if (!str(c.summary)) return { error: `${where}.summary is missing` };
    // 60 is the target the brief asks for; 80 is the cap. The first real loop
    // refused two whole finder files over summaries of 62–66 characters — the
    // punctuation-class refusal the 0.6.0 grammar taught reviewers to write
    // less. A cosmetic length is not a correctness property.
    if (!str(c.short_summary) || c.short_summary.length > SHORT_SUMMARY_CAP) return { error: `${where}.short_summary must be 1–${SHORT_SUMMARY_CAP} characters (aim for 60)` };
    if (!str(c.failure_scenario)) return { error: `${where}.failure_scenario is missing — a candidate with no nameable failure is not a candidate` };
    // Absent means major: an unrated candidate is verified, never dropped.
    // That is also what keeps candidates filed before 0.9.0 valid.
    if (c.proposed_severity !== undefined && !PROPOSED_SEVERITIES.includes(c.proposed_severity)) {
      return { error: `${where}.proposed_severity must be one of ${PROPOSED_SEVERITIES.join('|')}` };
    }
    candidates.push({
      id: `c-${finder}-${i + 1}`,
      file: c.file.trim(), line: c.line, side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
      category: c.category.trim(), summary: c.summary.trim(), short_summary: c.short_summary.trim(),
      failure_scenario: c.failure_scenario.trim(),
      proposed_severity: c.proposed_severity ?? 'major',
      introduced_by_diff: c.introduced_by_diff !== false,
      same_as: str(c.same_as) ? c.same_as.trim() : null,
      suggestion: str(c.suggestion) ? c.suggestion : null,
    });
  }
  return { candidates, notExamined: data.notExamined.map((s) => String(s).trim()).filter(Boolean) };
}

/** A verifier's file: `{ verdicts: [{ id, verdict, severity?, introduced_by_diff?, quote, line?, note? }] }`. */
export function validateVerdicts(text, expected) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { error: `is not valid JSON (${String(err.message).split('\n')[0]})` };
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.verdicts)) return { error: 'has no `verdicts` array' };
  const verdicts = new Map();
  for (const [i, v] of data.verdicts.entries()) {
    const where = `verdicts[${i}]`;
    if (!v || typeof v !== 'object' || !str(v.id)) return { error: `${where}.id is missing` };
    if (!expected.has(v.id)) return { error: `${where} rules on "${v.id}", which nobody filed in this round` };
    const prior = v.id.startsWith('f-');
    const vocab = prior ? VERDICTS_PRIOR : VERDICTS_NEW;
    if (!vocab.includes(v.verdict)) return { error: `${where}.verdict for ${v.id} must be one of ${vocab.join('|')}` };
    if (!str(v.quote)) return { error: `${where}.quote is missing — a verdict quotes the line at the head commit` };
    if (!prior && v.verdict !== 'REFUTED' && !SEVERITIES.includes(v.severity)) {
      return { error: `${where}.severity for ${v.id} must be one of ${SEVERITIES.join('|')}` };
    }
    if (v.line !== undefined && (!Number.isInteger(v.line) || v.line < 1)) return { error: `${where}.line must be a positive integer` };
    verdicts.set(v.id, {
      verdict: v.verdict, severity: v.severity ?? null,
      introduced_by_diff: v.introduced_by_diff === undefined ? null : Boolean(v.introduced_by_diff),
      quote: v.quote.trim(), line: v.line ?? null, path: str(v.path) ? v.path.trim() : null, note: str(v.note) ? v.note.trim() : null,
    });
  }
  return { verdicts };
}

/**
 * Same file, same mechanism, one candidate. "Same mechanism" is the same
 * category within three lines; the survivor is the one with the most concrete
 * failure scenario, because the verifier can only confirm what is concrete.
 */
export function dedupCandidates(candidates) {
  const kept = [];
  for (const c of candidates) {
    // Same file and the same line (or within three lines under the same
    // angle) is the same finding whatever words it arrived in. The first real
    // round posted the bool-guard docstring finding three times under three
    // phrasings from three finders, each on tools.py:169, because the twin
    // test also required the category to match.
    const lines = (k) => [k.line, ...(k.mergedLines ?? [])];
    const twin = kept.find((k) => k.file === c.file && k.side === c.side
      && (lines(k).includes(c.line) || (k.category === c.category && lines(k).some((l) => Math.abs(l - c.line) <= 3))));
    if (!twin) { kept.push(c); continue; }
    const mergedFrom = [...(twin.mergedFrom ?? []), c.failure_scenario.length > twin.failure_scenario.length ? twin.id : c.id];
    const mergedLines = [...new Set([...lines(twin), c.line])];
    if (c.failure_scenario.length > twin.failure_scenario.length) kept[kept.indexOf(twin)] = { ...c, mergedFrom, mergedLines };
    else Object.assign(twin, { mergedFrom, mergedLines });
  }
  return kept;
}

const normalizeSummary = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Content id, assigned once: lane, file, category and the summary as first worded. */
export const findingId = (lane, f) =>
  `f-${createHash('sha256').update(`${lane.slug}|${f.file}|${f.category}|${normalizeSummary(f.short_summary)}`).digest('hex').slice(0, 8)}`;

// ---------------------------------------------------------------------------
// Round lifecycle on the run.
// ---------------------------------------------------------------------------

/**
 * Open a round: record the head it reviews, the diff it reviews, the fleet.
 * Refuses when the cap is spent, and when the head the loop would review is
 * not the head GitHub has — the caller passes what `gh pr view` reported.
 */
export function openRound(dir, run, lane, { head, remoteHead = null, prHead = null, diffText, deltaText = null, anotherRound = null, deferSave = false, now = () => new Date().toISOString() }) {
  if (!lane.pr) throw new RunError(`cannot review ${lane.slug}: no pull request — ship first`);
  const last = currentRound(lane);
  if (last && !last.registered) throw new RunError(`round ${last.round} of ${lane.slug} is open — register it (or its finders never delivered) before starting another`);
  if (reviewExhausted(lane)) {
    // The cap hands the open majors to a person. Two answers exist, and both
    // are typed by the person, never by `next`: rule on the majors
    // (`review-rule`), or direct one more round with a reason, recorded here.
    if (typeof anotherRound === 'string' && anotherRound.trim()) {
      lane.review.overrides ??= [];
      lane.review.overrides.push({ round: nextReviewRound(lane), reason: anotherRound.trim(), at: now() });
    } else {
      throw new HandBack(
        `the review loop on ${lane.slug} has run ${MAX_REVIEW_ROUNDS} rounds and a major is still open — ` +
          'stop, and put the open majors in front of the user; never ready a pull request over one. ' +
          'The user rules with `review-rule --finding <id> --fixed|--withdrawn --note "<what they checked>"`, ' +
          'or directs one more round with `review-brief --another-round "<why>"`',
      );
    }
  }
  if (remoteHead !== null && remoteHead !== head) {
    throw new RunError(`cannot review ${lane.slug}: local HEAD ${head.slice(0, 12)} is not on origin (${String(remoteHead).slice(0, 12)}) — push first; a round never reviews code GitHub has not received`);
  }
  if (prHead !== null && prHead !== head) {
    throw new RunError(`cannot review ${lane.slug}: the pull request's head is ${String(prHead).slice(0, 12)}, local HEAD is ${head.slice(0, 12)} — push, or fetch, before reviewing`);
  }
  const round = nextReviewRound(lane);
  const files = parseDiff(diffText);
  const lines = changedLines(files);
  if (lines === 0) throw new RunError(`cannot review ${lane.slug}: the diff over ${lane.base} is empty — there is nothing to review`);
  // Round 2+ reviews the fix: when the caller hands over what changed since
  // the previous round's head, the fleet is sized to that, and the finders
  // read it first. `diff.patch` still holds the whole change — GitHub anchors
  // a thread on the pull request's hunks, so inline eligibility is measured
  // against it, never against the fix.
  const fixFiles = deltaText === null ? null : parseDiff(deltaText);
  const fixLines = fixFiles === null ? null : changedLines(fixFiles);
  if (deltaText !== null && fixLines === 0) throw new RunError(`cannot review ${lane.slug}: nothing changed since round ${last?.round ?? '?'} reviewed ${String(last?.head).slice(0, 12)} — there is no fix to review`);
  const sizingFiles = fixFiles ?? files;
  const reviewLines = semanticChangedLines(sizingFiles);
  const plan = fleetPlan(reviewLines, round, { ofFix: fixLines !== null, risk: riskSensitiveChange(sizingFiles) });
  mkdirSync(reviewDir(dir, lane, round), { recursive: true });
  writeFileSync(diffPath(dir, lane, round), diffText);
  if (deltaText !== null) writeFileSync(fixPatchPath(dir, lane, round), deltaText);
  lane.review.rounds.push({
    round, head, prevHead: last?.head ?? null, lines, fixLines, reviewLines, finders: plan.finders, maxVerifiers: plan.maxVerifiers,
    angles: plan.angles, verifiers: null, at: { briefed: now() }, registered: null, verdict: null, posted: null, fix: null,
  });
  if (!deferSave) saveRun(dir, run);
  return { round, plan, lines, fixLines, files };
}

/** Every finder's candidates for the round, or the reason one is missing. */
export function readCandidates(dir, lane, round) {
  const entry = lane.review.rounds.find((r) => r.round === round);
  const all = [];
  const notExamined = [];
  for (let n = 1; n <= entry.finders; n += 1) {
    const path = candidatesPath(dir, lane, round, n);
    if (!existsSync(path)) throw new RunError(`finder ${n} of round ${round} has not delivered ${path} — wait for it, or re-dispatch it`);
    const parsed = validateCandidates(readDelivery(dir, path), n);
    if (parsed.error) throw new RunError(`finder ${n}'s candidates ${parsed.error} (${path}) — send the finder its own file back; the registrar repairs nothing`);
    all.push(...parsed.candidates);
    notExamined.push(...parsed.notExamined);
  }
  return { candidates: dedupCandidates(all), notExamined: [...new Set(notExamined)] };
}

/**
 * Plan the verifier batches. Round 1: every deduped candidate. Round 2+:
 * every prior open MAJOR as a mandatory item — a major nobody re-judged is a
 * major whose status is a guess — plus every candidate a finder proposed as
 * a major. Records the batches on the round so `readVerdicts` knows what must
 * come back.
 *
 * What is deliberately NOT an item after round 1, and why, measured on the
 * two local-fitness runs this rewrote (#241, #242):
 *
 * - A prior nit or pre-existing finding. Nits do not block, the fixer is not
 *   asked to touch them, and `ready` tolerates them — so re-ruling them buys
 *   nothing, and it was most of the verifier bill: round 4 of #242 sent 51
 *   priors to eight opus verifiers and got 41 "still-open" back. They are
 *   still open by construction (`autoStillOpen`) — except one the fixer
 *   reported fixed, which the registrar closes on the fixer's word
 *   (`autoFixed`); the fixer's word is enough for a finding that never blocked.
 * - A fresh candidate its finder proposed as a nit. After round 1 no new nit
 *   posts and none is fixed, yet finders filed 37–57 candidates a round and
 *   the verifiers rated most of them nits. Recorded on the round as
 *   `unverifiedNits`, never registered, never posted.
 */
// `tree` is accepted for the callers that pass it; nothing here reads the checkout any more.
export function planVerification(dir, run, lane, round, candidates, _opts = {}) {
  const entry = lane.review.rounds.find((r) => r.round === round);
  const lastFix = new Set(lane.review.rounds.find((r) => r.round === round - 1)?.fix?.fixedNits ?? []);
  const auto = [];
  const autoFixed = [];
  const prior = openFindings(lane).filter((f) => {
    if (f.severity === 'major') return true;
    auto.push(f.id);
    if (lastFix.has(f.id)) autoFixed.push(f.id);
    return false;
  }).map((f) => ({
    id: f.id, prior: true, file: f.file, line: f.line, side: f.side, severity: f.severity, category: f.category,
    short_summary: f.short_summary, summary: f.summary, failure_scenario: f.failure_scenario,
    dispute: f.dispute ?? null, filedAtHead: f.head,
  }));
  const unverified = round > 1 ? candidates.filter((c) => c.proposed_severity === 'nit') : [];
  const fresh = candidates.filter((c) => !unverified.includes(c)).map((c) => ({ ...c, prior: false }));
  const items = [...prior, ...fresh];
  const batches = batchItems(items, { per: 3, maxBatches: entry.maxVerifiers });
  entry.verifiers = batches.length;
  entry.candidateIds = fresh.map((c) => c.id);
  entry.priorIds = prior.map((p) => p.id);
  entry.autoStillOpen = auto.filter((id) => !autoFixed.includes(id));
  entry.autoFixed = autoFixed;
  entry.unverifiedNits = unverified.map(({ id, file, line, category, short_summary }) => ({ id, file, line, category, short_summary }));
  entry.candidates = fresh;
  if (!_opts.deferSave) saveRun(dir, run);
  return { batches, prior, fresh, auto, autoFixed, unverified };
}

/** Every verifier's verdicts for the round, keyed by item id; refuses a missing batch or an unruled item. */
export function readVerdicts(dir, lane, round) {
  const entry = lane.review.rounds.find((r) => r.round === round);
  if (entry.verifiers === null) throw new RunError(`round ${round} of ${lane.slug} has no verifier plan yet — run review-verify first`);
  const expected = new Set([...(entry.candidateIds ?? []), ...(entry.priorIds ?? [])]);
  const verdicts = new Map();
  for (let n = 1; n <= entry.verifiers; n += 1) {
    const path = verdictsPath(dir, lane, round, n);
    if (!existsSync(path)) throw new RunError(`verifier ${n} of round ${round} has not delivered ${path} — wait for it, or re-dispatch it`);
    const parsed = validateVerdicts(readDelivery(dir, path), expected);
    if (parsed.error) throw new RunError(`verifier ${n}'s verdicts ${parsed.error} (${path}) — send the verifier its own file back`);
    for (const [id, v] of parsed.verdicts) verdicts.set(id, v);
  }
  const missing = [...expected].filter((id) => !verdicts.has(id));
  if (missing.length > 0) {
    throw new RunError(`round ${round} of ${lane.slug}: no verdict for ${missing.join(', ')} — every candidate and every prior open finding gets ruled on, or the round registers nothing`);
  }
  return verdicts;
}

/**
 * The registrar. Turns candidates + verdicts into findings with ids, states
 * and transitions, applying every convergence rule, and binds the round to
 * its head. Pure with respect to the network: it reads git, never GitHub.
 */
export function registerRound(dir, run, lane, round, { tree, now = () => new Date().toISOString() } = {}) {
  const entry = lane.review.rounds.find((r) => r.round === round);
  if (!entry) throw new RunError(`no round ${round} on ${lane.slug}`);
  if (entry.registered) throw new RunError(`round ${round} of ${lane.slug} is already registered`);
  const workdir = tree ?? laneTree(dir, run, lane);
  const head = headOf(workdir);
  if (head !== entry.head) {
    throw new RunError(`cannot register round ${round} of ${lane.slug}: the branch moved (reviewed ${entry.head.slice(0, 12)}, now ${head.slice(0, 12)}) — the verdicts are about code that is no longer HEAD`);
  }
  const verdicts = readVerdicts(dir, lane, round);
  // Nothing posted to the pull request may carry this machine's paths. A
  // finder handed an absolute CLAUDE.md path in its brief copied it into a
  // finding on the first real round, and the review body published the
  // maintainer's home directory. Every text field is made repository-relative
  // here, before it is recorded, rendered or posted.
  const roots = [workdir, run.repo.path, ...(run.execution ? [run.execution.path, ...(run.execution.priorRoots ?? [])] : [])].filter(Boolean).sort((a, b) => b.length - a.length);
  const relative = (text) => (typeof text === 'string' ? roots.reduce((t, r) => t.split(`${r}/`).join('').split(r).join('<repo>'), text) : text);
  for (const v of verdicts.values()) { v.quote = relative(v.quote); v.note = relative(v.note); }
  for (const c of entry.candidates ?? []) {
    for (const k of ['summary', 'short_summary', 'failure_scenario', 'suggestion']) c[k] = relative(c[k]);
    c.file = relative(c.file);
  }
  const files = parseDiff(readFileSync(diffPath(dir, lane, round), 'utf8'));
  const delta = entry.prevHead ? parseDiff(deltaDiff(workdir, entry.prevHead, entry.head)) : null;
  const { notExamined } = readCandidates(dir, lane, round);
  lane.review.findings ??= [];

  const transitions = { fixed: [], stillOpen: [], withdrawn: [], new: [], notes: [], suppressed: [], dropped: [] };

  // Prior nits and pre-existing findings: not re-verified after round 1.
  // Still open by construction, unless the fixer reported one fixed — then it
  // closes on the fixer's word, since it never blocked. A verdict outranks
  // the fixer's word, so an id that is also a verifier item is left to the
  // verdict loop below.
  const ruled = new Set(entry.priorIds ?? []);
  for (const id of entry.autoStillOpen ?? []) {
    const f = lane.review.findings.find((x) => x.id === id);
    if (!f || f.status !== 'open' || ruled.has(id)) continue;
    f.lastRound = round;
    f.history = [...(f.history ?? []), { round, verdict: 'still-open', quote: `${f.file}:${f.line} as filed at ${String(f.head).slice(0, 12)}`, note: 'auto: nits are not re-verified after round 1' }];
    f.stillOpenRounds = (f.stillOpenRounds ?? 0) + 1;
    transitions.stillOpen.push(id);
  }
  for (const id of entry.autoFixed ?? []) {
    const f = lane.review.findings.find((x) => x.id === id);
    if (!f || f.status !== 'open' || ruled.has(id)) continue;
    f.lastRound = round;
    f.history = [...(f.history ?? []), { round, verdict: 'fixed', quote: `${f.file}:${f.line} as filed at ${String(f.head).slice(0, 12)}`, note: 'auto: the fixer reported it fixed; a nit is closed on the fixer\'s word' }];
    f.status = 'fixed';
    f.fixedAt = head;
    transitions.fixed.push(id);
  }

  // Prior findings first: their fate this round.
  for (const id of entry.priorIds ?? []) {
    const f = lane.review.findings.find((x) => x.id === id);
    const v = verdicts.get(id);
    f.lastRound = round;
    f.history = [...(f.history ?? []), { round, verdict: v.verdict, quote: v.quote, note: v.note }];
    if (v.verdict === 'fixed') { f.status = 'fixed'; f.fixedAt = head; transitions.fixed.push(id); }
    else if (v.verdict === 'withdrawn') { f.status = 'withdrawn'; transitions.withdrawn.push(id); }
    else {
      f.status = 'open';
      f.stillOpenRounds = (f.stillOpenRounds ?? 0) + 1;
      if (v.line) f.line = v.line;
      if (v.path) f.file = v.path;
      if (f.dispute) { f.disputes = (f.disputes ?? 0) + 1; f.disputeRuling = v.note ?? v.quote; f.dispute = null; }
      transitions.stillOpen.push(id);
    }
  }

  // Then the new candidates.
  let nitsPosted = 0;
  for (const c of entry.candidates ?? []) {
    const v = verdicts.get(c.id);
    if (v.verdict === 'REFUTED') { transitions.dropped.push({ id: c.id, quote: v.quote }); continue; }
    if (c.same_as && lane.review.findings.some((f) => f.id === c.same_as && f.status === 'open')) {
      transitions.dropped.push({ id: c.id, quote: `same as ${c.same_as}` });
      continue;
    }
    const line = v.line ?? c.line;
    const file = v.path ?? c.file;
    const total = lineCountAt(workdir, head, file);
    if (c.side === 'RIGHT' && (total === null || line > total)) {
      throw new RunError(`cannot register round ${round} of ${lane.slug}: ${c.id} cites ${file}:${line}, which does not exist at ${head.slice(0, 12)} (${total === null ? 'no such file' : `${total} lines`}) — a finding that cites nothing is an opinion`);
    }
    let severity = v.severity;
    const introduced = v.introduced_by_diff ?? c.introduced_by_diff;
    let demoted = null;
    if (!introduced) severity = 'pre-existing';
    if (CLEANUP_ANGLES.includes(c.category) && severity === 'major') { severity = 'nit'; demoted = 'cleanup-angles-are-nits'; }
    // Discovery-oscillation rule: from round 2, PLAUSIBLE on a line the last
    // fix did not touch is a note, not a major — or the loop never converges.
    if (round > 1 && severity === 'major' && v.verdict === 'PLAUSIBLE' && delta && !touched(delta, file, line)) {
      severity = 'nit'; demoted = 'plausible-on-unchanged-lines';
    }
    const inline = inlineEligible(files, file, line, c.side);
    const finding = {
      id: findingId(lane, { ...c, file }),
      file, line, side: c.side, category: c.category, severity, verdict: v.verdict, introduced_by_diff: Boolean(introduced),
      short_summary: c.short_summary, summary: c.summary, failure_scenario: c.failure_scenario, quote: v.quote,
      suggestion: c.suggestion, inline, status: 'open', firstRound: round, lastRound: round, head,
      stillOpenRounds: 0, disputes: 0, dispute: null, threadId: null, posted: false, demoted,
    };
    if (lane.review.findings.some((f) => f.id === finding.id)) {
      // Re-filed under the same wording after being fixed or withdrawn: a
      // new round of the same finding, not a new finding.
      const existing = lane.review.findings.find((f) => f.id === finding.id);
      if (existing.status === 'open') { transitions.dropped.push({ id: c.id, quote: `duplicate of ${existing.id}` }); continue; }
      finding.id = `${finding.id}-r${round}`;
    }
    if (severity === 'nit') {
      if (round > 1) { finding.posted = false; finding.suppressed = 'no-new-nits-after-round-1'; transitions.suppressed.push(finding.id); }
      else if (nitsPosted >= NIT_CAP) { finding.posted = false; finding.suppressed = 'nit-cap'; transitions.suppressed.push(finding.id); }
      else { nitsPosted += 1; transitions.new.push(finding.id); }
      if (demoted === 'plausible-on-unchanged-lines') transitions.notes.push(finding.id);
    } else {
      transitions.new.push(finding.id);
    }
    lane.review.findings.push(finding);
  }

  const majors = openMajors(lane).length;
  const verdict = majors === 0 ? 'converged' : 'open';
  entry.registered = { at: now(), head };
  entry.verdict = verdict;
  entry.transitions = transitions;
  entry.notExamined = notExamined.map(relative);
  entry.counts = {
    open: openFindings(lane).length, majors,
    nits: openFindings(lane).filter((f) => f.severity === 'nit').length,
    preExisting: openFindings(lane).filter((f) => f.severity === 'pre-existing').length,
    dropped: transitions.dropped.length,
  };
  // Timestamp-free, like the plan verdicts: the round's clock lives on the run entry.
  const record = {
    lane: lane.slug, pr: lane.pr.number, round, head, verdict, counts: entry.counts, transitions, notExamined,
    findings: lane.review.findings.filter((f) => f.lastRound === round).map(({ threadId, posted, ...rest }) => rest),
  };
  writeFileSync(registeredPath(dir, lane, round), `${JSON.stringify(record, null, 2)}\n`);
  saveRun(dir, run);
  return record;
}

// ---------------------------------------------------------------------------
// The GitHub review: one per round.
// ---------------------------------------------------------------------------

const MARK = { major: '🔴', nit: '🟡', 'pre-existing': '🟣' };
const LABEL = { major: 'Major', nit: 'Nit', 'pre-existing': 'Pre-existing' };

export const roundMarker = (lane, round, head) => `<!-- issueflow:review ${lane.slug} r${round} ${head} -->`;
export const findingMarker = (id) => `<!-- issueflow:finding ${id} -->`;

/** One thread's text: the marker, the claim, the scenario, the quote, a suggestion when it is complete. */
export function threadBody(f) {
  const lines = [
    findingMarker(f.id),
    `${MARK[f.severity]} **${LABEL[f.severity]}** · \`${f.id}\` · ${f.category}${f.verdict ? ` · ${f.verdict}` : ''}`,
    '',
    f.summary,
    '',
    `**Failure scenario.** ${f.failure_scenario}`,
  ];
  if (f.quote) lines.push('', `> ${f.quote.split('\n').join('\n> ')}`);
  if (f.suggestion && f.suggestion.split('\n').length <= 5) lines.push('', '```suggestion', f.suggestion.replace(/\n$/, ''), '```');
  return lines.join('\n');
}

/**
 * The review body: a tally first, then the table, then what could not be
 * anchored, what was suppressed, and what nobody examined. The tally is the
 * line a reader uses to decide whether to read the rest.
 */
export function reviewBody(lane, round, record, { unanchored = [] } = {}) {
  const posted = record.findings.filter((f) => f.status === 'open' && f.firstRound === round && !f.suppressed);
  const t = record.transitions;
  const tally = [
    `Round ${round}`,
    `${record.counts.majors} major${record.counts.majors === 1 ? '' : 's'} open`,
    `${posted.filter((f) => f.severity === 'nit').length} nit${posted.filter((f) => f.severity === 'nit').length === 1 ? '' : 's'}`,
    `${posted.filter((f) => f.severity === 'pre-existing').length} pre-existing`,
  ];
  if (round > 1) tally.push(`${t.fixed.length} fixed`, `${t.stillOpen.length} still open`, 'new nits suppressed (round-1 rule)');
  const lines = [`**${record.verdict === 'converged' ? 'No majors open — converged.' : 'Blocking: ' + record.counts.majors + ' major' + (record.counts.majors === 1 ? '' : 's') + ' open.'}** ${tally.join(' · ')}`, ''];
  const rows = record.findings
    .filter((f) => f.lastRound === round && (f.firstRound === round ? !f.suppressed : true))
    .map((f) => `| ${MARK[f.severity]} ${LABEL[f.severity]} | \`${f.file}:${f.line}\` | ${f.short_summary} | ${f.status === 'open' ? (f.firstRound === round ? 'new' : `still open (${f.stillOpenRounds})`) : f.status} |`);
  if (rows.length > 0) lines.push('| Severity | Where | Finding | Status |', '|---|---|---|---|', ...rows, '');
  if (unanchored.length > 0) {
    lines.push('**Could not anchor** — GitHub refused a thread on these lines; they still count:', '');
    for (const f of unanchored) lines.push(`- ${MARK[f.severity]} \`${f.file}:${f.line}\` — ${f.summary} (${f.id})`);
    lines.push('');
  }
  const notes = record.findings.filter((f) => f.firstRound === round && f.demoted === 'plausible-on-unchanged-lines');
  if (notes.length > 0) {
    lines.push('**Notes** — plausible, on lines the last fix did not touch; not blocking:', '');
    for (const f of notes) lines.push(`- \`${f.file}:${f.line}\` — ${f.short_summary}`);
    lines.push('');
  }
  const suppressed = record.findings.filter((f) => f.firstRound === round && f.suppressed === 'nit-cap');
  if (suppressed.length > 0) lines.push(`Plus ${suppressed.length} more nit${suppressed.length === 1 ? '' : 's'} not posted inline (cap ${NIT_CAP}).`, '');
  if (record.notExamined.length > 0) {
    lines.push('<details><summary>Not examined</summary>', '');
    for (const n of record.notExamined) lines.push(`- ${n}`);
    lines.push('', '</details>', '');
  }
  lines.push(roundMarker(lane, round, record.head), '', '<sub>issueflow review loop — finders, verifiers, one review per round; majors block, nits do not.</sub>');
  return lines.join('\n');
}

/** Replies owed to prior threads this round. */
export function threadReplies(lane, round, record) {
  const out = [];
  const t = record.transitions;
  const byId = (id) => lane.review.findings.find((f) => f.id === id);
  for (const id of t.fixed) {
    const f = byId(id);
    if (f?.threadId) out.push({ id, threadId: f.threadId, body: `Fixed in ${record.head.slice(0, 12)} — ${f.history.at(-1).quote}`, resolve: true });
  }
  for (const id of t.withdrawn) {
    const f = byId(id);
    if (f?.threadId) out.push({ id, threadId: f.threadId, body: `Withdrawn at ${record.head.slice(0, 12)} — ${f.history.at(-1).quote}`, resolve: true });
  }
  for (const id of t.stillOpen) {
    const f = byId(id);
    if (f?.threadId) out.push({ id, threadId: f.threadId, body: `Still open at ${record.head.slice(0, 12)}${f.disputeRuling ? ` — on the dispute: ${f.disputeRuling}` : ''}`, resolve: false });
  }
  return out;
}

/**
 * The payload, written to disk before anything is sent: what would be
 * posted, exactly. An offline run stops here, and the golden pins it.
 */
export function buildPayload(dir, lane, round, record) {
  const threads = lane.review.findings
    .filter((f) => f.firstRound === round && f.status === 'open' && !f.suppressed && f.inline)
    .map((f) => ({ id: f.id, path: f.file, line: f.line, side: f.side, body: threadBody(f) }));
  const bodyOnly = lane.review.findings.filter((f) => f.firstRound === round && f.status === 'open' && !f.suppressed && !f.inline);
  const payload = {
    lane: lane.slug, pr: lane.pr.number, round, head: record.head, event: 'COMMENT',
    body: reviewBody(lane, round, record, { unanchored: bodyOnly }),
    threads, replies: threadReplies(lane, round, record),
  };
  mkdirSync(reviewDir(dir, lane, round), { recursive: true });
  writeFileSync(payloadPath(dir, lane, round), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

/**
 * Post the round: a pending review, one thread per inline finding (a
 * refused anchor moves that finding into the body and costs nothing else),
 * submit as COMMENT, then reply to and resolve prior threads. Records every
 * thread id on its finding, which is how the next round addresses it.
 */
export function postRound(dir, run, lane, round, { prNodeId, now = () => new Date().toISOString() }) {
  const entry = lane.review.rounds.find((r) => r.round === round);
  if (!entry?.registered) throw new RunError(`round ${round} of ${lane.slug} is not registered — nothing to post`);
  if (entry.posted) throw new RunError(`round ${round} of ${lane.slug} was already posted (${entry.posted.url})`);
  const record = JSON.parse(readFileSync(registeredPath(dir, lane, round), 'utf8'));
  let payload = buildPayload(dir, lane, round, record);
  const cwd = run.repo.path;
  const input = join(reviewDir(dir, lane, round), 'graphql.json');

  const review = graphql(cwd, input, { query: GQL.addReview, variables: { pr: prNodeId, body: null } });
  const reviewId = review.addPullRequestReview.pullRequestReview.id;
  const unanchored = [];
  for (const t of payload.threads) {
    try {
      const res = graphql(cwd, input, { query: GQL.addThread, variables: { review: reviewId, path: t.path, line: t.line, side: t.side, body: t.body } });
      const f = lane.review.findings.find((x) => x.id === t.id);
      f.threadId = res.addPullRequestReviewThread.thread.id;
      f.posted = true;
    } catch (err) {
      const f = lane.review.findings.find((x) => x.id === t.id);
      f.inline = false;
      f.anchorError = String(err.message).split('\n')[0];
      unanchored.push(f);
    }
  }
  // The body is written last, so it can name what could not be anchored.
  const bodyOnly = lane.review.findings.filter((f) => f.firstRound === round && f.status === 'open' && !f.suppressed && !f.inline);
  const body = reviewBody(lane, round, record, { unanchored: bodyOnly });
  const submitted = graphql(cwd, input, { query: GQL.submitReview, variables: { review: reviewId, body } });
  const url = submitted.submitPullRequestReview.pullRequestReview.url;

  const replies = [];
  for (const r of threadReplies(lane, round, record)) {
    try {
      graphql(cwd, input, { query: GQL.reply, variables: { thread: r.threadId, body: r.body } });
      if (r.resolve) graphql(cwd, input, { query: GQL.resolve, variables: { thread: r.threadId } });
      replies.push({ id: r.id, state: r.resolve ? 'resolved' : 'replied' });
    } catch (err) {
      replies.push({ id: r.id, state: 'failed', detail: String(err.message).split('\n')[0] });
    }
  }
  payload = { ...payload, body, threads: payload.threads.filter((t) => !unanchored.some((f) => f.id === t.id)) };
  writeFileSync(payloadPath(dir, lane, round), `${JSON.stringify(payload, null, 2)}\n`);
  entry.posted = { at: now(), reviewId, url, threads: payload.threads.length, unanchored: unanchored.length, replies };
  saveRun(dir, run);
  return entry.posted;
}

// ---------------------------------------------------------------------------
// The fix report: what the fixer did with each open finding.
// ---------------------------------------------------------------------------

/**
 * The findings a fix round is asked to address: every open major — plus, in
 * round 1 only, nits that carry a complete suggestion (a one-line replacement
 * is cheap on the first pass). From round 2 the fixer touches majors only:
 * every extra line a fix adds is a line the next round reviews, and the
 * measured runs grew a 1286-line diff to 3993 over four fix rounds.
 */
export function fixItems(lane) {
  const first = (currentRound(lane)?.round ?? 1) === 1;
  return openFindings(lane).filter((f) => f.severity === 'major' || (first && f.severity === 'nit' && f.suggestion && !f.suppressed));
}

/**
 * Read `fix-report.json` — `{ "<id>": { "status": "fixed" | "not-changed", "note": "…" } }` —
 * and record it. A `not-changed` major is a dispute: the next round's verifier
 * rules on it, and the same major disputed twice hands the run back.
 */
export function applyFixReport(dir, run, lane, round) {
  const entry = lane.review.rounds.find((r) => r.round === round);
  if (!entry?.registered) throw new RunError(`round ${round} of ${lane.slug} is not registered — there is nothing to fix yet`);
  const path = fixReportPath(dir, lane, round);
  if (!existsSync(path)) throw new RunError(`no fix report at ${path} — the fixer has not delivered`);
  let data;
  try {
    data = JSON.parse(readDelivery(dir, path, run));
  } catch (err) {
    throw new RunError(`${path} is not valid JSON (${String(err.message).split('\n')[0]})`);
  }
  const asked = fixItems(lane);
  const replies = [];
  const disputed = [];
  const fixedNits = [];
  for (const f of asked) {
    const r = data[f.id];
    if (!r || !['fixed', 'not-changed'].includes(r.status)) {
      throw new RunError(`the fix report says nothing usable about ${f.id} (${f.file}:${f.line}) — every finding in the brief gets "fixed" or "not-changed: <reason>"`);
    }
    if (r.status === 'not-changed') {
      if (!str(r.note)) throw new RunError(`${f.id} is not-changed with no reason — note the skip, in one sentence`);
      if (f.severity === 'major') {
        f.dispute = r.note.trim();
        if ((f.disputes ?? 0) >= 1) disputed.push(f);
      }
      replies.push({ id: f.id, threadId: f.threadId, body: `Not changed — ${r.note.trim()}` });
    } else if (f.severity === 'major') {
      replies.push({ id: f.id, threadId: f.threadId, body: `Addressed${str(r.note) ? ` — ${r.note.trim()}` : ''}; the next round verifies it.` });
    } else {
      // A nit never blocked; nobody re-verifies it. The next round's registrar
      // closes it on this word and resolves its thread. Recorded on the round,
      // not the finding: a finding's shape is what the frozen golden pins.
      fixedNits.push(f.id);
      replies.push({ id: f.id, threadId: f.threadId, body: `Addressed${str(r.note) ? ` — ${r.note.trim()}` : ''}; taken as fixed (a nit is not re-verified).` });
    }
  }
  // Merge, never replace: `briefed` and `model` were recorded when the fixer
  // was briefed, and losing them made `next` re-brief a fixer whose fix was
  // already pushed — a stale dispatch printed on every round of the first
  // real loop.
  entry.fix = { ...(entry.fix ?? {}), reported: true, fixed: replies.filter((r) => r.body.startsWith('Addressed')).length, notChanged: replies.filter((r) => r.body.startsWith('Not changed')).length, fixedNits };
  saveRun(dir, run);
  if (disputed.length > 0) {
    throw new HandBack(
      `${disputed.map((f) => `${f.id} (${f.file}:${f.line})`).join(', ')} disputed twice — the reviewer and the fixer disagree and neither is going to move; ` +
        'put both sides in front of the user',
    );
  }
  return replies;
}

/** Post the fix report's replies on their threads. Failures are rows, never throws. */
export function postFixReplies(dir, run, lane, round, replies) {
  const input = join(reviewDir(dir, lane, round), 'graphql.json');
  return replies.map((r) => {
    if (!r.threadId) return { id: r.id, state: 'no thread', detail: 'the finding was body-only' };
    try {
      graphql(run.repo.path, input, { query: GQL.reply, variables: { thread: r.threadId, body: r.body } });
      return { id: r.id, state: 'replied' };
    } catch (err) {
      return { id: r.id, state: 'failed', detail: String(err.message).split('\n')[0] };
    }
  });
}

/** Mark the lane converged: the only path to `ready`. */
export function converge(dir, run, lane, now = () => new Date().toISOString()) {
  const last = currentRound(lane);
  if (!last?.registered) throw new RunError(`cannot ready ${lane.slug}: no registered review round`);
  if (last.verdict !== 'converged') {
    throw new RunError(`cannot ready ${lane.slug}: round ${last.round} left ${openMajors(lane).length} major(s) open — never ready a pull request over an open major`);
  }
  if (!last.posted && !run.offline) throw new RunError(`cannot ready ${lane.slug}: round ${last.round} is registered but not posted — the record on the pull request comes first`);
  lane.review.converged = true;
  lane.review.convergedAt = now();
  saveRun(dir, run);
  return last;
}

/** Re-derive a registered round's verdict and counts from the findings as they stand now. */
function recount(lane, entry) {
  const majors = openMajors(lane).length;
  entry.verdict = majors === 0 ? 'converged' : 'open';
  entry.counts = {
    ...(entry.counts ?? {}),
    open: openFindings(lane).length, majors,
    nits: openFindings(lane).filter((f) => f.severity === 'nit').length,
    preExisting: openFindings(lane).filter((f) => f.severity === 'pre-existing').length,
  };
  return entry;
}

/**
 * A person's ruling on an open finding once the loop has spent its cap. The
 * loop rules until the cap — code and verifiers, never the orchestrator — so
 * this refuses while a round could still run. After the cap, the person reads
 * the fixer's last commit and the thread, and says so: `fixed` with what they
 * checked, or `withdrawn` with why the finding was wrong. The note is the
 * record on the thread; a bare flag is refused for the same reason
 * --another-round needs a reason. Never called by `next`.
 */
export function ruleFinding(dir, run, lane, { id, ruling, note, head = null, now = () => new Date().toISOString() }) {
  const last = currentRound(lane);
  if (!last?.registered) throw new RunError(`cannot rule on ${lane.slug}: no registered review round`);
  const f = (lane.review?.findings ?? []).find((x) => x.id === id);
  if (!f) throw new RunError(`no finding ${id} on ${lane.slug} — the ids are in ${registeredPath(dir, lane, last.round)}`);
  if (f.status !== 'open') throw new RunError(`${id} is already ${f.status}`);
  // "At the cap" is the round count, not the verdict: with two majors open the
  // first ruling leaves the round open and the second must still be allowed.
  const cap = reviewCap(lane);
  if (lane.review.rounds.length < cap) {
    throw new RunError(
      `cannot rule on ${lane.slug}: the loop has run ${lane.review.rounds.length} of ${cap} rounds — ` +
        'the verifiers rule until the cap; a person rules after it. Let the next round judge the fix',
    );
  }
  if (!['fixed', 'withdrawn'].includes(ruling)) throw new RunError(`a ruling is --fixed or --withdrawn, not "${ruling}"`);
  if (typeof note !== 'string' || !note.trim()) {
    throw new RunError('a ruling needs --note "<what you checked>" — one sentence the thread can carry, never a bare flag');
  }
  f.status = ruling;
  f.ruledBy = 'human';
  f.ruledAt = now();
  f.ruling = note.trim();
  if (ruling === 'fixed' && head) f.fixedAt = head;
  last.rulings = [...(last.rulings ?? []), { id, ruling, note: note.trim(), at: f.ruledAt }];
  recount(lane, last);
  saveRun(dir, run);
  return {
    finding: f,
    body: `${ruling === 'fixed' ? '✅ Fixed' : 'Withdrawn'} — ruled by the author after round ${last.round} (the loop's cap): ${note.trim()}`,
  };
}

/** Everything a round table needs, one row per round. */
export const roundRows = (lane) =>
  (lane.review?.rounds ?? []).map((r) => [
    String(r.round), r.head.slice(0, 12), String(r.lines), r.fixLines == null ? '—' : String(r.fixLines), String(r.finders), String(r.verifiers ?? '—'),
    r.registered ? `${r.counts.majors} major, ${r.counts.nits} nit` : '—', r.verdict ?? 'open',
  ]);

/** `Fix Δ` is the lines the last fix changed — the growth the loop is paying to re-review. */
export const ROUND_COLUMNS = ['Round', 'Head', 'Lines', 'Fix Δ', 'Finders', 'Verifiers', 'Open', 'Verdict'];

/** Is `parentBranch` already an ancestor of the lane's HEAD? False means the lane below moved under it. */
export function stackedOn(tree, laneBranch, parentBranch) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', parentBranch, laneBranch], { cwd: tree, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Rebase a stacked lane onto the lane below it, and push it. Only ever
 * before the lane's first review round — a lane with posted threads is never
 * rebased under them — and never with a plain force: `--force-with-lease`
 * refuses if the remote moved since it was fetched.
 */
export function rebaseLane(tree, lane, parent, { push = true } = {}) {
  const before = headOf(tree);
  git(['rebase', parent.branch], tree);
  const after = headOf(tree);
  if (push) git(['push', '--force-with-lease', 'origin', lane.branch], tree);
  return { before, after, onto: headOf(tree) === after ? git(['rev-parse', parent.branch], tree).trim() : null };
}

export const listReviewFiles = (dir, lane, round) => (existsSync(reviewDir(dir, lane, round)) ? readdirSync(reviewDir(dir, lane, round)) : []);
