/**
 * Turn one skill's own files into a card: five fixed sections, every fact
 * carrying the `file:line` it was read from.
 *
 * The five sections are fixed so a card is never "whatever this skill happened
 * to document". A section a skill has no source for stays EMPTY rather than
 * being padded — an empty Setup section is a true statement about the skill,
 * and padding it is how an index starts answering questions it cannot answer.
 */
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readLines, readJson, normalise, isNoise, mdSections, blocks, frontmatter, looksSecret, isPlaceholderHeading } from './md.mjs';

/**
 * Section headings, matched WHOLE.
 *
 * An unanchored /install/ matched "Why install this" and filled every Setup
 * section with marketing copy. Heading vocabulary in this repo is small and
 * knowable — matching it exactly is both more accurate and easier to extend
 * than a substring rule nobody can predict the blast radius of.
 */
const TITLE_RE = {
  setup: /^(requirements?|installation|install|setup|first-run setup|getting started|prerequisites?|configuration|configure|before you (start|begin))\b/i,
  usage: /^(quick start|usage|what you get|why install this|triggers?|the flow|how it works|when to use|modes?|running the scripts)\b/i,
  commands: /^(commands?|cli|command reference|reference|running the scripts|the commands)\b/i,
  architecture: /^(what.s here|what is here|architecture|anatomy|design|files?|tests?|modules?|structure|layout|maintainer reference|how it.s built)\b/i,
  troubleshooting: /^(troubleshooting|gotchas?|error handling|edge cases?|security rules|rules that|caveats?|limitations?|known issues?|what breaks|failure modes?|accuracy)\b/i,
};

export const SECTIONS = ['setup', 'usage', 'commands', 'architecture', 'troubleshooting'];

/** Per-section caps. A card is a routing surface, not a mirror of the repo:
 *  past these counts an extra fact adds noise to every question asked. */
const CAP = { setup: 12, usage: 12, commands: 20, architecture: 16, troubleshooting: 16 };

const CODE_DIRS = ['scripts', 'bin', 'lib'];
const CODE_EXT = /\.(mjs|js|cjs|py|sh|ts)$/;
const RUNNABLE = /^(node|npx|npm|python3?|gh|pytest|bash|sh)\b/;

const lineOf = (lines, needle) => lines?.find((l) => l.text.includes(needle))?.n ?? 1;

function walk(dir, out = [], depth = 0) {
  if (depth > 3 || !existsSync(dir)) return out;
  for (const e of readdirSync(dir).sort()) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out, depth + 1);
    else if (CODE_EXT.test(e)) out.push(p);
  }
  return out;
}

/** A collector that enforces the two things a fact must satisfy to be indexed:
 *  it carries a source, and it is not a secret. Both refusals are counted. */
function collector(repo) {
  const state = { secretsRefused: 0, sourceless: 0 };
  const add = (bucket, text, file, line) => {
    if (state.seen === undefined) state.seen = new Set();
    if (!file || !line) { state.sourceless += 1; return; }
    if (looksSecret(text)) { state.secretsRefused += 1; return; }
    if (isNoise(text)) return;
    const t = normalise(text);
    if (!t || isNoise(t)) return;
    const source = `${relative(repo, file)}:${line}`;
    // Deduped across the WHOLE card, not per section. A line that qualifies for
    // both Setup and Usage is one fact; showing it twice pads the card, and
    // makes a two-section hit look like corroboration when it is one source.
    if (state.seen.has(t)) return;
    state.seen.add(t);
    bucket.facts.push({ text: t, source });
  };
  return { state, add };
}

/**
 * `skill-invariants.json` `pattern` fields are REGEXES — the string a test
 * greps SKILL.md for, not a sentence. Indexed raw they read as
 * "[Nn]ever ask about anything in that table", which is machine syntax leaking
 * into an answer a person is meant to read.
 */
