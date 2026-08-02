#!/usr/bin/env node
/**
 * smith — the deterministic half of the skill that makes skills.
 *
 * Everything mechanical lives here so the agent never reshapes output with
 * sed/grep/jq in the transcript: one command returns everything a step needs,
 * already as a table. The agent's job is the spec and the prose; this binary's
 * job is the ten wiring points, the ladder, and the freeze.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { readActionPins, readHouse, readSkill } from './lib/house.mjs';
import { conform, fatalLevels, isSmithNative, summarize } from './lib/conform.mjs';
import { SPEC_TEMPLATE, validateSpec } from './lib/spec.mjs';
import { planScaffold } from './lib/scaffold.mjs';
import { applyPlan, PlanError } from './lib/apply.mjs';
import { baselineTest, freezeRun } from './lib/freeze.mjs';

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

const mark = (ok) => (ok ? 'pass' : 'FAIL');

/* ------------------------------------------------------------------ detect */

function cmdDetect(args) {
  const repo = resolve(args.repo ?? '.');
  const house = readHouse(repo);
  const pins = readActionPins(repo);
  if (args.json) return console.log(JSON.stringify({ house, pins }, null, 2));

  console.log(
    table(
      ['Signal', 'Detected', 'From'],
      [
        ['skills', house.skills.join(', ') || '—', 'skills/'],
        ['marketplace entries', String(house.marketplaceNames.length), '.claude-plugin/marketplace.json'],
        ['required checks', String(house.contexts.length), '.github/repo-settings.sh'],
        ['press targets', String(house.pressTargets.length), 'press targets.json'],
        ['brand available', house.hasPress ? 'yes' : 'no — regions cannot be emitted', 'skills/press'],
        ['pinned actions', String(Object.keys(pins).length), 'existing callers'],
      ],
    ),
  );
  console.log();
  console.log(
    table(
      ['Name taken', 'Stack', 'Version'],
      house.skills.map((s) => {
        const sk = readSkill(repo, s);
        return [s, sk.stack, sk.version ?? '—'];
      }),
    ),
  );
}

/* ------------------------------------------------------------------ spec */

function cmdSpec(args) {
  const name = args._[1] ?? args.name;
  if (!name) throw new Error('usage: smith spec <name> [--out <file>]');
  const out = args.out ?? `${name}.spec.json`;
  if (existsSync(out) && !args.force) throw new Error(`${out} exists — pass --force to overwrite`);
  writeFileSync(out, `${JSON.stringify(SPEC_TEMPLATE(name), null, 2)}\n`);
  console.log(table(['Wrote', 'Next'], [[out, 'fill it in, then `smith scaffold --spec ' + out + '`']]));
}

