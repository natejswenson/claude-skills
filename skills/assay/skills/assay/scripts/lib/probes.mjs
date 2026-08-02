/**
 * The probes — the violations a machine is allowed to decide on its own.
 *
 * Every probe here is narrow on purpose. A probe attaches to a clause only when
 * it can name the exact event that breaks it, and it declares in `cannot` the
 * part of that clause it is NOT deciding, so the report can hand the remainder
 * to judgment instead of quietly scoring it as clean. A probe that guesses is
 * worse than no probe: it manufactures findings that cost a reader trust, and
 * once a reader stops trusting the report the eval is decorative.
 *
 * The rule every probe obeys: emit a finding only with a clause id that exists
 * and an event id that exists. `resolveFindings` enforces it rather than
 * trusting each probe to remember.
 */
import { createHash } from 'node:crypto';

const sha8 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8);

const bash = (events) => events.filter((e) => e.kind === 'tool-use' && e.name === 'Bash');
const said = (events) => events.filter((e) => e.kind === 'assistant');
const tool = (events, name) => events.filter((e) => e.kind === 'tool-use' && e.name === name);
const ranAny = (events, re) => bash(events).some((e) => re.test(e.command ?? ''));

/** Split a shell command into segments that are not piped into anything else. */
const unpipedSegments = (command) =>
  String(command)
    .split(/&&|\|\||;/)
    .map((s) => s.trim())
    .filter((s) => !s.includes('|'));

export const PROBES = [
  {
    id: 'file-contents-in-chat',
    appliesTo: /never print file contents/i,
    what: 'a shell command that dumps a source file straight into the transcript',
    cannot:
      'a file printed by a tool other than Bash, or a dump the agent then summarised — the clause is about what the reader sees, and only some of that is in the command',
    decide: (events) => {
      const found = [];
      const dump = /(^|\s)(cat|bat|less|more)\s+[^|<>]*\.(md|json|mjs|js|py|ya?ml|txt|sh|toml|lock)\b/;
      for (const e of bash(events)) {
        for (const seg of unpipedSegments(e.command ?? '')) {
          if (dump.test(seg)) {
            found.push({ eventId: e.id, detail: `dumps a file into the conversation: \`${seg.slice(0, 120)}\`` });
            break;
          }
        }
      }
      return found;
    },
  },

  {
    id: 'announce-once',
    appliesTo: /announce the skill once|announce at start|announce once/i,
    what: 'the skill announcing itself zero times, or more than once',
    cannot: 'whether an announcement that exists is phrased the way the skill asked for',
    decide: (events, { skill }) => {
      const re = new RegExp(`using the \\*{0,2}${skill}\\*{0,2} skill`, 'i');
      const hits = said(events).filter((e) => re.test(e.text ?? ''));
      const first = said(events)[0];
      if (hits.length === 0) {
        return first ? [{ eventId: first.id, detail: `no "using the ${skill} skill" announcement anywhere in the run` }] : [];
      }
      return hits.slice(1).map((e) => ({ eventId: e.id, detail: 'announced the skill a second time' }));
    },
  },

  {
    id: 'pipeline-reshaping',
    appliesTo: /one script call, not a pipeline/i,
    what: 'output reshaped in the shell with sed/awk/an inline interpreter instead of by the script',
    cannot: 'whether the script could reasonably have returned that shape — sometimes the shell really is the right tool',
    decide: (events) => {
      const reshaper = /\|\s*(sed|awk|python3?\s+-|node\s+-e|perl\s+-)/;
      return bash(events)
        .filter((e) => reshaper.test(e.command ?? ''))
        .map((e) => ({ eventId: e.id, detail: `reshapes output in the shell: \`${(e.command ?? '').slice(0, 120)}\`` }));
    },
  },

  {
    id: 'unobserved-test-claim',
    appliesTo: /never claim a result you did not observe|report outcomes faithfully/i,
    what: 'a claim that tests passed with no test run anywhere before it',
    cannot:
      'every other kind of unobserved claim — "it works", "CI is green", "the brand is in sync". Those are the same defect and only judgment can catch them',
    decide: (events) => {
      const claim = /\b(tests?\s+(all\s+)?pass(ed|ing)?|all\s+tests?\s+green|suite\s+is\s+green|test\s+suite\s+passes)\b/i;
      const runner = /\b(npm\s+(run\s+)?test|node\s+--test|pytest|vitest|jest)\b/;
      const out = [];
      for (const e of said(events)) {
        if (!claim.test(e.text ?? '')) continue;
        const before = events.slice(0, events.indexOf(e));
        if (!ranAny(before, runner)) {
          out.push({ eventId: e.id, detail: 'claims tests pass, but no test runner was invoked earlier in the run' });
        }
      }
      return out;
    },
  },

  {
    id: 'question-budget',
    appliesTo: /at most (one|two|three|four|\d+) questions?/i,
    what: 'more questions asked than the skill allows itself',
    cannot: 'a question asked as plain prose instead of through the question tool — those are invisible here and judgment must count them',
    decide: (events, { clause }) => {
      const words = { one: 1, two: 2, three: 3, four: 4 };
      const m = /at most (one|two|three|four|\d+) questions?/i.exec(clause.text);
      const budget = m ? (words[m[1].toLowerCase()] ?? Number(m[1])) : null;
      if (budget === null) return [];
      const asks = tool(events, 'AskUserQuestion');
      let total = 0;
      const out = [];
      for (const e of asks) {
        total += e.questions ?? 1;
        if (total > budget) out.push({ eventId: e.id, detail: `question ${total} of a ${budget}-question budget` });
      }
      return out;
    },
  },

  {
    id: 'pr-into-main',
    appliesTo: /never (open a )?PR into `?main|never PR a feature branch straight into|never push directly to `?main/i,
    what: 'a pull request opened against main, or a direct push to it',
    cannot: 'a PR opened through the GitHub MCP tools or the web UI rather than the gh CLI',
    decide: (events) => {
      const bad = [
        [/gh\s+pr\s+create[\s\S]*--base[= ]\s*main\b/, 'opens a PR whose base is main'],
        [/git\s+push\s+\S+\s+(HEAD:)?main\b/, 'pushes straight to main'],
      ];
      const out = [];
      for (const e of bash(events)) {
        for (const [re, detail] of bad) {
          if (re.test(e.command ?? '')) out.push({ eventId: e.id, detail });
        }
      }
      return out;
    },
  },

  {
    id: 'brand-bypass',
    appliesTo: /never hand-write a brand value|regions are generated/i,
    what: 'a skill-facing markdown file written or edited in a run that never invoked press',
    cannot:
      'whether the edit actually touched a generated region — the trace records the path, not the bytes. This is a proxy, and it under-reports by design rather than guessing',
    decide: (events) => {
      if (ranAny(events, /press(\.js)?\s+(emit|check)/)) return [];
      const target = /skills\/[^/]+\/(skills\/[^/]+\/)?(SKILL|README)\.md$/;
      return events
        .filter((e) => e.kind === 'tool-use' && ['Write', 'Edit'].includes(e.name) && target.test(e.path ?? ''))
        .map((e) => ({ eventId: e.id, detail: `edited ${e.path} with no press emit/check anywhere in the run` }));
    },
  },

  {
    id: 'done-without-freeze',
    appliesTo: /never call a skill done below rung 3|a skill is done when a real run/i,
    what: 'calling a skill done when no run was ever frozen',
    cannot: 'a softer overclaim — "basically finished", "ready to ship" — which reads the same to a user and only judgment catches',
    decide: (events) => {
      const claim = /\b(the )?skill is (now )?(done|complete|finished)\b|\breached rung [3-5]\b/i;
      const froze = /smith(\.js)?\s+freeze\b/;
      const out = [];
      for (const e of said(events)) {
        if (!claim.test(e.text ?? '')) continue;
        const before = events.slice(0, events.indexOf(e));
        if (!ranAny(before, froze)) out.push({ eventId: e.id, detail: 'calls the skill done, but no freeze ran before this point' });
      }
      return out;
    },
  },
];

