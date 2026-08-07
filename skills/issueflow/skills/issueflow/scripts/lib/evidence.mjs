/**
 * Reading a test stage's evidence file, rather than merely weighing it.
 *
 * The gate used to accept any non-empty file as proof a suite ran. That is a
 * check on the existence of a file, not on the existence of a test run — a
 * stage that wrote `ok` passed it. This module is what turns the evidence back
 * into a fact: it finds a real runner's own summary line, or it finds nothing
 * and the gate refuses.
 *
 * It reads the LAST result in the file on purpose. The test stage is required
 * to prove its test two-sided, so a good evidence file legitimately contains a
 * failing run before the passing one; taking the first match would report every
 * correct run as a failure.
 */

/**
 * Every runner shape recognised, most specific first.
 *
 * Each entry pulls a pass count, a fail count, or both. A runner whose summary
 * cannot be found at all is what makes the gate refuse, so adding a runner here
 * is how you teach the gate a new ecosystem — never by loosening the refusal.
 */
const RUNNERS = [
  {
    id: 'node --test',
    // `# pass 12` / `# fail 0`, emitted by node's TAP reporter.
    match: (text) => {
      const pass = [...text.matchAll(/^#\s*pass\s+(\d+)\s*$/gm)].at(-1);
      const fail = [...text.matchAll(/^#\s*fail\s+(\d+)\s*$/gm)].at(-1);
      if (!pass && !fail) return null;
      return { passed: pass ? Number(pass[1]) : null, failed: fail ? Number(fail[1]) : null };
    },
  },
  {
    id: 'jest/vitest',
    // `Tests:  2 failed, 40 passed, 42 total`. Checked before pytest: pytest's
    // shape is the loosest here, and it matches this line too.
    match: (text) => {
      const line = [...text.matchAll(/^\s*Tests?:?[ \t]+.*\d+\s+total\s*$/gm)].at(-1);
      if (!line) return null;
      const passed = /(\d+)\s+passed/.exec(line[0]);
      const failed = /(\d+)\s+failed/.exec(line[0]);
      return { passed: passed ? Number(passed[1]) : null, failed: failed ? Number(failed[1]) : 0 };
    },
  },
  {
    id: 'pytest',
    // `=== 3 failed, 118 passed in 1.20s ===`, and the no-failure variant.
    match: (text) => {
      const line = [...text.matchAll(/^.*?(\d+)\s+passed.*$/gm)].at(-1);
      if (!line) {
        const only = [...text.matchAll(/^.*?(\d+)\s+failed.*$/gm)].at(-1);
        return only ? { passed: null, failed: Number(only[1]) } : null;
      }
      const failed = /(\d+)\s+failed/.exec(line[0]);
      return { passed: Number(line[1]), failed: failed ? Number(failed[1]) : 0 };
    },
  },
  {
    id: 'mocha',
    // `4 passing (12ms)` / `1 failing`
    match: (text) => {
      const pass = [...text.matchAll(/^\s*(\d+)\s+passing\b.*$/gm)].at(-1);
      const fail = [...text.matchAll(/^\s*(\d+)\s+failing\b.*$/gm)].at(-1);
      if (!pass && !fail) return null;
      return { passed: pass ? Number(pass[1]) : null, failed: fail ? Number(fail[1]) : 0 };
    },
  },
  {
    id: 'go test',
    // `ok  \texample.com/pkg\t0.42s` or a bare `FAIL`.
    match: (text) => {
      const results = [...text.matchAll(/^(ok|FAIL|---\s+FAIL)\s+\S/gm)];
      if (results.length === 0) return null;
      const failed = results.filter((r) => r[1] !== 'ok').length;
      return { passed: results.length - failed, failed };
    },
  },
  {
    id: 'exit code',
    // The universal fallback: a stage that recorded what the shell returned.
    match: (text) => {
      const line = [...text.matchAll(/^.*\bexit[ _-]?code\b\D{0,4}(\d+)\s*$/gim)].at(-1);
      if (!line) return null;
      const code = Number(line[1]);
      return { passed: null, failed: code === 0 ? 0 : null, exitCode: code };
    },
  },
];

/**
 * The last real result in an evidence file, or null when there is none.
 *
 * `green` is deliberately three-valued: true, false, or null for "a runner
 * reported, but not in a shape that says which way it went". A null is not a
 * pass, and callers must not treat it as one.
 */
export function parseEvidence(text) {
  for (const runner of RUNNERS) {
    const hit = runner.match(text);
    if (!hit) continue;
    const green = hit.failed === null ? null : hit.failed === 0;
    return { runner: runner.id, passed: hit.passed, failed: hit.failed, exitCode: hit.exitCode ?? null, green };
  }
  return null;
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
