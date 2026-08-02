/**
 * The spec — one page that decides whether the skill is any good.
 *
 * Everything downstream is mechanical. The spec is where the judgment lives:
 * what the skill refuses to do, which half of it is code, and what a real run
 * looks like. Validation here is deliberately harsher than the CI lints,
 * because CI grades a finished skill and this grades an intention — the only
 * moment the cost of a bad answer is still zero.
 */
import { DESCRIPTION_FLOOR, gradeDescription } from './conform.mjs';

export const NAME_RE = /^[a-z][a-z0-9-]{1,30}$/;
export const KINDS = new Set(['golden', 'trap', 'corpus']);

export const SPEC_TEMPLATE = (name) => ({
  name,
  summary: 'One line. What it does, in the voice of a person, not a feature list.',
  description:
    'The trigger sentence. This is the ONLY text a user\'s request is matched against, so it must name the ' +
    'concrete phrases someone would actually type — "do the thing", "fix my thing" — not a category.',
  oneRule:
    'The single sentence this skill refuses to violate. If you cannot write it, the skill does not have a point yet.',
  stack: 'node',
  npmPublish: false,
  commands: [{ name: 'detect', does: 'what one command returns, already shaped as a table' }],
  split: {
    deterministic: [{ step: 'the mechanical part', command: 'node scripts/<name>.js detect' }],
    nondeterministic: [{ step: 'the judgment part', why: 'intent no file records' }],
  },
  references: [{ file: 'anatomy.md', is: 'the fixed shape of what this skill produces' }],
  evalPlan: [
    {
      id: 'the-real-run',
      kind: 'golden',
      pinnedAgainst: 'a real run of this skill, frozen — never a synthetic fixture',
      catches: 'what silently breaking would look like',
    },
  ],
});

const problem = (field, why) => ({ field, why });

/**
 * Validate a spec. Returns {ok, problems}. Every rule here is one that, if
 * waived, produces a skill that passes CI and is still bad.
 */
export function validateSpec(spec, house = null) {
  const problems = [];
  if (!spec || typeof spec !== 'object') return { ok: false, problems: [problem('spec', 'not an object')] };

  if (!NAME_RE.test(spec.name ?? '')) {
    problems.push(problem('name', 'must be lowercase kebab, 2-31 chars — it becomes the directory, the tag prefix and the check name'));
  } else if (house?.skills?.includes(spec.name)) {
    problems.push(problem('name', `skills/${spec.name} already exists — a collision would overwrite a shipped skill`));
  }

  const desc = gradeDescription(spec.description);
  if (!desc.ok) problems.push(problem('description', desc.why ?? `needs ${DESCRIPTION_FLOOR}+ chars and 2+ quoted trigger phrases`));

  if (!spec.summary || spec.summary.length < 20) {
    problems.push(problem('summary', 'needs a one-line summary — it becomes plugin.json, package.json and the README row'));
  }

  if (!spec.oneRule || spec.oneRule.length < 20) {
    problems.push(problem('oneRule', 'every skill states the one thing it refuses to do; without it there is nothing to hold the skill to'));
  }

  if (!['node', 'python'].includes(spec.stack)) {
    problems.push(problem('stack', 'must be "node" or "python"'));
  }

  const det = spec.split?.deterministic ?? [];
  const non = spec.split?.nondeterministic ?? [];
  if (det.length === 0 || non.length === 0) {
    problems.push(
      problem('split', 'declare both halves — a skill that is all model is unrepeatable, and one that is all code is not a skill'),
    );
  }
  for (const entry of det) {
    if (!entry.command) problems.push(problem('split.deterministic', `"${entry.step ?? '?'}" names no command — then it is not deterministic`));
  }
  for (const entry of non) {
    if (!entry.why) problems.push(problem('split.nondeterministic', `"${entry.step ?? '?'}" gives no reason a model is needed`));
  }

  const evals = spec.evalPlan ?? [];
  if (evals.length === 0) {
    problems.push(problem('evalPlan', 'no baseline planned — lint_baseline.py fails the PR, and a skill with no eval degrades invisibly'));
  }
  for (const e of evals) {
    if (!KINDS.has(e.kind)) problems.push(problem('evalPlan', `"${e.id ?? '?'}" kind must be one of ${[...KINDS].join(', ')}`));
    if (!e.pinnedAgainst) problems.push(problem('evalPlan', `"${e.id ?? '?'}" says nothing about what it is pinned against`));
    if (e.kind === 'corpus' && !(e.minCorpus > 0)) {
      problems.push(problem('evalPlan', `"${e.id ?? '?'}" is a corpus check with no minCorpus — a glob that matches nothing must go red, not green`));
    }
  }
  if (evals.length > 0 && !evals.some((e) => e.kind === 'trap')) {
    problems.push(problem('evalPlan', 'no two-sided case — a baseline that only asserts good-input-passes rots the day someone weakens the checker'));
  }

  if (!Array.isArray(spec.commands) || spec.commands.length === 0) {
    problems.push(problem('commands', 'at least one CLI command — the deterministic half needs an entry point'));
  }

  return { ok: problems.length === 0, problems };
}
