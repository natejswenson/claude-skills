/**
 * Route a question to the facts that can ground it.
 *
 * The contract this file exists to keep: an answer is either grounded facts
 * WITH sources, or the not-documented block. There is no third output, because
 * the third output is where a knowledge base starts inventing.
 *
 * It returns the matched fact lines inline rather than card paths, so the
 * common question costs one command and zero file reads.
 */
import { SECTIONS } from './extract.mjs';

const TITLES = { Setup: 'setup', Usage: 'usage', Commands: 'commands', Architecture: 'architecture', Troubleshooting: 'troubleshooting' };

/**
 * Generic interrogatives are NOT section signals.
 *
 * "what" sat in the Usage affinity list and hijacked two different questions:
 * it sent "what commands does press have" to Usage, and — worse — it pushed
 * "what is the retry limit in gmailtriage" over the section-listing threshold,
 * resurrecting a confident answer to a question the index cannot answer. A word
 * that appears in most questions discriminates between none of them.
 */
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'do', 'does', 'did', 'i', 'my', 'me', 'it', 'its', 'this', 'that', 'with', 'from', 'at', 'by', 'be', 'can', 'you', 'your', 'we', 'us', 'as', 'if', 'so', 'not', 'but', 'have', 'has', 'get', 'got', 'about', 'into', 'up', 'out', 'there', 'their', 'them', 'they', 'he', 'she']);

/** Words that say which of the five sections a question is really about. The
 *  affinity is a nudge, not a filter — a Setup question whose answer happens to
 *  live in Troubleshooting must still be reachable. */
const AFFINITY = {
  setup: ['setup', 'set', 'install', 'installing', 'configure', 'config', 'configuration', 'credential', 'credentials', 'token', 'auth', 'authenticate', 'key', 'env', 'environment', 'requirement', 'requirements', 'prerequisite', 'need', 'needs', 'depend', 'dependency', 'start', 'started'],
  usage: ['use', 'using', 'usage', 'trigger', 'triggers', 'invoke', 'workflow', 'flow', 'step', 'steps', 'example'],
  commands: ['command', 'commands', 'flag', 'flags', 'option', 'options', 'cli', 'subcommand', 'run', 'script', 'scripts', 'npm', 'argument', 'args', 'syntax'],
  architecture: ['architecture', 'architectural', 'internal', 'internals', 'design', 'designed', 'structure', 'built', 'build', 'code', 'deterministic', 'judgment', 'split', 'module', 'library', 'implementation'],
  troubleshooting: ['fail', 'fails', 'failing', 'failed', 'error', 'errors', 'broken', 'break', 'breaks', 'wrong', 'why', 'fix', 'fixing', 'debug', 'issue', 'issues', 'problem', 'red', 'stuck', 'never', 'refuse', 'refuses', 'rule', 'rules', 'gotcha', 'caveat', 'limitation', 'safe'],
};

/** Below this, a match is noise. The floor is what makes "no answer" a real
 *  outcome instead of a bottomless ranked list. */
export const FLOOR = 2;

export function terms(question) {
  return [...new Set(
    question.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  )];
}

/** Parse a rendered card back into facts. The card is the interchange format —
 *  ask never re-reads a skill's source, which is what keeps a question cheap. */
