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
import { stage } from './stages.mjs';
import { artifactPath, briefPath, evidencePath, gateSteps } from './run.mjs';

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

function contextSection(dir, run, step) {
  const rows = [
    ['repo', run.repo.path],
    ['branch', step.lane ? step.lane.branch : '(no branch yet — this stage does not commit)'],
    ['base branch', step.lane ? step.lane.base : run.policy.base],
    ['work item', step.lane ? `${step.lane.slug} — ${step.lane.title}` : 'the whole issue'],
  ];
  if (step.stage.id === 'test') rows.push(['evidence file', evidencePath(dir, step)]);
  return ['## Working context', '', bar(['Field', 'Value'], rows)].join('\n');
}

/** Render the brief for one step. Pure given the run state and what is on disk. */
export function renderBrief(dir, run, step, issue) {
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

  out.push(
    '## Your task',
    '',
    ...declared.asks.map((line) => line),
    '',
    '## You must not',
    '',
    declared.forbids,
    '',
    contextSection(dir, run, step),
    '',
    '## Deliver',
    '',
    `Write your answer to \`${artifactPath(dir, step)}\`.`,
    '',
    `It must contain a section for each of: **${declared.requires.join('**, **')}**. The gate`,
    'reads for those names and refuses the stage without them.',
    '',
    'Return only the path you wrote and a two-line summary. Your prose is not the',
    'deliverable; the file is.',
    '',
  );
  return out.join('\n');
}

/** Write the brief and return everything the orchestrator needs to dispatch it. */
export function writeBrief(dir, run, step, issue) {
  const path = briefPath(dir, step);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderBrief(dir, run, step, issue));
  return {
    step: step.key,
    stage: step.stage.id,
    model: step.stage.model,
    agent: step.stage.agent,
    prompt: path,
    artifact: artifactPath(dir, step),
  };
}

/** The issue as the run froze it, so a brief never depends on the network twice. */
export function loadIssue(dir) {
  const path = join(dir, 'inputs', 'issue.json');
  if (!existsSync(path)) throw new Error(`no frozen issue at ${path} — the run was not started properly`);
  return JSON.parse(readFileSync(path, 'utf8'));
}
