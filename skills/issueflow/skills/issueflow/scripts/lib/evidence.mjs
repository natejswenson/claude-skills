/**
 * Reading an implement stage's evidence file, rather than merely weighing it.
 *
 * The gate used to accept any non-empty file as proof a suite ran. That is a
 * check on the existence of a file, not on the existence of a test run — a
 * stage that wrote `ok` passed it. This module is what turns the evidence back
 * into a fact: it finds a real runner's own summary lines, or it finds nothing
 * and the gate refuses.
 *
 * Since 0.7.0 it reads EVERY result in the file, in file order, not only the
 * last. The implement stage owes a two-sided proof — the test seen failing
 * against the unfixed behaviour, then passing — and until now the only thing
 * that checked the red half was a separate test-stage subagent reading the
 * file. That stage is gone; `twoSided()` is the mechanical replacement. A red
 * run that is only a load or import error is not a red run: the file failed
 * as one unit and proved nothing about any assertion inside it.
 */

/** A summary line's own words when the "failure" is the file not loading at all. */
const LOAD_ERROR = /failed to load|cannot find module|ERR_MODULE_NOT_FOUND|ModuleNotFoundError|ImportError|SyntaxError|error collecting|Error: Cannot find|ReferenceError: .* is not defined/i;

/**
 * Every runner shape recognised, most specific first.
 *
 * Each entry returns every result it can find in the text, in order, as
 * `{ index, passed, failed, exitCode }`. A runner whose summary cannot be
 * found at all is what makes the gate refuse, so adding a runner here is how
 * you teach the gate a new ecosystem — never by loosening the refusal.
 */