export const findingId = (probeId, clauseId, eventId) => `f-${sha8(`${probeId}|${clauseId}|${eventId}`)}`;

/**
 * Run every applicable probe. Returns {findings, examined, unexamined}.
 *
 * `examined` is the set of clauses some probe actually decided; `unexamined` is
 * the coverage gap. Reporting the gap is not politeness — a report that lists
 * three findings and says nothing about the forty clauses nobody looked at
 * reads as "forty clauses are fine", which is a lie the reader cannot detect.
 */
export function runProbes({ contract, events, skill }) {
  const byId = new Map(contract.clauses.map((c) => [c.id, c]));
  const eventIds = new Set(events.map((e) => e.id));
  const examined = new Set();
  const raw = [];

  for (const clause of contract.clauses) {
    for (const probe of PROBES) {
      if (!probe.appliesTo.test(clause.text)) continue;
      examined.add(clause.id);
      for (const hit of probe.decide(events, { clause, skill })) {
        raw.push({
          id: findingId(probe.id, clause.id, hit.eventId),
          probe: probe.id,
          clauseId: clause.id,
          eventId: hit.eventId,
          severity: clause.severity,
          detail: hit.detail,
        });
      }
    }
  }

  const { findings, rejected } = resolveFindings(raw, byId, eventIds);
  return {
    findings,
    rejected,
    examined: [...examined].sort(),
    unexamined: contract.clauses.filter((c) => !examined.has(c.id)).map((c) => c.id),
  };
}

/**
 * The one rule, mechanised. A finding whose clause id or event id does not
 * resolve is dropped and counted — never softened into a "possible" finding,
 * because a possible finding is an assertion with a hedge in front of it.
 */
export function resolveFindings(raw, clausesById, eventIds) {
  const findings = [];
  const rejected = [];
  const seen = new Set();
  for (const f of raw) {
    const problems = [];
    if (!clausesById.has(f.clauseId)) problems.push(`clause ${f.clauseId} does not resolve`);
    if (!eventIds.has(f.eventId)) problems.push(`event ${f.eventId} does not resolve`);
    if (problems.length > 0) {
      rejected.push({ ...f, why: problems.join('; ') });
      continue;
    }
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    findings.push(f);
  }
  findings.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { findings, rejected };
}
