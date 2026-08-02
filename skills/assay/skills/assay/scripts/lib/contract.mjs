/**
 * The rubric — every rule a skill actually committed to, as citable clauses.
 *
 * A grade is only as honest as the rubric it was scored against, and the one
 * rubric nobody can dispute is the one the skill wrote down itself. So nothing
 * here is invented: every clause is lifted verbatim out of a committed file and
 * carries the `file:line` it came from. A finding cites a clause id; the clause
 * id resolves to bytes on disk. That chain is the whole reason this skill is
 * allowed to say a run was wrong.
 *
 * What is deliberately NOT a clause: prose that explains, motivates or
 * illustrates. A rule is an imperative the skill bound itself to — "never do
 * X", "always do Y". Grading against commentary produces findings nobody can
 * act on, which is how a report stops being read.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A bolded span is a candidate rule; these words make it an actual one. */
const PROHIBITION = /\b(never|always|must|do not|don't|refuse|only ever|no exceptions)\b/i;

/**
 * Rules are not only phrased as prohibitions. "Announce the skill once" binds
 * a skill exactly as tightly as "never announce twice", and an extractor that
 * only reads negatives silently grades half a contract — the worse half, since
 * the positive form is what most skills use for their required steps.
 *
 * This is a recall heuristic, not a parser. It will miss imperatives phrased
 * with verbs outside this list, which is precisely why every report states its
 * coverage gap instead of implying the rubric was complete.
 */
const IMPERATIVE_VERB =
  /^(announce|keep|report|show|say|use|run|read|write|ask|wait|pin|prove|declare|treat|land|delete|hold|stop|add|set|check|verify|freeze|fix|emit|ship|branch|bump|follow|prefer|avoid|ensure|confirm|flag|scale|resolve|state|name|cite|grade|capture|record|leave|put|make|give|start)\b/i;

/**
 * The contrastive form — "one script call, not a pipeline", "floors, not
 * equality", "show, don't describe". It states the rule by naming the thing it
 * rules out, and it is common enough in these contracts that missing it drops
 * real clauses on the floor.
 */
const CONTRASTIVE = /,\s*(not|never)\s+\S/i;

const isRule = (text) => PROHIBITION.test(text) || IMPERATIVE_VERB.test(text) || CONTRASTIVE.test(text);

/** Invariant patterns are regex bait, so they carry markdown the rule does not. */
const unemphasise = (s) => s.replace(/\\?\*{1,2}/g, '').replace(/\s+/g, ' ').trim();

/** Shortest text that can carry a rule. Below this it is a label, not a clause. */
const MIN_CLAUSE = 15;
const MAX_CLAUSE = 400;

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const sha8 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8);

/** Stable across reordering: the id is a function of the text, not the position. */
export const clauseId = (tag, text) => `${tag}-${sha8(norm(text).toLowerCase())}`;

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

/**
 * Where a press-generated region starts and ends. Rules inside one are the
 * shared house contract rather than this skill's own promises, so they are
 * tagged separately — a run that breaks the presentation contract and a run
 * that breaks the skill's own rule are not the same severity of wrong.
 */
function pressRanges(source) {
  const ranges = [];
  const re = /<!--\s*>>>\s*press:[\s\S]*?<!--\s*<<<\s*press:[^>]*-->/g;
  let m;
  while ((m = re.exec(source)) !== null) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

const inRange = (ranges, index) => ranges.some(([a, b]) => index >= a && index < b);

/** Every bolded imperative in a markdown source, as clauses. */
function boldClauses(source, file, { tag, pressTag = null, severity, pressSeverity = severity, slice = null }) {
  const ranges = pressTag ? pressRanges(source) : [];
  const region = slice ?? [0, source.length];
  const out = [];
  const re = /\*\*([\s\S]{5,400}?)\*\*/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    if (m.index < region[0] || m.index >= region[1]) continue;
    const text = norm(m[1]);
    if (text.length < MIN_CLAUSE || text.length > MAX_CLAUSE) continue;
    if (!isRule(text)) continue;
    const isPress = pressTag && inRange(ranges, m.index);
    out.push({
      id: clauseId(isPress ? pressTag : tag, text),
      tag: isPress ? pressTag : tag,
      text,
      severity: isPress ? pressSeverity : severity,
      source: { file, line: lineOf(source, m.index) },
    });
  }
  return out;
}

