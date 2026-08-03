#!/usr/bin/env node
/**
 * eval — the deterministic half of the skill.
 *
 * Everything mechanical lives here so the agent never reshapes output with
 * sed/grep/jq in the transcript: one command returns everything a step needs,
 * already as a table. The agent's job is the conversation; this binary's job
 * is facts.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { extractContract } from './lib/contract.mjs';
import { traceFile, counts, literalMatcher } from './lib/trace.mjs';
import { runProbes, resolveFindings } from './lib/probes.mjs';
import { buildProbeReport, coverageOf, renderReport, table } from './lib/report.mjs';
import { generateCase } from './lib/cases.mjs';

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

export { table };

const need = (args, flag, why) => {
  const key = flag.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (!args[key] || args[key] === true) throw new Error(`${flag} is required — ${why}`);
  return args[key];
};

const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const skillsIn = (repo) =>
  readdirSync(join(repo, 'skills'))
    .filter((n) => existsSync(join(repo, 'skills', n, 'skills', n, 'SKILL.md')))
    .sort();

// ---------------------------------------------------------------------------

async function cmdContract(args) {
  const repo = resolve(args.repo ?? '.');
  if (args.all) {
    const dir = resolve(need(args, '--out', 'where to write one contract per skill'));
    mkdirSync(dir, { recursive: true });
    const rows = [];
    for (const name of skillsIn(repo)) {
      const contract = extractContract(repo, name);
      writeJson(join(dir, `${name}.json`), contract);
      rows.push([name, contract.clauses.length, contract.sources.length]);
    }
    console.log(table(['Skill', 'Clauses', 'Sources'], rows));
    return;
  }

  const name = need(args, '--skill', 'a contract belongs to exactly one skill');
  const contract = extractContract(repo, name);
  if (args.out) writeJson(resolve(args.out), contract);

  // A judgment finding cites a clause id. Finding that id must not require
  // reading the contract JSON into the conversation.
  if (args.grep) {
    const hit = literalMatcher(args.grep);
    const hits = contract.clauses.filter((c) => hit(c.text));
    console.log(
      table(
        ['Clause', 'Severity', 'Source', 'Text'],
        hits.map((c) => [c.id, c.severity, `${c.source.file}:${c.source.line}`, c.text.replace(/\s+/g, ' ').slice(0, 90)]),
      ) || `no clauses contain any of: ${args.grep}`,
    );
    console.log('');
    console.log(table(['Matched', 'Of'], [[hits.length, contract.clauses.length]]));
    return;
  }

  const tally = contract.clauses.reduce((acc, c) => {
    const key = `${c.tag}/${c.severity}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    table(
      ['Source', 'Severity', 'Clauses'],
      Object.entries(tally)
        .sort()
        .map(([k, v]) => [k.split('/')[0], k.split('/')[1], v]),
    ),
  );
  console.log('');
  console.log(table(['Total clauses', 'From'], [[contract.clauses.length, contract.sources.join(', ')]]));
}

async function cmdTrace(args) {
  const run = resolve(need(args, '--run', 'a trace is one session transcript, normalized'));
  if (!existsSync(run)) throw new Error(`--run ${run}: no such file`);
  const trace = traceFile(run);
  if (args.out) writeJson(resolve(args.out), trace);

  // Citing a judgment finding means naming the event it happened at, and
  // hunting for that by eye through a JSON file is how a grader ends up
  // grepping a fixture into the conversation. One call, already a table.
  if (args.grep) {
    const hit = literalMatcher(args.grep);
    const hits = trace.events.filter((e) => hit(`${e.text ?? ''}${e.command ?? ''}${e.path ?? ''}${e.name ?? ''}`));
    console.log(
      table(
        ['Event', 'Line', 'Kind', 'What'],
        hits.map((e) => [e.id, e.line, e.kind, (e.command ?? e.path ?? e.text ?? e.name ?? '').replace(/\s+/g, ' ').slice(0, 90)]),
      ) || `no events contain any of: ${args.grep}`,
    );
    console.log('');
    console.log(table(['Matched', 'Of'], [[hits.length, trace.events.length]]));
    return;
  }

  const c = counts(trace.events);
  console.log(
    table(
      ['Kind', 'Events'],
      Object.entries(c)
        .sort()
        .map(([k, v]) => [k, v]),
    ),
  );
  console.log('');
  console.log(
    table(
      ['Kept', 'Dropped (bookkeeping)', 'Dropped (thinking)', 'Unparsed'],
      [[trace.events.length, trace.dropped.bookkeeping, trace.dropped.thinking, trace.dropped.unparsed]],
    ),
  );
}

const loadContract = (args) => JSON.parse(readFileSync(resolve(need(args, '--contract', 'grade against a contract, never against taste')), 'utf8'));
const loadTrace = (args) => JSON.parse(readFileSync(resolve(need(args, '--trace', 'a grade needs the run it is grading')), 'utf8'));

async function cmdProbe(args) {
  const contract = loadContract(args);
  const trace = loadTrace(args);

  // The one rule, available as a command: hand it a finding and it tells you
  // whether the citations are real. Exits non-zero when they are not.
  if (args.checkFinding) {
    const supplied = JSON.parse(readFileSync(resolve(args.checkFinding), 'utf8'));
    const raw = Array.isArray(supplied) ? supplied : [supplied];
    const { findings, rejected } = resolveFindings(
      raw,
      new Map(contract.clauses.map((c) => [c.id, c])),
      new Set(trace.events.map((e) => e.id)),
    );
    console.log(table(['Supplied', 'Citations resolve', 'Rejected'], [[raw.length, findings.length, rejected.length]]));
    if (rejected.length > 0) {
      console.log('');
      console.log(table(['Finding', 'Why it was refused'], rejected.map((r) => [r.id ?? '(no id)', r.why])));
      throw new Error(
        `${rejected.length} finding(s) cite something that does not exist. An uncited finding is an assertion, and this skill does not make assertions.`,
      );
    }
    return;
  }

  const skill = args.skill ?? contract.name;
  const probed = runProbes({ contract, events: trace.events, skill });
  const built = buildProbeReport({ contract, trace, probed, skill });
  if (args.out) writeJson(resolve(args.out), built);

  console.log(
    table(
      ['Clauses', 'Examined', 'Unexamined', 'Findings', 'Rejected'],
      [[contract.clauses.length, probed.examined.length, probed.unexamined.length, probed.findings.length, probed.rejected.length]],
    ),
  );
  if (probed.findings.length > 0) {
    console.log('');
    console.log(
      table(
        ['Severity', 'Finding', 'Probe', 'Clause', 'Event'],
        probed.findings.map((f) => [f.severity, f.id, f.probe, f.clauseId, f.eventId]),
      ),
    );
  }
}

async function cmdReport(args) {
  const contract = loadContract(args);
  const trace = loadTrace(args);
  const skill = args.skill ?? contract.name;
  const judgment = args.judgment ? JSON.parse(readFileSync(resolve(args.judgment), 'utf8')) : [];

  const { findings: judged, rejected: judgedOut } = resolveFindings(
    judgment,
    new Map(contract.clauses.map((c) => [c.id, c])),
    new Set(trace.events.map((e) => e.id)),
  );
  if (judgedOut.length > 0) {
    console.log(table(['Judgment finding', 'Refused because'], judgedOut.map((r) => [r.id ?? '(no id)', r.why])));
    throw new Error(
      `${judgedOut.length} judgment finding(s) cite something that does not exist — fix the citation or drop the finding.`,
    );
  }

  const probed = runProbes({ contract, events: trace.events, skill });
  const out = resolve(need(args, '--out', 'a report is an artifact; it needs somewhere to land'));
  mkdirSync(out, { recursive: true });
  writeJson(join(out, 'probe.json'), buildProbeReport({ contract, trace, probed, skill, judgment: judged }));
  writeFileSync(join(out, 'report.md'), renderReport({ contract, trace, probed, skill, judgment: judged }));

  // Same arithmetic as report.md, from the same place: a terminal summary that
  // disagrees with the artifact it just wrote is the bug this shares a fix with.
  const cov = coverageOf({ probed, judgment: judged });
  console.log(
    table(
      ['Skill', 'Clauses', 'Examined', 'Machine findings', 'Judgment findings', 'Coverage gap'],
      [[skill, contract.clauses.length, cov.examined, probed.findings.length, judged.length, cov.gap]],
    ),
  );
  console.log('');
  console.log(table(['Wrote', 'Is'], [[join(out, 'report.md'), 'the report a person reads'], [join(out, 'probe.json'), 'the same findings, machine-readable']]));
}

async function cmdCase(args) {
  const repo = resolve(args.repo ?? '.');
  const skill = need(args, '--skill', 'a case is added to the skill it is about');
  const file = need(args, '--in', 'the committed file the case asserts over');
  const absent = need(args, '--assert-absent', 'the defect text that must stop being present');
  if (!args.prove) {
    throw new Error(
      '--prove is required. A case that has never been run has never been observed failing, and this skill keeps only cases it has watched fail.',
    );
  }
  const finding = args.finding ?? 'manual';
  const detail = args.detail ?? 'converted from an eval finding';

  const result = generateCase(repo, {
    id: finding,
    skill,
    file,
    absent,
    clauseId: args.clause ?? 'unstated',
    eventId: args.event ?? 'unstated',
    detail,
    stack: args.stack ?? 'node',
  });

  console.log(table(['Case', 'Kept', 'Why'], [[finding, result.kept ? 'yes' : 'no', result.reason]]));
  if (!result.kept) throw new Error('green case refused');
}

const USAGE = `eval v${VERSION} — grade a real run of a skill against the contract that skill committed to.

  eval contract --skill <name> [--repo <path>] [--out <file>] [--grep <substr,substr>]
  eval contract --all --out <dir> [--repo <path>]
  eval trace    --run <session.jsonl> [--out <file>] [--grep <substr,substr>]
  eval probe    --contract <file> --trace <file> [--out <file>]
  eval probe    --contract <file> --trace <file> --check-finding <file>
  eval report   --contract <file> --trace <file> --out <dir> [--judgment <file>]
  eval case     --skill <name> --in <file> --assert-absent <text> --prove [--finding <id>]
`;

async function main() {
  const args = argv(process.argv.slice(2));
  const cmd = args._[0];
  if (args.version) return console.log(VERSION);
  try {
    switch (cmd) {
      case 'contract': return await cmdContract(args);
      case 'trace': return await cmdTrace(args);
      case 'probe': return await cmdProbe(args);
      case 'report': return await cmdReport(args);
      case 'case': return await cmdCase(args);
      default:
        console.log(USAGE);
        process.exitCode = cmd ? 2 : 0;
    }
  } catch (err) {
    console.error(`eval: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