const RUNNERS = [
  {
    id: 'node --test',
    // `# pass 12` / `# fail 0` (TAP reporter), or `ℹ pass 12` / `ℹ fail 0`
    // (spec reporter, the default on Node ≥25 — even piped). One alternation
    // per counter, not a second entry: results are ordered by position
    // regardless of which form wrote them, or an evidence file whose red half
    // is spec and whose green half is TAP would report the red run.
    all: (text) => pairs(
      [...text.matchAll(/^(?:#|ℹ)\s*pass\s+(\d+)\s*$/gm)],
      [...text.matchAll(/^(?:#|ℹ)\s*fail\s+(\d+)\s*$/gm)],
    ),
  },
  {
    id: 'jest/vitest',
    // `Tests:  2 failed, 40 passed, 42 total`. Checked before pytest: pytest's
    // shape is the loosest here, and it matches this line too.
    all: (text) => [...text.matchAll(/^\s*Tests?:?[ \t]+.*\d+\s+total\s*$/gm)].map((line) => {
      const passed = /(\d+)\s+passed/.exec(line[0]);
      const failed = /(\d+)\s+failed/.exec(line[0]);
      return { index: line.index, passed: passed ? Number(passed[1]) : null, failed: failed ? Number(failed[1]) : 0 };
    }),
  },
  {
    id: 'pytest',
    // `=== 3 failed, 118 passed in 1.20s ===`, and the no-pass variant.
    all: (text) => [...text.matchAll(/^.*?\b(\d+)\s+(passed|failed)\b.*$/gm)].map((line) => {
      const passed = /(\d+)\s+passed/.exec(line[0]);
      const failed = /(\d+)\s+failed/.exec(line[0]);
      const errors = /(\d+)\s+errors?\b/.exec(line[0]);
      return {
        index: line.index,
        passed: passed ? Number(passed[1]) : null,
        failed: (failed ? Number(failed[1]) : 0) + (errors ? Number(errors[1]) : 0),
      };
    }),
  },
  {
    id: 'mocha',
    // `4 passing (12ms)` / `1 failing`
    all: (text) => pairs(
      [...text.matchAll(/^\s*(\d+)\s+passing\b.*$/gm)],
      [...text.matchAll(/^\s*(\d+)\s+failing\b.*$/gm)],
      { failDefault: 0 },
    ),
  },
  {
    id: 'go test',
    // `ok  \texample.com/pkg\t0.42s` or a bare `FAIL`. Contiguous lines are one
    // run; a gap of anything else starts the next.
    all: (text) => {
      const lines = [...text.matchAll(/^(ok|FAIL|---\s+FAIL)\s+\S.*$/gm)];
      const blocks = [];
      let last = null;
      for (const m of lines) {
        const between = last === null ? '' : text.slice(last.index + last[0].length, m.index);
        if (last === null || /\S/.test(between.replace(/\n/g, ''))) blocks.push({ index: m.index, passed: 0, failed: 0 });
        const block = blocks.at(-1);
        if (m[1] === 'ok') block.passed += 1;
        else block.failed += 1;
        last = m;
      }
      return blocks;
    },
  },
  {
    id: 'exit code',
    // The universal fallback: a stage that recorded what the shell returned.
    all: (text) => [...text.matchAll(/^.*\bexit[ _-]?code\b\D{0,4}(\d+)\s*$/gim)].map((line) => {
      const code = Number(line[1]);
      return { index: line.index, passed: null, failed: code === 0 ? 0 : null, exitCode: code };
    }),
  },
];

/**
 * Pair every pass-count line with the fail-count line that follows it. A fail
 * line with no pass line before it is a result on its own (a runner that
 * printed only what broke), and a pass line with no fail line after it keeps
 * `failed: null` unless the runner says an absent line means zero.
 */
function pairs(passes, fails, { failDefault = null } = {}) {
  const out = [];
  const used = new Set();
  for (let i = 0; i < passes.length; i += 1) {
    const p = passes[i];
    const limit = passes[i + 1]?.index ?? Infinity;
    const f = fails.find((m) => !used.has(m.index) && m.index > p.index && m.index < limit);
    if (f) used.add(f.index);
    out.push({ index: p.index, passed: Number(p[1]), failed: f ? Number(f[1]) : failDefault });
  }
  for (const f of fails) if (!used.has(f.index)) out.push({ index: f.index, passed: null, failed: Number(f[1]) });
  return out.sort((a, b) => a.index - b.index);
}

/** Every runner id `parseEvidence` recognises, in match order. */
export const RUNNER_IDS = RUNNERS.map((runner) => runner.id);

const strip = (text) =>
  // Every runner colours its summary when stdout is a tty, and capturing
  // through a pty (`script`, `unbuffer`, some CI wrappers) is exactly how a
  // stage produces coloured output. Stripping once here fixes every entry;
  // guarding each regex individually fixes one instance and leaves the rest
  // silently broken on coloured input.
  text.replace(/\x1b\[[0-9;]*m/g, '');

/**
 * Every real result in an evidence file, in file order — empty when there is
 * none. The runner is the first in `RUNNERS` that finds anything, which is the
 * rule `parseEvidence` always applied; a file mixing two runners' summaries
 * reports the more specific one.
 *
 * `green` is deliberately three-valued: true, false, or null for "a runner
 * reported, but not in a shape that says which way it went". A null is not a
 * pass, and callers must not treat it as one. `loadError` is true when the
 * text between this result and the previous one carries a load/import
 * failure signature — the shape of a red run that proves nothing.
 */
export function parseAllEvidence(text) {
  text = strip(text);
  for (const runner of RUNNERS) {
    const hits = runner.all(text);
    if (hits.length === 0) continue;
    return hits.map((hit, i) => {
      const from = i === 0 ? 0 : hits[i - 1].index;
      const block = text.slice(from, hit.index);
      const green = hit.failed === null ? null : hit.failed === 0;
      return {
        runner: runner.id,
        passed: hit.passed,
        failed: hit.failed,
        exitCode: hit.exitCode ?? null,
        green,
        loadError: green === false && LOAD_ERROR.test(block),
      };
    });
  }
  return [];
}

/** The last real result in an evidence file, or null when there is none. */
export function parseEvidence(text) {
  const all = parseAllEvidence(text);
  if (all.length === 0) return null;
  const { runner, passed, failed, exitCode, green } = all.at(-1);
  return { runner, passed, failed, exitCode, green };
}

/**
 * The two-sided rule, mechanised: a real red run before the final green one.
 *
 * Returns `{ ok: true }` or `{ ok: false, reason }`. The reason is written for
 * the refusal the gate prints, so it says what the file holds rather than what
 * a rule wanted.
 */
export function twoSided(results) {
  if (results.length === 0) return { ok: false, reason: 'holds no runner result at all' };
  const last = results.at(-1);
  if (last.green !== true) {
    return { ok: false, reason: `the last run in it ${last.green === false ? 'failed' : 'does not say whether it passed'} — the green half must come last` };
  }
  const reds = results.slice(0, -1).filter((r) => r.green === false);
  if (reds.length === 0) {
    return { ok: false, reason: 'holds no failing run before the passing one — a test never seen red proves the suite runs, not that the issue is fixed' };
  }
  if (reds.every((r) => r.loadError)) {
    return { ok: false, reason: 'its only red run is a load or import error — the file broke as one unit, which proves nothing about any assertion inside it' };
  }
  return { ok: true };
}

/** The one-line form the accept table and the pull request body both print. */
export function summarize(result) {
  if (!result) return 'no runner result found';
  const parts = [result.runner];
  if (result.passed !== null) parts.push(`${result.passed} passed`);
  if (result.failed !== null && result.failed > 0) parts.push(`${result.failed} failed`);
  else if (result.failed === 0 && result.passed !== null) parts.push('0 failed');
  if (result.exitCode !== null) parts.push(`exit ${result.exitCode}`);
  return parts.join(', ');
}