/** The section a heading opens, as a [start, end) byte range. */
function section(source, headingRe) {
  const m = source.match(headingRe);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = source.slice(start);
  const next = rest.search(/\n#{1,3} /);
  return [start, next === -1 ? source.length : start + next];
}

/**
 * Extract the contract for one skill. `repo` is the monorepo root; `name` the
 * skill directory. Returns {name, clauses, sources} — never throws on a missing
 * optional source, because a skill that ships no invariants file still has a
 * SKILL.md worth grading.
 */
export function extractContract(repo, name, { houseFile = 'CLAUDE.md' } = {}) {
  const skillDir = join(repo, 'skills', name, 'skills', name);
  const skillMdPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMdPath)) {
    throw new Error(`no SKILL.md at ${skillMdPath} — "${name}" is not a skill in this repo`);
  }

  const rel = (p) => p.slice(repo.length + 1);
  const clauses = [];
  const sources = [];

  const md = readFileSync(skillMdPath, 'utf8');
  sources.push(rel(skillMdPath));

  // The one rule outranks everything else the skill says about itself.
  const oneRule = section(md, /^#{2,3} The one rule\s*$/m);
  const oneRuleIds = new Set();
  if (oneRule) {
    for (const c of boldClauses(md, rel(skillMdPath), { tag: 'rule', severity: 'critical', slice: oneRule })) {
      oneRuleIds.add(norm(c.text).toLowerCase());
      clauses.push(c);
    }
  }

  for (const c of boldClauses(md, rel(skillMdPath), {
    tag: 'skill',
    pressTag: 'press',
    severity: 'high',
    pressSeverity: 'medium',
  })) {
    // A rule restated outside "The one rule" is the same rule, not a second one.
    if (oneRuleIds.has(norm(c.text).toLowerCase())) continue;
    clauses.push(c);
  }

  const invPath = join(skillDir, 'skill-invariants.json');
  if (existsSync(invPath)) {
    sources.push(rel(invPath));
    const inv = JSON.parse(readFileSync(invPath, 'utf8'));
    for (const rule of inv.prose ?? []) {
      clauses.push({
        id: clauseId('inv', rule.id),
        tag: 'inv',
        text: unemphasise(rule.pattern),
        severity: 'high',
        rationale: rule.rationale,
        source: { file: rel(invPath), line: 1 },
      });
    }
  }

  const housePath = join(repo, houseFile);
  if (existsSync(housePath)) {
    const house = readFileSync(housePath, 'utf8');
    const golden = section(house, /^#{2,3} Golden rules[^\n]*$/m);
    if (golden) {
      sources.push(houseFile);
      for (const c of boldClauses(house, houseFile, { tag: 'house', severity: 'high', slice: golden })) {
        clauses.push(c);
      }
    }
  }

  // Two committed files can state the same rule; one clause, cited once.
  const seen = new Set();
  let unique = clauses.filter((c) => (seen.has(c.id) ? false : seen.add(c.id)));

  // An invariant `pattern` is a fragment cut out of SKILL.md so a test can grep
  // for it. Left in, it becomes a second clause saying the same thing as the
  // sentence it was cut from — and a coverage gap padded with duplicates
  // overstates how much of the contract went unchecked.
  const prose = unique.filter((c) => c.tag !== 'inv').map((c) => unemphasise(c.text).toLowerCase());
  unique = unique.filter((c) => {
    if (c.tag !== 'inv') return true;
    const needle = unemphasise(c.text).toLowerCase();
    return !prose.some((p) => p.includes(needle));
  });

  unique.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { name, sources, clauses: unique };
}

export const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
