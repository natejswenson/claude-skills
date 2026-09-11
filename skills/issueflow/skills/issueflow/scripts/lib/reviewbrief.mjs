import { activePath, approvedArtifactPath, executionInstructions, prepareOutputs, recordDispatch } from './execution.mjs';
/**
 * The review loop's briefs — finder, verifier, fixer — rendered from
 * `references/review-method.md`, never improvised.
 *
 * Same contract as every other brief in this skill: a subagent starts cold,
 * the brief is the only channel, so it lands on disk where the baseline can
 * byte-compare it. The angle text is spliced from the method file verbatim,
 * which is what keeps "what a finder is told to look for" a single source.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PLAN_STAGE } from './stages.mjs';
import { SHARED_DIR, evidencePath, findStep, laneTree } from './run.mjs';
import {
  MAX_REVIEW_ROUNDS, NIT_CAP, candidatesPath, diffPath, finderBriefPath, finderProfile, fixBriefPath,
  fixPatchPath, fixReportPath, verdictsPath, verifierBriefPath,
  verifierProfile,
} from './prreview.mjs';
import { dispatchProfile, runtimeOf } from './runtime.mjs';
import { guidanceBlock as resolvedGuidance } from './guidance.mjs';
import { delegationInstructions } from './codex-policy.mjs';

const METHOD_PATH = new URL('../../references/review-method.md', import.meta.url);
const METHOD = readFileSync(METHOD_PATH, 'utf8');

/** The body of one `## <heading>` block of the method file. */
export function methodSection(heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = new RegExp(`^## ${escaped}\\s*$`, 'm').exec(METHOD);
  if (!start) throw new Error(`review-method.md has no "## ${heading}" section`);
  const rest = METHOD.slice(start.index + start[0].length);
  const end = /^## /m.exec(rest);
  return (end ? rest.slice(0, end.index) : rest).trim();
}

export const angleText = (id, run = null) => {
  const text = methodSection(`angle: ${id}`);
  if (id !== 'conventions' || runtimeOf(run) !== 'codex') return text;
  return text + '\n\nAlso apply scoped AGENTS.override.md / AGENTS.md and REVIEW.md from Repository guidance below.';
};