export function unregex(pattern) {
  return String(pattern)
    .replace(/\[([A-Za-z])[A-Za-z]*\]/g, '$1')
    .replace(/\(\?:/g, '(')
    .replace(/\\([.*+?^${}()|[\]\\])/g, '$1')
    .replace(/[\\^$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const bucketFor = (card, name) => ({ name, facts: card.sections[name] });

function pushSection(card, add, name, lines, file, re, limit) {
  if (!lines) return;
  const secs = mdSections(lines).filter((s) => re.test(s.title) && !isPlaceholderHeading(s.title));
  const bucket = bucketFor(card, name);
  for (const s of secs) {
    let taken = 0;
    for (const b of blocks(s.body)) {
      if (bucket.facts.length >= CAP[name] || taken >= (limit ?? 6)) break;
      const before = bucket.facts.length;
      add(bucket, b.text, file, b.line);
      if (bucket.facts.length > before) taken += 1;
    }
  }
}

export function extractSkill(repo, name) {
  const outer = join(repo, 'skills', name);
  const inner = join(outer, 'skills', name);
  const skillMdPath = join(inner, 'SKILL.md');
  const readmePath = join(outer, 'README.md');
  const changelogPath = join(outer, 'CHANGELOG.md');
  const pkgPath = join(inner, 'package.json');
  const invPath = join(inner, 'skill-invariants.json');
  const pluginPath = join(outer, '.claude-plugin', 'plugin.json');

  const skillMd = readLines(skillMdPath);
  const readme = readLines(readmePath);
  const changelog = readLines(changelogPath);
  const pkgLines = readLines(pkgPath);
  const invLines = readLines(invPath);
  const pkg = readJson(pkgPath);
  const inv = readJson(invPath);
  const plugin = readJson(pluginPath);

  const fm = frontmatter(skillMd);
  const stack = pkg ? 'node' : 'python';
  const version = pkg?.version ?? fm.version?.value ?? plugin?.version ?? 'unknown';

  const card = {
    name,
    version,
    stack,
    summary: fm.description?.value ?? plugin?.description ?? '',
    summarySource: fm.description ? `${relative(repo, skillMdPath)}:${fm.description.line}` : null,
    triggers: [],
    sections: Object.fromEntries(SECTIONS.map((s) => [s, []])),
  };

  // Trigger phrases are the quoted fragments in the SKILL.md description — the
  // only text a user's request is ever matched against, and so the highest-value
  // routing signal this skill has.
  for (const m of (card.summary ?? '').matchAll(/"([^"]{3,60})"/g)) card.triggers.push(m[1]);
  card.triggers = [...new Set(card.triggers)].sort();

  const { state, add } = collector(repo);

  // ---- Setup ---------------------------------------------------------------
  // Deliberately NOT "quick start": that section is a block of invocations, and
  // indexing it as Setup made "how do I set up gmailtriage" answer with four
  // commands and none of the credentials they need. Commands belong to Commands.
  pushSection(card, add, 'setup', readme, readmePath, TITLE_RE.setup, 8);
  pushSection(card, add, 'setup', skillMd, skillMdPath, TITLE_RE.setup, 6);
  if (pkg?.engines?.node) {
    add(bucketFor(card, 'setup'), `Requires Node ${pkg.engines.node} (package.json engines).`, pkgPath, lineOf(pkgLines, '"engines"'));
  }
  // Environment variables a run actually reads. A Setup answer that omits the
  // credential the skill needs is the most costly kind of incomplete.
  const envSeen = new Map();
  for (const file of CODE_DIRS.flatMap((d) => walk(join(inner, d)))) {
    const lines = readLines(file);
    if (!lines) continue;
    for (const l of lines) {
      for (const m of l.text.matchAll(/(?:process\.env\.([A-Z][A-Z0-9_]{3,})|process\.env\[['"]([A-Z][A-Z0-9_]{3,})['"]\]|os\.environ(?:\.get)?[.[(]\s*['"]([A-Z][A-Z0-9_]{3,})['"]|os\.getenv\(\s*['"]([A-Z][A-Z0-9_]{3,})['"])/g)) {
        const v = m[1] ?? m[2] ?? m[3] ?? m[4];
        if (v && !envSeen.has(v)) envSeen.set(v, { file, line: l.n });
      }
    }
  }
  for (const v of [...envSeen.keys()].sort()) {
    const { file, line } = envSeen.get(v);
    add(bucketFor(card, 'setup'), `Reads environment variable ${v}.`, file, line);
  }

  // ---- Usage ---------------------------------------------------------------
  if (fm.description) {
    add(bucketFor(card, 'usage'), `Triggers on: ${card.summary}`, skillMdPath, fm.description.line);
  }
  pushSection(card, add, 'usage', readme, readmePath, TITLE_RE.usage, 8);
  pushSection(card, add, 'usage', skillMd, skillMdPath, TITLE_RE.usage, 8);

  // ---- Commands ------------------------------------------------------------
  // Order matters: the invocations a person actually types come first, then
  // any Commands section prose, and package.json scripts LAST. Built the other
  // way round, "what commands does press have" led with `npm run postpack`.
  pushSection(card, add, 'commands', skillMd, skillMdPath, TITLE_RE.commands, 10);
  pushSection(card, add, 'commands', readme, readmePath, TITLE_RE.commands, 10);
  // Runnable lines inside fenced blocks, in both SKILL.md and the README. These
  // are the invocations a user copies, which is what "what commands does it
  // have" is nearly always asking for.
  for (const [lines, file] of [[skillMd, skillMdPath], [readme, readmePath]]) {
    if (!lines) continue;
    let fence = false;
    const bucket = bucketFor(card, 'commands');
    for (const l of lines) {
      if (/^\s*```/.test(l.text)) { fence = !fence; continue; }
      if (!fence || bucket.facts.length >= CAP.commands) continue;
      const t = l.text.trim().replace(/^\$\s*/, '');
      if (RUNNABLE.test(t)) add(bucket, t, file, l.n);
    }
  }

  if (pkg?.scripts) {
    for (const k of Object.keys(pkg.scripts).sort()) {
      add(bucketFor(card, 'commands'), `npm run ${k} — ${pkg.scripts[k]}`, pkgPath, lineOf(pkgLines, `"${k}":`));
    }
  }
  if (pkg?.bin) {
    for (const k of Object.keys(pkg.bin).sort()) {
      add(bucketFor(card, 'commands'), `Binary "${k}" → ${pkg.bin[k]}`, pkgPath, lineOf(pkgLines, `"${k}":`));
    }
  }
  // ---- Architecture --------------------------------------------------------
  // The heading vocabulary is deliberately wide. Skills written before the
  // house settled on "What's here" say `## Files`, `## Tests` or `## Modules`
  // instead, and a narrow regex silently gave six of them an empty section.
  pushSection(card, add, 'architecture', skillMd, skillMdPath, TITLE_RE.architecture, 12);
  // The declared code/judgment split is the single best architecture source a
  // skill has: it is the author's own statement of which half is deterministic.
  for (const half of ['deterministic', 'nondeterministic']) {
    for (const e of inv?.split?.[half] ?? []) {
      const label = half === 'deterministic' ? 'Deterministic' : 'Model judgment';
      const detail = e.command ?? e.why ?? '';
      add(bucketFor(card, 'architecture'), `${label}: ${e.step}${detail ? ` — ${detail}` : ''}`, invPath, lineOf(invLines, e.step));
    }
  }
  // Older invariants files declare `code` / `cli_commands_referenced` rather
  // than `split`. Same statement, earlier spelling.
  for (const e of inv?.code ?? []) {
    const text = typeof e === 'string' ? e : `${e.id ?? e.step ?? ''} — ${e.rationale ?? e.why ?? e.pattern ?? ''}`;
    add(bucketFor(card, 'architecture'), `Enforced in code: ${text}`, invPath, lineOf(invLines, typeof e === 'string' ? e : (e.id ?? e.step ?? '')));
  }
  // Last resort, and still grounded: the modules the skill actually ships. A
  // file list is a weaker architecture answer than a declared split, but it is
  // a TRUE one — and it is what stops the section being empty for a skill that
  // simply never wrote its design down.
  if (card.sections.architecture.length === 0) {
    const bucket = bucketFor(card, 'architecture');
    for (const file of CODE_DIRS.flatMap((d) => walk(join(inner, d)))) {
      if (bucket.facts.length >= CAP.architecture) break;
      if (/[.\/]test\./.test(file)) continue;
      add(bucket, `Ships module ${relative(inner, file)}.`, file, 1);
    }
  }

  // ---- Troubleshooting -----------------------------------------------------
  // The invariants prose first, deliberately. It is the only place a skill
  // records the guardrails no code enforces — which is what a "why did this go
  // wrong" question is actually about. Changelog lines come last and capped:
  // "what broke once" is weak evidence for "what to do when it fails".
  for (const p of inv?.prose ?? []) {
    add(bucketFor(card, 'troubleshooting'), `${unregex(p.pattern)} — ${p.rationale}`, invPath, lineOf(invLines, p.pattern));
  }
  pushSection(card, add, 'troubleshooting', skillMd, skillMdPath, TITLE_RE.troubleshooting, 10);
  pushSection(card, add, 'troubleshooting', readme, readmePath, TITLE_RE.troubleshooting, 8);
  if (skillMd) {
    const bucket = bucketFor(card, 'troubleshooting');
    for (const l of skillMd) {
      if (bucket.facts.length >= CAP.troubleshooting) break;
      if (/^\s*[-*]?\s*\*\*Never\b/.test(l.text)) add(bucket, l.text, skillMdPath, l.n);
    }
  }
  if (changelog) {
    const bucket = bucketFor(card, 'troubleshooting');
    let fixes = 0;
    for (const l of changelog) {
      if (fixes >= 4 || bucket.facts.length >= CAP.troubleshooting) break;
      if (/^\s*[-*]\s+/.test(l.text) && /\bfix(ed|es)?\b/i.test(l.text)) {
        const before = bucket.facts.length;
        add(bucket, `Previously fixed: ${l.text.trim().replace(/^[-*]\s+/, '')}`, changelogPath, l.n);
        if (bucket.facts.length > before) fixes += 1;
      }
    }
  }

  for (const s of SECTIONS) card.sections[s] = card.sections[s].slice(0, CAP[s]);
  card.secretsRefused = state.secretsRefused;
  card.sourcelessDropped = state.sourceless;
  card.factCount = SECTIONS.reduce((n, s) => n + card.sections[s].length, 0);
  card.emptySections = SECTIONS.filter((s) => card.sections[s].length === 0);
  return card;
}

/** Every skill directory in the repo, sorted. The floor that stops a resolver
 *  matching nothing lives in the callers, not here. */
export function listSkillNames(repo) {
  const dir = join(repo, 'skills');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((e) => !e.startsWith('.') && statSync(join(dir, e)).isDirectory())
    .filter((e) => existsSync(join(dir, e, 'skills', e, 'SKILL.md')))
    .sort();
}
