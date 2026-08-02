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

/**
 * What a skill IS, independent of its subject. A name may spend one of these
 * without earning it from the description, because the kind of thing a skill is
 * and the job it does are different halves of the same name — `ghfactory` is a
 * factory for GitHub things, and only the GitHub half is in its description.
 */
export const ROLE_WORDS = new Set([
  'factory', 'builder', 'gen', 'generator', 'kit', 'tool', 'tools',
  'lint', 'linter', 'check', 'checker', 'audit', 'auditor',
  'report', 'reporter', 'eval', 'evals', 'log', 'flow', 'stats',
  'sync', 'watch', 'guard', 'fix', 'fixer', 'find', 'finder',
]);

/**
 * Abbreviations a name may use — each valid only when its expansion actually
 * appears in the spec's own text, so `gh` is earned by a description that says
 * GitHub and means nothing in one that does not.
 */
export const ABBREVS = { gh: 'github', ci: 'ci', pr: 'pull', db: 'database', ui: 'ui', io: 'io' };

/**
 * Words that carry no subject. Without this list a name is trivially earned by
 * the grammar around the description rather than by the description: "forge"
 * was accepted on its first run here because "verified, not hoped for" supplied
 * the stem "for".
 */
export const STOPWORDS = new Set([
  'the', 'and', 'for', 'not', 'but', 'all', 'any', 'one', 'out', 'its', 'are', 'was', 'you',
  'your', 'this', 'that', 'with', 'from', 'into', 'them', 'they', 'has', 'have', 'been', 'than',
  'then', 'when', 'what', 'which', 'who', 'how', 'why', 'use', 'uses', 'used', 'using', 'user',
  'asks', 'wants', 'says', 'over', 'only', 'every', 'each', 'both', 'never', 'always', 'someone',
]);

/**
 * The shortest described word that may seed a longer name segment. Three-letter
 * stems match far too much — the direction "the name extends a described word"
 * is where a metaphor sneaks in, so it has to be earned by a real word.
 */
export const MIN_STEM = 4;

/** Every word ≥3 chars the spec uses to describe itself. */
function vocabulary(spec) {
  const text = [
    spec.summary,
    spec.description,
    spec.oneRule,
    ...(spec.commands ?? []).map((c) => `${c?.name ?? ''} ${c?.does ?? ''}`),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const words = (text.match(/[a-z]{3,}/g) ?? []).filter((w) => !STOPWORDS.has(w));
  return { text, tokens: new Set(words) };
}

/**
 * A piece is earned when it shares a prefix with a described word: it may be a
 * prefix of one (`skill` of "skills", `repo` of "repository"), or it may extend
 * one (`logger` from "log") — but only a stem of MIN_STEM or more may be
 * extended, or every three-letter fragment in the prose starts spelling names.
 */
const earned = (piece, tokens) => {
  for (const t of tokens) {
    if (t.startsWith(piece)) return true;
    if (t.length >= MIN_STEM && piece.startsWith(t)) return true;
  }
  return false;
};

/** Can this segment be spelled entirely out of words the spec already uses? */
function covers(segment, text, tokens) {
  const n = segment.length;
  const reachable = new Array(n + 1).fill(false);
  reachable[0] = true;
  for (let i = 0; i < n; i++) {
    if (!reachable[i]) continue;
    for (let j = i + 2; j <= n; j++) {
      const piece = segment.slice(i, j);
      if (piece.length === 2) {
        const expansion = ABBREVS[piece];
        if (!expansion || !text.includes(expansion)) continue;
      } else if (!(/^\d+$/.test(piece) || ROLE_WORDS.has(piece) || earned(piece, tokens))) {
        continue;
      }
      reachable[j] = true;
    }
  }
  return reachable[n];
}

/**
 * Does the name say what the skill does?
 *
 * A name is the only part of a skill a person sees before deciding whether to
 * use it, and a metaphor says nothing: `forge`, `assay` and `smith` all shipped
 * here and all had to be renamed to `ghfactory`, `eval` and `skillfactory`,
 * which is why this is a check and not a suggestion. Returns the segments that
 * appear nowhere in what the spec says the skill is for.
 */
export function nameCoverage(name, spec) {
  const { text, tokens } = vocabulary(spec);
  const uncovered = String(name ?? '')
    .split('-')
    .filter(Boolean)
    .filter((segment) => !covers(segment, text, tokens));
  return { ok: uncovered.length === 0, uncovered };
}

export const SPEC_TEMPLATE = (name) => ({
  $comment:
    'The name must say what the skill does — every part of it has to appear in the summary or description below, ' +
    'give or take a role word like "factory" or "report". A metaphor reads well and tells a user nothing.',
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
  } else {
    const coverage = nameCoverage(spec.name, spec);
    if (!coverage.ok) {
      problems.push(
        problem(
          'name',
          `"${coverage.uncovered.join('", "')}" appears nowhere in what this skill says it does — ` +
            'name it after the job, not a metaphor (forge → ghfactory, assay → eval, smith → skillfactory ' +
            'were all renamed for exactly this)',
        ),
      );
    }
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