export function parseCard(text) {
  const out = { name: '', version: '', triggers: [], facts: [] };
  let section = null;
  for (const line of text.split('\n')) {
    const h1 = /^# (.+)$/.exec(line);
    if (h1) { out.name = h1[1].trim(); continue; }
    const h2 = /^## (.+)$/.exec(line);
    if (h2) { section = TITLES[h2[1].trim()] ?? null; continue; }
    const v = /^- \*\*version\*\* — (.+)$/.exec(line);
    if (v) { out.version = v[1].trim(); continue; }
    const tr = /^- \*\*triggers\*\* — (.+)$/.exec(line);
    if (tr) { out.triggers = [...tr[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]); continue; }
    if (!section || !line.startsWith('- ') || line.startsWith('- **') || line.startsWith('- _')) continue;
    const m = /^- (.*)\s`([^`]+:\d+)`$/.exec(line);
    if (m) out.facts.push({ section, text: m[1].trim(), source: m[2] });
  }
  return out;
}

/**
 * Two numbers, deliberately separated.
 *
 * `base` is CONTENT match only — how much of the question's substance this fact
 * actually contains. `rank` adds the section affinity and the named-skill
 * bonus. Only `base` is compared against the floor.
 *
 * Conflating them was a real defect, caught by dogfooding rather than review:
 * "what is the retry limit in gmailtriage" scored 10 and returned five
 * confident facts about gmailtriage, none of which mentioned a retry limit —
 * because naming the skill was worth +3 and the skill's own name appears in
 * nearly every line of its own card. The question has no answer in the index,
 * and the honest output is the not-documented block. A bonus must never be
 * able to lift a fact over the floor on its own.
 */
function scoreFact(fact, contentTerms, affinity, nameHit, triggerHit) {
  const hay = fact.text.toLowerCase();
  let base = 0;
  for (const term of contentTerms) {
    if (hay.includes(term)) base += term.length > 5 ? 2 : 1;
  }
  if (base === 0) return { base: 0, rank: 0 };
  let rank = base + (affinity[fact.section] ?? 0);
  if (nameHit) rank += 3;
  if (triggerHit) rank += 2;
  return { base, rank };
}

/**
 * @returns {{hits, withheld, searched, sections, factsSearched, nearest, named}}
 * `hits` above the floor, `nearest` the best sub-floor matches — which are what
 * makes a not-documented answer useful instead of merely honest.
 */
export function ask(cards, question, { limit = 10 } = {}) {
  const t = terms(question);
  // Affinity is weighted to actually decide ordering. At ±2 it lost to term
  // frequency, and "what commands does press have" answered out of Usage.
  const affinity = {};
  for (const s of SECTIONS) {
    const n = AFFINITY[s].filter((w) => t.includes(w)).length;
    if (n) affinity[s] = Math.min(6, n * 3);
  }
  const q = question.toLowerCase();
  const namedSet = new Set(cards.filter((c) => new RegExp(`\\b${c.name.toLowerCase()}\\b`).test(q)).map((c) => c.name));

  // A skill's own name appears throughout its own card, so as a CONTENT term it
  // matches everything and discriminates nothing. It is a routing signal, and
  // it is used as one — to scope the search, below — never as evidence that a
  // fact answers the question.
  const contentTerms = t.filter((w) => !namedSet.has(w));

  // Naming a skill scopes the question to it. "how do I set up gmailtriage"
  // has no business returning press facts, and a scoped miss is a truthful
  // answer — which is why the scope is disclosed in the output.
  const scope = namedSet.size ? cards.filter((c) => namedSet.has(c.name)) : cards;

  const scored = [];
  let factsSearched = 0;
  for (const c of scope) {
    const nameHit = namedSet.has(c.name);
    const triggerHit = c.triggers.some((tr) => q.includes(tr.toLowerCase()));
    for (const f of c.facts) {
      factsSearched += 1;
      const { base, rank } = scoreFact(f, contentTerms, affinity, nameHit, triggerHit);
      if (base > 0) scored.push({ skill: c.name, ...f, base, score: rank });
    }
  }
  scored.sort((a, b) => b.score - a.score || b.base - a.base || a.skill.localeCompare(b.skill) || a.source.localeCompare(b.source));

  // The floor is applied to `base`. A bonus can reorder results; it can never
  // manufacture one.
  const above = scored.filter((f) => f.base >= FLOOR);

  // A SECTION REQUEST, not a search. "what commands does press have" names a
  // skill and a section but contains no term that any command literally holds —
  // `node bin/press.js emit` does not contain the word "commands" — so term
  // matching correctly finds nothing and incorrectly reports the skill as
  // undocumented. Asking for a whole section is a legitimate question, and the
  // answer is that whole section: still every fact from the index, still every
  // source, just retrieved by section rather than by term. Disclosed as such,
  // because how a result was found changes how much it should be trusted.
  const best = SECTIONS.filter((s) => (affinity[s] ?? 0) >= 3)
    .sort((a, b) => (affinity[b] ?? 0) - (affinity[a] ?? 0))[0];
  if (above.length === 0 && namedSet.size > 0 && best) {
    const listing = scope.flatMap((c) => c.facts.filter((f) => f.section === best).map((f) => ({ skill: c.name, ...f, base: 0, score: 0 })));
    if (listing.length) {
      return {
        hits: listing.slice(0, limit),
        withheld: Math.max(0, listing.length - limit),
        nearest: [],
        searched: scope.map((c) => c.name),
        scoped: true,
        listing: best,
        sections: scope.length * SECTIONS.length,
        factsSearched,
        named: [...namedSet].sort(),
        terms: contentTerms,
      };
    }
  }

  return {
    hits: above.slice(0, limit),
    withheld: Math.max(0, above.length - limit),
    nearest: above.length ? [] : scored.slice(0, 3),
    searched: scope.map((c) => c.name),
    scoped: namedSet.size > 0,
    sections: scope.length * SECTIONS.length,
    factsSearched,
    named: [...namedSet].sort(),
    terms: contentTerms,
  };
}