function loadSpec(args) {
  const path = args.spec;
  if (!path) throw new Error('--spec <file> is required');
  if (!existsSync(path)) throw new Error(`${path}: no such spec`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function cmdCheckSpec(args) {
  const repo = resolve(args.repo ?? '.');
  const spec = loadSpec(args);
  const { ok, problems } = validateSpec(spec, readHouse(repo));
  if (args.json) return console.log(JSON.stringify({ ok, problems }, null, 2));
  if (ok) {
    console.log(table(['Spec', 'Verdict'], [[spec.name, 'ready to scaffold']]));
    return;
  }
  console.log(table(['Field', 'Problem'], problems.map((p) => [p.field, p.why])));
  process.exitCode = 1;
}

/* ------------------------------------------------------------------ scaffold */

function cmdScaffold(args) {
  const repo = resolve(args.repo ?? '.');
  const spec = loadSpec(args);
  const house = readHouse(repo);

  const check = validateSpec(spec, house);
  if (!check.ok) {
    console.log(table(['Field', 'Problem'], check.problems.map((p) => [p.field, p.why])));
    throw new Error('the spec is not ready — a bad spec costs nothing to fix now and everything to fix later');
  }

  // The date is an input, never `new Date()`: the emitted tree is pinned
  // byte-exactly as a baseline, and a clock inside it would make the golden
  // fail once a day for no reason.
  const today = args.today ?? new Date().toISOString().slice(0, 10);
  const plan = planScaffold(spec, house, { today, pins: readActionPins(repo) });

  const rows = applyPlan(repo, plan, { force: Boolean(args.force), dryRun: Boolean(args.dryRun) });
  if (args.json) return console.log(JSON.stringify({ plan: rows }, null, 2));

  console.log(table(['Path', 'Action', 'Bytes'], rows.map((r) => [r.path, r.action, String(r.bytes)])));
  console.log();
  console.log(
    table(
      ['Next', 'Why'],
      [
        [`press emit --repo . --init --target ${spec.name}-agent-ui --target ${spec.name}-readme`, 'splice the brand regions — never hand-write them'],
        ['node skills/press/skills/press/tests/fixtures/update-pre-migration.mjs', "refresh press's golden set — two new targets, or ci / press goes red"],
        [`forge header .github/workflows/${spec.name}.yml`, 'stamp the masthead from press'],
        [`forge verify .github/workflows/${spec.name}.yml`, 'refs real, lint-clean, before anyone reads it'],
        ['run .github/repo-settings.sh (admin)', 'editing the contexts array applies NOTHING on its own'],
      ],
    ),
  );
}

/* ------------------------------------------------------------------ freeze */

function cmdFreeze(args) {
  const repo = resolve(args.repo ?? '.');
  const name = args.skill;
  if (!name) throw new Error('--skill <name> is required');
  const skillDir = join(repo, 'skills', name, 'skills', name);
  if (!existsSync(skillDir)) throw new Error(`${skillDir}: no such skill`);

  const manifest = freezeRun(skillDir, resolve(args.from ?? ''), {
    command: args.command,
    label: args.label ?? 'the-real-run',
    allowNetwork: Boolean(args.allowNetwork),
  });

  const spec = { name };
  const trap = args.trapCommand ? { command: args.trapCommand } : null;
  const testsDir = join(skillDir, 'scripts', 'tests');
  mkdirSync(testsDir, { recursive: true });
  writeFileSync(join(testsDir, 'baseline.test.mjs'), baselineTest(spec, manifest, trap));

  console.log(
    table(
      ['Frozen', 'Bytes', 'sha256'],
      manifest.artifacts.map((a) => [a.path, String(a.bytes), a.sha256.slice(0, 12)]),
    ),
  );
  console.log();
  console.log(
    table(
      ['Rung', 'Reached'],
      [
        ['3 — a real run frozen', 'yes'],
        ['two-sided', trap ? 'yes' : 'NO — the generated test fails until a known-bad case is frozen'],
      ],
    ),
  );
}

/* ------------------------------------------------------------------ verify */

function run(cmd, cwd) {
  try {
    execFileSync('bash', ['-lc', cmd], { cwd, stdio: 'pipe', encoding: 'utf8' });
    return { ok: true, out: '' };
  } catch (err) {
    return { ok: false, out: String(err.stdout ?? '').trim().split('\n').slice(-2).join(' ') || err.message };
  }
}

/**
 * Rung 3 — has a real run actually been pinned?
 *
 * The house form is what every skill here already does: `skill-invariants.json`
 * declares a baseline and every fixture it names is on disk. The smith-native
 * form is stronger — `evals/baseline/MANIFEST.json` records the command that
 * reproduces the run, so the eval re-runs rather than merely comparing frozen
 * bytes to themselves. Grading a shipped skill against the stronger form would
 * report nine false failures, and a rung nobody can get green is a rung people
 * learn to ignore.
 */
export function frozenRun(repo, skill) {
  const manifest = join(skill.inner, 'evals', 'baseline', 'MANIFEST.json');
  if (existsSync(manifest)) return { ok: true, detail: 'evals/baseline/MANIFEST.json — reproducible' };
  if (isSmithNative(skill)) {
    return { ok: false, detail: 'no MANIFEST.json — smith-native skills pin the command that reproduces the run' };
  }

  const baseline = skill.invariants?.baseline ?? [];
  if (baseline.length === 0) return { ok: false, detail: 'no baseline declared — this is not a finished skill' };
  const missing = baseline
    .flatMap((b) => b.fixtures ?? [])
    .filter((f) => !existsSync(join(skill.inner, f)));
  return missing.length === 0
    ? { ok: true, detail: `${baseline.length} baseline entries, all fixtures present` }
    : { ok: false, detail: `${missing.length} declared fixture(s) missing: ${missing.join(', ')}` };
}

/** Rungs 0-3 for one skill. Rung 0 is offline and instant; 1-2 shell out. */
export function ladder(repo, name, { deep = true } = {}) {
  const house = readHouse(repo);
  const skill = readSkill(repo, name);
  const checks = conform(house, skill);
  const { ok: wiringOk, failed, advisories } = summarize(skill, checks);

  const rungs = [{ rung: 0, what: 'wiring resolves', ok: wiringOk, detail: wiringOk ? `${checks.length} checks` : failed.map((f) => f.id).join(', ') }];

  if (deep) {
    const inner = `skills/${name}/skills/${name}`;
    const lints = [
      [`python3 tools/score_skill.py ${inner} --min 100`, 'score_skill'],
      [`python3 tools/lint_plugin.py skills/${name}`, 'lint_plugin'],
      ['python3 tools/lint_baseline.py .', 'lint_baseline'],
    ];
    const results = lints.map(([cmd, label]) => ({ label, ...run(cmd, repo) }));
    const lintOk = results.every((r) => r.ok);
    rungs.push({ rung: 1, what: 'house lints pass', ok: lintOk, detail: results.filter((r) => !r.ok).map((r) => r.label).join(', ') || 'score_skill, lint_plugin, lint_baseline' });

    const testCmd = skill.stack === 'node' ? 'npm test --silent' : 'python3 -m pytest -q';
    const t = existsSync(join(repo, inner)) ? run(testCmd, join(repo, inner)) : { ok: false, out: 'no skill dir' };
    rungs.push({ rung: 2, what: "the skill's own tests pass", ok: t.ok, detail: t.ok ? testCmd : t.out });
  }

  const frozen = frozenRun(repo, skill);
  rungs.push({
    rung: 3,
    what: 'a real run is frozen as the baseline',
    ok: frozen.ok,
    detail: frozen.detail,
  });

  return { name, native: isSmithNative(skill), checks, failed, advisories, rungs, fatal: fatalLevels(skill) };
}

function cmdVerify(args) {
  const repo = resolve(args.repo ?? '.');
  const house = readHouse(repo);
  const names = args.skill ? [args.skill] : args.all ? house.skills : null;
  if (!names) throw new Error('--skill <name> or --all');
  const deep = !args.wiringOnly && names.length === 1;

  const results = names.map((n) => ladder(repo, n, { deep }));
  if (args.json) return console.log(JSON.stringify(results, null, 2));

  if (names.length === 1) {
    const r = results[0];
    console.log(table(['Check', 'Level', 'Result', 'Detail'], r.checks.map((c) => [c.id, c.level, mark(c.ok), c.detail])));
    console.log();
    console.log(table(['Rung', 'Proves', 'Reached', 'Detail'], r.rungs.map((x) => [String(x.rung), x.what, mark(x.ok), x.detail])));
    const highest = r.rungs.filter((x) => x.ok).length === r.rungs.length ? 3 : (r.rungs.find((x) => !x.ok)?.rung ?? 0) - 1;
    console.log();
    console.log(`reached rung ${Math.max(highest, -1)} of 3${highest < 3 ? ' — not done' : ''}`);
    if (!r.rungs.every((x) => x.ok)) process.exitCode = 1;
    return;
  }

  console.log(
    table(
      ['Skill', 'Tier', 'Wiring', 'Frozen run', 'Failing'],
      results.map((r) => [
        r.name,
        r.native ? 'smith' : 'house',
        mark(r.failed.length === 0),
        mark(r.rungs.find((x) => x.rung === 3).ok),
        r.failed.map((f) => f.id).join(', ') || '—',
      ]),
    ),
  );
  if (results.some((r) => r.failed.length > 0)) process.exitCode = 1;
}

/* ------------------------------------------------------------------ main */

const USAGE = `smith v${VERSION} — skills that are finished, not just written.

  smith detect      [--repo <path>]                       what the house already says
  smith spec <name> [--out <file>]                        a spec template to fill in
  smith check-spec  --spec <file>                         grade a spec before it costs anything
  smith scaffold    --spec <file> [--dry-run] [--force]   the tree + all 10 wiring points
  smith freeze      --skill <n> --from <dir> --command <c> [--trap-command <c>]
  smith verify      --skill <n> | --all [--wiring-only]   the ladder, rungs 0-3

A skill is done when a real run of it is frozen in its evals — not when the
files exist. smith says which rung it reached and never claims more.
`;

async function main() {
  const args = argv(process.argv.slice(2));
  if (args.version) return console.log(VERSION);
  try {
    switch (args._[0]) {
      case 'detect': return cmdDetect(args);
      case 'spec': return cmdSpec(args);
      case 'check-spec': return cmdCheckSpec(args);
      case 'scaffold': return cmdScaffold(args);
      case 'freeze': return cmdFreeze(args);
      case 'verify': return cmdVerify(args);
      default:
        console.log(USAGE);
        process.exitCode = args._[0] ? 2 : 0;
    }
  } catch (err) {
    console.error(`smith: ${err instanceof PlanError ? err.message : err.message}`);
    process.exitCode = 1;
  }
}

main();
