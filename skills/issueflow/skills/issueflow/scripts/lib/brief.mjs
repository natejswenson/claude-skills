/**
 * The dispatch prompt — rendered, never improvised.
 *
 * A subagent starts cold: it sees no conversation, no file the orchestrator
 * read, no decision already made. The prompt is the ONLY channel across that
 * boundary, which makes an improvised prompt the single highest-variance part
 * of a multi-agent run — and the part nobody reviews, because it never lands on
 * disk.
 *
 * So it lands on disk. The brief is built from the run state and the approved
 * artifacts by this file alone, which is why the baseline can byte-compare it
 * and catch a stage brief that silently stopped carrying the design.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PER_ITEM_STAGES, stage } from './stages.mjs';
import { artifactPath, briefPath, evidencePath, gateSteps, progressPath } from './run.mjs';
import {
  BLOCKING, REVIEW_FORBIDS, REVIEW_REQUIRES, review, reviewBriefPath, reviewPath, reviewProgressPath,
} from './reviews.mjs';

const bar = (headers, rows) =>
  [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

/** The issue, as the subagent's ground truth. Comments included — the fix is often in them. */
function issueSection(issue) {
  const lines = [`## The issue — #${issue.number}`, '', `**${issue.title}**`];
  if (issue.url) lines.push('', `<${issue.url}>`);
  lines.push('', (issue.body ?? '').trim() || '_(the issue has no body)_');
  const comments = issue.comments ?? [];
  if (comments.length > 0) {
    lines.push('', `### Comments (${comments.length})`, '');
    for (const c of comments) {
      lines.push(`**${c.author?.login ?? 'someone'}:**`, '', (c.body ?? '').trim(), '');
    }
  }
  return lines.join('\n');
}

/**
 * Every approved artifact this stage inherits, as paths.
 *
 * Paths rather than inlined text on purpose: the subagent has file access, and
 * a brief that copies its predecessor's prose is a second copy that drifts. The
 * instruction to read them first is what makes the path a channel instead of a
 * footnote.
 */
function inheritedSection(dir, run, step) {
  const steps = gateSteps(run);
  const index = steps.findIndex((s) => s.key === step.key);
  const rows = steps
    .slice(0, index)
    .filter((s) => s.stage.state === 'approved')
    .map((s) => [s.stage.id, artifactPath(dir, s)]);
  if (rows.length === 0) return null;
  return [
    '## Read these first — they are the decisions you inherit',
    '',
    bar(['Stage', 'Path'], rows),
    '',
    'Read every one before you touch anything else. They were approved by the user;',
    'you are implementing them, not revisiting them. If one is wrong, say so and stop —',
    'do not quietly design around it.',
  ].join('\n');
}

/**
 * Where the stage works, and on what.
 *
 * `workdir` is the lane's own git worktree when it has one. Naming it here is
 * what keeps two concurrent lanes — and the test stage's revert-and-rerun proof
 * — out of the user's live checkout. A stage that is handed a worktree must not
 * wander back to the main repo, so the row says which one is which.
 */
function contextSection(dir, run, step, workdir) {
  const rows = [
    ['work in', workdir ?? run.repo.path],
    ['repository', run.repo.path],
    ['branch', step.lane ? step.lane.branch : '(no branch yet — this stage does not commit)'],
    ['base branch', step.lane ? step.lane.base : run.policy.base],
    ['work item', step.lane ? `${step.lane.slug} — ${step.lane.title}` : 'the whole issue'],
  ];
  if (step.stage.id === 'test') rows.push(['evidence file', evidencePath(dir, step)]);
  const out = ['## Working context', '', bar(['Field', 'Value'], rows)];
  if (workdir && workdir !== run.repo.path) {
    out.push(
      '',
      '`work in` is a git worktree of the same repository, checked out on this',
      'lane\'s branch. Run every command there. It shares the repository\'s history,',
      'so a commit you make in it is a commit on the branch — but the user\'s own',
      'checkout is a different directory and may hold uncommitted work, so do not',
      'touch it.',
    );
  }
  return out.join('\n');
}

/**
 * The red team's refusal, carried back into the stage's re-brief.
 *
 * This is the seam a refused stage used to lack: before it, a re-brief
 * rendered byte-identically to the first one and the refusal existed only in
 * the conversation. The blocking findings render as a table; the full review
 * crosses as a path, like every other artifact.
 */