const bar = (headers, rows) =>
  [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

const coldStart = [
  'You are running cold: you cannot see the conversation that dispatched you, and',
  'nothing you were not handed here exists for you. Everything you need is below or',
  'named by a path below.',
];

function issueBlock(issue) {
  const lines = [`## The issue — #${issue.number}`, '', `**${issue.title}**`];
  if (issue.url) lines.push('', `<${issue.url}>`);
  lines.push('', (issue.body ?? '').trim() || '_(the issue has no body)_');
  return lines.join('\n');
}

/** True when the round has a fix to review rather than the whole change. */
const fixRound = (entry) => entry.round > 1 && entry.fixLines != null;

function changeBlock(dir, run, lane, entry, tree) {
  const rows = [
    ['pull request', `${run.repo.owner}/${run.repo.name}#${lane.pr.number}`],
    ['branch → base', `\`${lane.branch}\` → \`${lane.base}\``],
    ['head', entry.head],
    ['changed lines', String(entry.lines)],
  ];
  if (fixRound(entry)) rows.push(['previous head', entry.prevHead], ['lines the fix changed', String(entry.fixLines)]);
  rows.push(['work item', run.split ? `${lane.slug} — ${lane.title}` : 'the whole issue'], ['checkout', tree]);
  const out = [fixRound(entry) ? '## The fix under review' : '## The change under review', '', bar(['Field', 'Value'], rows), ''];
  if (fixRound(entry)) {
    out.push(
      `Round ${entry.round - 1} reviewed \`${String(entry.prevHead).slice(0, 12)}\`; a fixer then changed the work. What it`,
      `changed is at \`${fixPatchPath(dir, lane, entry.round)}\` — the diff from that head to the head above, three lines of`,
      'context per hunk. **Read it first, and read all of it.** The whole change over its base is at',
      `\`${diffPath(dir, lane, entry.round)}\`; it is reference, for callers and for what the plan promised —`,
      `round 1 already reviewed it line by line, and this round does not. Then read the enclosing`,
      'functions in the checkout named above, which is on that head; grep it for callers. The pull',
      'request page is not your source — the patch files and the checkout are.',
    );
  } else {
    out.push(
      `The diff is at \`${diffPath(dir, lane, entry.round)}\` — the whole change over its base, three lines`,
      'of context per hunk, at the head above. Read it first. Then read the enclosing functions in the',
      'checkout named above, which is on that head; grep it for callers. The pull request page is not',
      'your source — the diff file and the checkout are.',
    );
  }
  return out.join('\n');
}

function intentBlock(dir, run) {
  const plan = findStep(run, PLAN_STAGE);
  return [
    '## What the change is for',
    '',
    `The approved plan is at \`${approvedArtifactPath(dir, run, activePath(dir, SHARED_DIR, plan.stage.artifact))}\` — root cause, approach, the`,
    'files it said it would touch, and the proof it promised. It was red-teamed and approved before',
    'any code was written; the diff is supposed to be that plan, built.',
  ].join('\n');
}

/** The repository's own review instructions, when it has them. REVIEW.md is spliced; the host's instruction file is named. */
function guidanceBlock(run, files, tree) {
  const resolved = resolvedGuidance(tree, files);
  if (resolved) return runtimeOf(run) === 'codex' ? `${resolved}\n\n## Codex delegation policy\n\n${delegationInstructions('codex')}` : resolved;
  const out = ['## Repository guidance', ''];
  const reviewMd = join(tree, 'REVIEW.md');
  const instructionName = runtimeOf(run) === 'codex' ? 'AGENTS.md' : 'CLAUDE.md';
  const instructionFile = join(tree, instructionName);
  if (existsSync(reviewMd)) {
    out.push('The repository\'s own `REVIEW.md`, verbatim — it says what this repository wants flagged and at what severity:', '', readFileSync(reviewMd, 'utf8').trim(), '');
  } else {
    out.push('The repository has no `REVIEW.md`.', '');
  }
  const dirs = new Set();
  for (const f of files) {
    let d = dirname(f.path);
    while (d && d !== '.') { dirs.add(d); d = dirname(d); }
  }
  const nested = [...dirs].filter((d) => existsSync(join(tree, d, instructionName))).map((d) => `\`${d}/${instructionName}\``);
  if (existsSync(instructionFile)) {
    // Named repo-relative on purpose: a finder that copies the absolute path
    // into a finding puts the maintainer's home directory on the pull request.
    out.push(`For the conventions angle, read \`${instructionName}\` at the repository root${nested.length > 0 ? ` and ${nested.join(', ')}` : ''} — quote the exact rule when you cite one, and cite files by their repository-relative path.`);
  } else {
    out.push(`The repository has no \`${instructionName}\`; the conventions angle returns nothing unless \`REVIEW.md\` above states a rule.`);
  }
  if (runtimeOf(run) === 'codex') out.push('', '## Codex delegation policy', '', delegationInstructions('codex'));
  return out.join('\n');
}

/**
 * The open majors, in full — they are what the round exists to close, and
 * what a finder must not re-file. Open nits are a count: nobody re-verifies,
 * posts or fixes one after round 1, so listing eighty of them (round 4 of the
 * measured #242 run) taught the finders nothing and cost every one of them
 * seven kilobytes of context.
 */
function priorBlock(prior) {
  if (prior.length === 0) return null;
  const majors = prior.filter((f) => f.severity === 'major');
  const rest = prior.length - majors.length;
  const out = [
    '## Already open — hunt gaps, not repeats',
    '',
    'These majors are already filed and will be re-judged by the verifiers this round. Do not',
    'file them again. If you find the same defect in a second place, file it and set `same_as`',
    'to the id below it duplicates.',
    '',
  ];
  if (majors.length > 0) out.push(bar(['Id', 'Where', 'Finding'], majors.map((f) => [`\`${f.id}\``, `\`${f.file}:${f.line}\``, f.short_summary])), '');
  else out.push('_No major is open._', '');
  if (rest > 0) {
    out.push(
      `Plus ${rest} open nit${rest === 1 ? '' : 's'} and pre-existing finding${rest === 1 ? '' : 's'}, not listed: after round 1 a nit is`,
      'neither re-verified, posted nor fixed, so re-filing one costs nothing and finds nothing.',
    );
  }
  return out.join('\n');
}

const progressBlock = (path, run) => runtimeOf(run) === 'codex' && !run.execution ? '' : [
  ...executionInstructions(run),
  '## While you work',
  '',
  `Append one short lowercase line to \`${path}\` whenever you reach a real milestone —`,
  'what you just found, or what you are about to check next. This is scratch work for',
  'whoever is watching the run, not part of your answer: nobody reads it as prose, and it is',
  'never quoted back to you. Skip it if you genuinely have nothing to report yet.',
].join('\n');

const doneBlock = (run, what, path) => runtimeOf(run) === 'codex' ? [
  '## When you are done',
  '',
  `The moment ${what} is written, finish your subagent turn with the path`,
  `\`${path}\` and two or three sentences stating the result. Codex returns that final`,
  'response to the parent automatically. The file is the completion signal, so do not',
  'wait for a reply and do not send a separate orchestration message.',
].join('\n') : [
  '## When you are done',
  '',
  `The moment ${what} is written, send the orchestrator a message with`,
  '`SendMessage`, addressed to `main` — the agent that dispatched you. The message is the',
  "file's path, then two or three sentences of result. Send it before you finish your turn.",
  'An agent that goes idle without sending one leaves the orchestrator unable to tell a',
  'finished reviewer from a stalled one. If your harness names the dispatching agent',
  'something other than `main`, send it to that name instead.',
].join('\n');

// ---------------------------------------------------------------------------
// Finder.
// ---------------------------------------------------------------------------

export function renderFinderBrief(dir, run, lane, entry, n, { angles, issue, files, prior }) {
  const tree = laneTree(dir, run, lane);
  const out = [
    `# issueflow review brief — finder ${n} of ${entry.finders} (round ${entry.round})`,
    '',
    `You are a **finder** in the review of pull request #${lane.pr.number} on \`${run.repo.owner}/${run.repo.name}\`,`,
    `lane \`${lane.slug}\`. Round ${entry.round} of at most ${MAX_REVIEW_ROUNDS}. Your job is recall: surface every`,
    'candidate defect your angles can reach. A separate verifier decides what is real; you do not.',
    ...(fixRound(entry) ? [
      '',
      'This round reviews a **fix**, not the whole change: hunt what the fix broke, what it left',
      'unfixed of the majors listed below, and nothing else. A nit you happen to see may be filed',
      'as `proposed_severity: "nit"`; it is recorded, and it is neither verified, posted nor fixed.',
      'Do not spend the round on it.',
    ] : []),
    '',
    ...coldStart,
    '',
    changeBlock(dir, run, lane, entry, tree),
    '',
    intentBlock(dir, run),
    '',
    issueBlock(issue),
    '',
  ];
  const priorText = priorBlock(prior);
  if (priorText) out.push(priorText, '');
  out.push('## Your angles', '');
  for (const id of angles) out.push(`### ${id}`, '', angleText(id, run), '');
  out.push(
    '## The rule',
    '',
    methodSection('The anti-self-censorship rule'),
    '',
    guidanceBlock(run, files, tree),
    '',
    '## You must not',
    '',
    'Never edit any file in the checkout, and never post anything to GitHub — a finder that',
    'fixes what it found has destroyed the review it was sent to do, and the round posts once,',
    'as one review, after the verifiers rule. Say what fails and how, and propose whether it is a',
    'major (wrong behaviour, data loss, a security hole, a test that does not prove the fix) or a',
    'nit — the verifier rates what posts, and after round 1 only a proposed major reaches one.',
    'Never drop a candidate because you are only half sure.',
    '',
    '## Deliver',
    '',
    `Write ONE JSON file to \`${candidatesPath(dir, lane, entry.round, n)}\`, exactly this shape:`,
    '',
    '    {',
    '      "candidates": [',
    '        {',
    '          "file": "<path relative to the repository root>",',
    '          "line": <line number at the head commit>,',
    '          "side": "RIGHT",                     // "LEFT" only for a deleted line, cited at its OLD line number',
    '          "category": "<the angle that produced it>",',
    '          "summary": "<one sentence: what is wrong>",',
    '          "short_summary": "<the claim alone, at most 60 characters>",',
    '          "failure_scenario": "<concrete inputs or state → wrong output or crash>",',
    '          "proposed_severity": "major",        // or "nit": cosmetic, style, cleanup — the verifier decides',
    '          "introduced_by_diff": true,          // false when the defect predates this change',
    '          "suggestion": "<optional: the replacement for that line, only when it fully fixes it>",',
    '          "same_as": "<optional: an already-open f- id this duplicates>"',
    '        }',
    '      ],',
    '      "notExamined": ["<what you did not look at, one entry each>"]',
    '    }',
    '',
    '`line` must exist at the head commit — cite the line the defect is on, in the file it is in.',
    'For cleanup angles, `failure_scenario` states the concrete cost (what is duplicated, wasted,',
    'or harder to maintain) instead of a crash, and `proposed_severity` is `"nit"`. `notExamined` is',
    'required even when empty-handed: a clean pass that names nothing it skipped is',
    'indistinguishable from an unfinished one.',
    '',
    progressBlock(activePath(dir, 'progress', `${lane.slug}-review-r${entry.round}-finder-${n}.log`), run),
    '',
    doneBlock(run, 'the candidates file', candidatesPath(dir, lane, entry.round, n)),
    '',
  );
  return out.join('\n');
}

export function writeFinderBriefs(dir, run, lane, entry, { issue, files, prior }) {
  const out = [];
  const dispatch = finderProfile(run);
  entry.angles.forEach((angles, i) => {
    const n = i + 1;
    const path = finderBriefPath(dir, lane, entry.round, n);
    prepareOutputs(dir, run, [path, candidatesPath(dir, lane, entry.round, n), activePath(dir, 'progress', `${lane.slug}-review-r${entry.round}-finder-${n}.log`)]);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderFinderBrief(dir, run, lane, entry, n, { angles, issue, files, prior }));
    recordDispatch(dir, run, path, [candidatesPath(dir, lane, entry.round, n)]);
    out.push({ n, ...dispatch, prompt: path, writes: candidatesPath(dir, lane, entry.round, n), angles });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Verifier.
// ---------------------------------------------------------------------------

export function renderVerifierBrief(dir, run, lane, entry, n, { items, issue }) {
  const tree = laneTree(dir, run, lane);
  const prior = items.filter((i) => i.prior);
  const fresh = items.filter((i) => !i.prior);
  const out = [
    `# issueflow review brief — verifier ${n} of ${entry.verifiers} (round ${entry.round})`,
    '',
    `You are a **verifier** in the review of pull request #${lane.pr.number} on \`${run.repo.owner}/${run.repo.name}\`,`,
    `lane \`${lane.slug}\`. Round ${entry.round} of at most ${MAX_REVIEW_ROUNDS}. Finders have filed candidates; you`,
    'decide which are real, and you decide what became of the majors still open from earlier',
    'rounds. Nothing you pass is looked at again before it is posted, and nothing you refute is',
    'looked at again at all.',
    '',
    ...coldStart,
    '',
    changeBlock(dir, run, lane, entry, tree),
    '',
  ];
  if (entry.prevHead && !fixRound(entry)) {
    out.push(
      `The previous round reviewed \`${entry.prevHead}\`. What the fix changed since then is`,
      `\`git diff ${entry.prevHead} ${entry.head}\` in the checkout — read it before ruling on any prior finding.`,
      '',
    );
  }
  out.push(intentBlock(dir, run), '', issueBlock(issue), '', ...(resolvedGuidance(tree, items) ? [resolvedGuidance(tree, items), ''] : []), '## Your items', '');
  if (fresh.length > 0) {
    out.push(`### New candidates (${fresh.length})`, '', '```json', JSON.stringify(fresh.map(({ prior: _p, mergedFrom: _m, ...c }) => c), null, 2), '```', '');
  }
  if (prior.length > 0) {
    out.push(
      `### Prior open majors (${prior.length}) — each needs a ruling`,
      '',
      '```json',
      JSON.stringify(prior.map(({ prior: _p, ...f }) => f), null, 2),
      '```',
      '',
    );
  }
  out.push(
    '## How to rule',
    '',
    methodSection('verifier'),
    '',
    '## You must not',
    '',
    'Never edit any file in the checkout and never post anything to GitHub. Never rule on an',
    'item that is not listed above, and never leave one unruled — a round with an unruled item',
    'registers nothing. Never refute for being "speculative": refute only from the code, with',
    'the line that proves it.',
    '',
    '## Deliver',
    '',
    `Write ONE JSON file to \`${verdictsPath(dir, lane, entry.round, n)}\`, exactly this shape:`,
    '',
    '    {',
    '      "verdicts": [',
    '        { "id": "c-1-2", "verdict": "CONFIRMED|PLAUSIBLE|REFUTED", "severity": "major|nit|pre-existing",',
    '          "introduced_by_diff": true, "quote": "<the line at the head commit, quoted>",',
    '          "line": <optional: corrected line>, "note": "<optional: one sentence>" },',
    '        { "id": "f-3fa9c2d1", "verdict": "fixed|still-open|withdrawn", "quote": "<the guard, the changed line, or the line that still fails>",',
    '          "line": <optional: where it lives now>, "note": "<required when ruling on a dispute>" }',
    '      ]',
    '    }',
    '',
    'One entry per item, every item. `severity` is required for a CONFIRMED or PLAUSIBLE candidate',
    'and ignored for a REFUTED one. `quote` is required on every entry.',
    '',
    progressBlock(activePath(dir, 'progress', `${lane.slug}-review-r${entry.round}-verifier-${n}.log`), run),
    '',
    doneBlock(run, 'the verdicts file', verdictsPath(dir, lane, entry.round, n)),
    '',
  );
  return out.join('\n');
}

export function writeVerifierBriefs(dir, run, lane, entry, { batches, issue }) {
  const dispatch = verifierProfile(run);
  return batches.map((items, i) => {
    const n = i + 1;
    const path = verifierBriefPath(dir, lane, entry.round, n);
    prepareOutputs(dir, run, [path, verdictsPath(dir, lane, entry.round, n), activePath(dir, 'progress', `${lane.slug}-review-r${entry.round}-verifier-${n}.log`)]);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderVerifierBrief(dir, run, lane, entry, n, { items, issue }));
    recordDispatch(dir, run, path, [verdictsPath(dir, lane, entry.round, n)]);
    return { n, ...dispatch, prompt: path, writes: verdictsPath(dir, lane, entry.round, n), items: items.length };
  });
}

// ---------------------------------------------------------------------------
// Fixer.
// ---------------------------------------------------------------------------

export function renderFixBrief(dir, run, lane, entry, { items, checks, model, issue }) {
  const tree = laneTree(dir, run, lane);
  const step = findStep(run, 'implement', lane.slug);
  const out = [
    `# issueflow fix brief — round ${entry.round}`,
    '',
    `You are the **fixer** for round ${entry.round} of the review of pull request #${lane.pr.number} on`,
    `\`${run.repo.owner}/${run.repo.name}\`, lane \`${lane.slug}\`. Reviewers have posted findings on the pull request;`,
    'your job is to change the work so they no longer hold, and to say what you did with each.',
    '',
    ...coldStart,
    '',
    '## Working context',
    '',
    bar(['Field', 'Value'], [
      ['work in', tree],
      ['repository', run.repo.path],
      ['branch', lane.branch],
      ['base branch', lane.base],
      ['head reviewed', entry.head],
      ['pull request', lane.pr.url],
      ['evidence file', evidencePath(dir, step)],
      ['work item', run.split ? `${lane.slug} — ${lane.title}` : 'the whole issue'],
    ]),
    '',
    '`work in` is a git worktree of the repository, checked out on this lane\'s branch. Run every',
    'command there; the user\'s own checkout is a different directory and may hold uncommitted',
    'work, so do not touch it.',
    '',
    intentBlock(dir, run),
    '',
    issueBlock(issue),
    '',
    `## Open findings (${items.length})`,
    '',
  ];
  const guidance = resolvedGuidance(tree, items.length ? items : null);
  if (guidance) out.splice(out.length - 2, 0, guidance, '');
  for (const f of items) {
    out.push(
      `### \`${f.id}\` — ${f.severity} — \`${f.file}:${f.line}\``,
      '',
      f.summary,
      '',
      `**Failure scenario.** ${f.failure_scenario}`,
    );
    if (f.quote) out.push('', `> ${f.quote.split('\n').join('\n> ')}`);
    if (f.suggestion) out.push('', 'Suggested replacement for that line:', '', '```', f.suggestion.replace(/\n$/, ''), '```');
    if (f.stillOpenRounds > 0) out.push('', `This finding has survived ${f.stillOpenRounds} fix round${f.stillOpenRounds === 1 ? '' : 's'} already — the previous fix did not remove the mechanism. Read the verifier's quote above before changing anything.`);
    if (f.disputeRuling) out.push('', `The previous fixer disputed this; the verifier ruled: ${f.disputeRuling}`);
    out.push('');
  }
  if (checks.length > 0) {
    out.push(
      '## Red checks',
      '',
      'These CI checks are failing on the pull request head. A red check is a major by construction:',
      '',
      bar(['Check', 'State', 'Link'], checks.map((c) => [c.name, c.bucket ?? c.state, c.link ?? '—'])),
      '',
    );
  }
  out.push(
    '## Your task',
    '',
    methodSection('fixer'),
    '',
    'Then push the branch: `git push origin ' + lane.branch + '` from the `work in` directory. The',
    'next round reviews what GitHub has, and refuses to start until the push has landed.',
    '',
    '## You must not',
    '',
    'Never weaken, skip or delete a test to clear a finding. Never `git add -A` or `git add .` —',
    'stage explicit paths. Never force-push. Never touch another lane\'s branch or worktree. Never',
    'reply on the pull request yourself — the fix report below is how your replies get posted.',
    '',
    '## Deliver',
    '',
    `Write ONE JSON file to \`${fixReportPath(dir, lane, entry.round)}\`, one entry per finding above:`,
    '',
    '    {',
    '      "f-3fa9c2d1": { "status": "fixed", "note": "<optional: what changed, one sentence>" },',
    '      "f-91be0c77": { "status": "not-changed", "note": "<required: why, one sentence>" }',
    '    }',
    '',
    `Also report, in the same file under the key \`"_summary"\`, one sentence naming the commit sha you pushed.`,
    '',
    progressBlock(activePath(dir, 'progress', `${lane.slug}-fix-r${entry.round}.log`), run),
    '',
    doneBlock(run, 'the fix report', fixReportPath(dir, lane, entry.round)),
    '',
  );
  return out.join('\n');
}

export function writeFixBrief(dir, run, lane, entry, { items, checks, model, issue }) {
  const path = fixBriefPath(dir, lane, entry.round);
  prepareOutputs(dir, run, [path, fixReportPath(dir, lane, entry.round), evidencePath(dir, findStep(run, 'implement', lane.slug)), activePath(dir, 'progress', `${lane.slug}-fix-r${entry.round}.log`)]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderFixBrief(dir, run, lane, entry, { items, checks, model, issue }));
  recordDispatch(dir, run, path, [fixReportPath(dir, lane, entry.round)]);
  const profile = dispatchProfile(run, items.some((item) => item.severity === 'major' && item.stillOpenRounds > 0) ? 'fixerEscalated' : 'fixer');
  return { ...profile, prompt: path, writes: fixReportPath(dir, lane, entry.round), items: items.length };
}

export { NIT_CAP };
