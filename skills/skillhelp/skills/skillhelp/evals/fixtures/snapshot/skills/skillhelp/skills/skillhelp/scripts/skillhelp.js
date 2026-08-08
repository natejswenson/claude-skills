#!/usr/bin/env node
/**
 * skillhelp — the deterministic half of the skill.
 *
 * Everything mechanical lives here so the agent never reshapes output with
 * sed/grep/jq in the transcript: one command returns everything a step needs,
 * already as a table. The agent's job is the conversation; this binary's job
 * is facts.
 *
 * The one rule is enforced here, not asked for: `ask` emits facts only with
 * their sources, and when nothing clears the floor it prints the not-documented
 * block ITSELF. The honest answer is script output, not the caller's goodwill.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { listSkillNames } from './lib/extract.mjs';
import { buildAll, checkAll, findRepo, indexDir, readCard, REBUILD, SKILL_DIR } from './lib/store.mjs';
import { ask as askIndex, parseCard, FLOOR } from './lib/ask.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

function argv(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inline !== undefined) out[key] = inline;
      else if (args[i + 1] && !args[i + 1].startsWith('--')) { out[key] = args[i + 1]; i += 1; }
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

export const table = (headers, rows) => {
  if (rows.length === 0) return '';
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => `| ${cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' | ')} |`;
  return [line(headers), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...rows.map(line)].join('\n');
};

const repoOf = (args) => (args.repo ? resolve(args.repo) : findRepo());
const skillDirOf = (args) => (args.skillDir ? resolve(args.skillDir) : SKILL_DIR);

async function cmdBuild(args) {
  const repo = repoOf(args);
  const skillDir = skillDirOf(args);
  const { rows } = buildAll(repo, { skillDir, write: !args.dryRun });
  if (rows.length === 0) throw new Error(`no skills found under ${resolve(repo, 'skills')} — nothing to index`);

  console.log(table(
    ['Skill', 'Version', 'Sections', 'Facts', 'Refused', 'Status'],
    rows.map((r) => [
      r.name, r.version,
      `${5 - r.emptySections.length}/5`,
      r.facts,
      r.secretsRefused || '',
      r.status,
    ]),
  ));

  const changed = rows.filter((r) => r.status !== 'unchanged').length;
  const thin = rows.filter((r) => r.emptySections.length > 0);
  const refused = rows.reduce((n, r) => n + r.secretsRefused, 0);
  console.log('');
  console.log(`${rows.length} skills indexed, ${changed} changed${args.dryRun ? ' (dry run — nothing written)' : ''}.`);
  if (refused) console.log(`${refused} secret-shaped lines refused rather than indexed.`);
  // Never silent about a thin card: a card with an empty section answers
  // nothing in that section, and saying so is the difference between an index
  // that is honest and one that merely looks complete.
  for (const r of thin) console.log(`thin — ${r.name} has no source for: ${r.emptySections.join(', ')}`);
}

async function cmdCheck(args) {
  const repo = repoOf(args);
  const skillDir = skillDirOf(args);
  const { results, ok, count } = checkAll(repo, { skillDir });
  if (count === 0) throw new Error(`no skills found under ${resolve(repo, 'skills')} — refusing to report a clean index over zero skills`);

  console.log(table(
    ['Skill', 'Indexed', 'Live', 'Verdict'],
    results.map((r) => [r.name, r.indexed, r.live, r.verdict]),
  ));
  console.log('');
  if (ok) {
    console.log(`${count} skills, every card current.`);
    return;
  }
  const bad = results.filter((r) => r.verdict !== 'ok');
  console.log(`${bad.length} of ${count} cards are not current.`);
  console.log(`run: ${REBUILD}`);
  process.exitCode = 1;
}

function loadCards(skillDir) {
  const dir = indexDir(skillDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
    .map((f) => parseCard(readCard(f.replace(/\.md$/, ''), skillDir)));
}

async function cmdAsk(args) {
  const skillDir = skillDirOf(args);
  const question = args._.slice(1).join(' ').trim() || (typeof args.question === 'string' ? args.question : '');
  if (!question) throw new Error('ask needs a question: skillhelp ask "how do I set up gmailtriage"');

  const cards = loadCards(skillDir);
  if (cards.length === 0) throw new Error(`no cards in ${indexDir(skillDir)} — run: ${REBUILD}`);

  const r = askIndex(cards, question, { limit: Number(args.limit ?? 10) });

  if (r.hits.length === 0) {
    // The not-documented block. This is printed by the command, not left to the
    // caller to compose, because "I could not find it" is the exact answer a
    // model is most tempted to replace with something plausible.
    console.log('NOT DOCUMENTED');
    console.log('');
    console.log(`Question — ${question}`);
    console.log(`Searched — ${r.searched.length} skill${r.searched.length === 1 ? '' : 's'} × 5 sections (${r.sections} sections, ${r.factsSearched} grounded facts)`);
    console.log(`Terms    — ${r.terms.join(', ') || '(none after stopwords)'}`);
    if (r.scoped) console.log(`Scope    — restricted to ${r.named.join(', ')}, named in the question`);
    console.log('');
    if (r.nearest.length) {
      console.log(`Nearest below the floor of ${FLOOR} — related, but not an answer to this question:`);
      for (const f of r.nearest) console.log(`- [${f.skill}/${f.section}] ${f.text} \`${f.source}\``);
    } else {
      console.log('No indexed fact matched any term in this question.');
    }
    console.log('');
    console.log('Relay this verbatim. Do not compose an answer from outside the index.');
    return;
  }

  const bySkill = new Map();
  for (const h of r.hits) {
    const k = `${h.skill}/${h.section}`;
    if (!bySkill.has(k)) bySkill.set(k, []);
    bySkill.get(k).push(h);
  }
  console.log(table(
    ['Skill', 'Section', 'Facts', 'Top score'],
    [...bySkill.entries()].map(([k, v]) => [k.split('/')[0], k.split('/')[1], v.length, Math.max(...v.map((f) => f.score))]),
  ));
  console.log('');
  if (r.listing) {
    console.log(`Retrieved as a SECTION LISTING — the question asked for ${r.named.join(', ')}'s ${r.listing}, and no single term matched. This is the whole section, not a ranked answer.`);
    console.log('');
  }
  for (const [k, v] of bySkill) {
    console.log(`### ${k}`);
    for (const f of v) console.log(`- ${f.text} \`${f.source}\``);
    console.log('');
  }
  // No silent caps: what was dropped is stated, with how to see it.
  if (r.withheld) console.log(`${r.withheld} lower-scoring matches withheld — rerun with --limit ${r.hits.length + r.withheld}.`);
  console.log('Every line above carries its source. Answer only from these; anything else is ungrounded.');
}

async function cmdList(args) {
  const skillDir = skillDirOf(args);
  const cards = loadCards(skillDir);
  if (cards.length === 0) throw new Error(`no cards in ${indexDir(skillDir)} — run: ${REBUILD}`);
  const repo = repoOf(args);
  const live = new Set(listSkillNames(repo));

  console.log(table(
    ['Skill', 'Version', 'Facts', 'Triggers'],
    cards.map((c) => [
      c.name + (live.has(c.name) ? '' : ' (orphaned)'),
      c.version,
      c.facts.length,
      c.triggers.slice(0, 3).map((t) => `"${t}"`).join(', ') || '—',
    ]),
  ));
  console.log('');
  console.log(`${cards.length} skills indexed.`);
}

const USAGE = `skillhelp v${VERSION} — answers questions about the skills in this repo, from an index built out of their own files.

  skillhelp build [--repo <path>] [--dry-run]   rebuild every card
  skillhelp check [--repo <path>]               fail if any card would change
  skillhelp ask "<question>" [--limit <n>]      grounded facts, or the not-documented block
  skillhelp list [--repo <path>]                the catalogue
`;

async function main() {
  const args = argv(process.argv.slice(2));
  const cmd = args._[0];
  if (args.version) return console.log(VERSION);
  try {
    switch (cmd) {
      case 'build': return await cmdBuild(args);
      case 'check': return await cmdCheck(args);
      case 'ask': return await cmdAsk(args);
      case 'list': return await cmdList(args);
      default:
        console.log(USAGE);
        process.exitCode = cmd ? 2 : 0;
    }
  } catch (err) {
    console.error(`skillhelp: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