function feedbackSection(dir, run, step) {
  const rounds = step.stage.review?.rounds ?? [];
  const latest = rounds.at(-1);
  if (!step.stage.review?.feedback || latest?.verdict !== 'blocked') return null;
  const blocking = (latest.items ?? []).filter((f) => BLOCKING.includes(f.severity));
  const notes = (latest.items ?? []).length - blocking.length;
  // A round the user re-opened past the cap carries their direction verbatim —
  // it is the reason this round exists, and the stage must not have to guess it.
  const override = (step.stage.review?.overrides ?? []).find((o) => o.round === latest.round + 1);
  const directed = override
    ? ['', '## The user directed this round', '', override.reason]
    : [];
  return [
    `## Review feedback — round ${latest.round + 1}`,
    '',
    `A red-team review refused your round-${latest.round} artifact. Read`,
    `\`${join(dir, step.stage.review.feedback)}\` first — it is the full review.`,
    '',
    bar(['Severity', 'Cite', 'Finding'], blocking.map((f) => [f.severity, f.cite, f.text])),
    ...(notes > 0 ? ['', `It also holds ${notes} non-blocking note${notes === 1 ? '' : 's'} — read them, fix what is cheap.`] : []),
    '',
    'Fix each blocking finding by changing the work, and update your artifact in',
    'place. Do not argue with the review inside the artifact, and do not delete',
    'sections to make findings unciteable — the next round re-hunts everything',
    'from scratch.',
    ...directed,
  ].join('\n');
}

/** Render the brief for one step. Pure given the run state and what is on disk. */
export function renderBrief(dir, run, step, issue, workdir = null) {
  const declared = stage(step.stage.id);
  const out = [
    `# issueflow brief — ${declared.title}`,
    '',
    `You are the **${step.stage.id}** stage of an issueflow run on ` +
      `\`${run.repo.owner}/${run.repo.name}\` issue #${run.issue.number}.`,
    '',
    'You are running cold: you cannot see the conversation that dispatched you, and',
    'nothing you were not handed here exists for you. Everything you need is below or',
    'named by a path below.',
    '',
    issueSection(issue),
    '',
  ];

  const inherited = inheritedSection(dir, run, step);
  if (inherited) out.push(inherited, '');

  // Rendered only when a blocked round exists, so a run that never sees the
  // red team renders byte-identically to one produced before reviews existed —
  // the same conditionality that keeps the frozen checkpoint comment stable.
  const feedback = feedbackSection(dir, run, step);
  if (feedback) out.push(feedback, '');

  out.push(
    '## Your task',
    '',
    ...declared.asks.map((line) => line),
    '',
    '## You must not',
    '',
    declared.forbids,
    '',
    contextSection(dir, run, step, workdir),
    '',
    '## Deliver',
    '',
    `Write your answer to \`${artifactPath(dir, step)}\`.`,
    '',
    `It must contain a section for each of: **${declared.requires.join('**, **')}**. The gate`,
    'reads for those names and refuses the stage without them.',
    '',
    '## While you work',
    '',
    `Append one short lowercase line to \`${progressPath(dir, step)}\` whenever you`,
    'reach a real milestone — what you just found, or what you are about to do next.',
    'This is scratch work for whoever is watching the run, not part of your answer:',
    'nobody reads it as prose, and it is never quoted back to you. Skip it if you',
    'genuinely have nothing to report yet; do not pad it to look busy.',
    '',
    '## When you are done',
    '',
    'The moment the artifact is written, send the orchestrator a message with',
    '`SendMessage`, addressed to `main` — the agent that dispatched you. The message',
    "is the artifact's path, then two or three sentences of result: what you found,",
    'decided, or changed. Send it before you finish your turn. An agent that goes',
    'idle without sending one leaves the orchestrator unable to tell a finished',
    "stage from a stalled one. If your harness names the dispatching agent something",
    'other than `main`, send it to that name instead.',
    '',
  );
  return out.join('\n');
}

/** Write the brief and return everything the orchestrator needs to dispatch it. */
export function writeBrief(dir, run, step, issue, workdir = null) {
  const path = briefPath(dir, step);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderBrief(dir, run, step, issue, workdir));
  return {
    step: step.key,
    stage: step.stage.id,
    model: step.stage.model,
    agent: step.stage.agent,
    prompt: path,
    artifact: artifactPath(dir, step),
    progress: progressPath(dir, step),
    workdir: workdir ?? run.repo.path,
  };
}

/**
 * Render a red-team review brief. Same skeleton as a stage brief — cold-start
 * preamble, the issue, paths not pasted text, the SendMessage completion
 * contract — because a reviewer is a subagent like any other, and the brief is
 * still the only channel across the boundary.
 */
export function renderReviewBrief(dir, run, step, issue, round, workdir = null) {
  const declared = review(step.stage.id);
  const isCodeStage = PER_ITEM_STAGES.includes(step.stage.id);
  const artifact = artifactPath(dir, step);
  const out = [
    `# issueflow red-team brief — ${declared.title} (round ${round})`,
    '',
    `You are the **red-team reviewer** of the ${step.stage.id} stage of an issueflow run on ` +
      `\`${run.repo.owner}/${run.repo.name}\` issue #${run.issue.number}. Your job is to find what the`,
    'stage missed. You are the gate: nothing you pass here gets a second look, so hunt',
    'like the defect is in there and you have not found it yet.',
    '',
    'You are running cold: you cannot see the conversation that dispatched you, and',
    'nothing you were not handed here exists for you. Everything you need is below or',
    'named by a path below.',
    '',
    issueSection(issue),
    '',
    '## The artifact under review',
    '',
    `\`${artifact}\``,
    '',
    'Read all of it. This is the work you are attacking — not editing, not improving,',
    'attacking. Round ' + round + ' of at most 3.',
    '',
  ];

  const inherited = inheritedSection(dir, run, step);
  if (inherited) out.push(inherited, '');

  out.push(
    '## Your hunt',
    '',
    ...declared.asks,
    '',
    '## You must not',
    '',
    REVIEW_FORBIDS,
    '',
    contextSection(dir, run, step, workdir),
    '',
  );
  if (isCodeStage && step.lane) {
    out.push(
      `The diff you are reviewing: run \`git diff ${step.lane.base}...HEAD\` in the`,
      '`work in` directory. The report may summarize it; the diff is the truth.',
      '',
    );
  }
  out.push(
    '## Findings format',
    '',
    'Every finding is ONE line under `## Findings`, exactly:',
    '',
    '    - [critical|high|medium|low] <citation> — <one-sentence finding>',
    '',
    'The citation must be one of:',
    '',
    `- \`path:line\` (or \`path:l1-l2\`) — a real file, in the ${isCodeStage ? 'worktree or repository' : 'repository'};`,
    `- \`${step.stage.artifact} § <Heading>\` — a heading that exists in the artifact under review;`,
    ...(isCodeStage ? ['- `diff:<path>` — a file that appears in the diff named above.'] : []),
    '',
    'A citation that does not resolve refuses your whole review — cite what you can',
    'point at, and put what you cannot prove in `## Not examined`. Severity is the',
    'gate: critical and high block the stage; medium and low are notes. Rate what the',
    'finding costs if shipped, not how strongly you feel about it.',
    '',
    '## Deliver',
    '',
    `Write your review to \`${reviewPath(dir, step, round)}\`.`,
    '',
    `It must contain a section for each of: **${REVIEW_REQUIRES.join('**, **')}**.`,
    '`## Not examined` names what you did not check — a clean review that examined',
    'everything still says so there. `## Verdict` is one word, `pass` or `blocked`,',
    'and it must agree with your own severities: any critical or high finding means',
    '`blocked`.',
    '',
    '## While you work',
    '',
    `Append one short lowercase line to \`${reviewProgressPath(dir, step, round)}\` whenever you`,
    'reach a real milestone — what you just found, or what you are about to check next.',
    'This is scratch work for whoever is watching the run, not part of your answer:',
    'nobody reads it as prose, and it is never quoted back to you. Skip it if you',
    'genuinely have nothing to report yet; do not pad it to look busy.',
    '',
    '## When you are done',
    '',
    'The moment the review is written, send the orchestrator a message with',
    '`SendMessage`, addressed to `main` — the agent that dispatched you. The message',
    "is the review's path, then two or three sentences of result: your verdict and",
    'the worst thing you found. Send it before you finish your turn. An agent that',
    'goes idle without sending one leaves the orchestrator unable to tell a finished',
    'review from a stalled one. If your harness names the dispatching agent something',
    'other than `main`, send it to that name instead.',
    '',
  );
  return out.join('\n');
}

/** Write the review brief and return everything the orchestrator needs to dispatch it. */
export function writeReviewBrief(dir, run, step, issue, round, workdir = null) {
  const declared = review(step.stage.id);
  const path = reviewBriefPath(dir, step, round);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderReviewBrief(dir, run, step, issue, round, workdir));
  return {
    step: step.key,
    stage: step.stage.id,
    round,
    model: declared.model,
    agent: declared.agent,
    prompt: path,
    artifact: reviewPath(dir, step, round),
    progress: reviewProgressPath(dir, step, round),
    workdir: workdir ?? run.repo.path,
  };
}

/** The issue as the run froze it, so a brief never depends on the network twice. */
export function loadIssue(dir) {
  const path = join(dir, 'inputs', 'issue.json');
  if (!existsSync(path)) throw new Error(`no frozen issue at ${path} — the run was not started properly`);
  return JSON.parse(readFileSync(path, 'utf8'));
}
