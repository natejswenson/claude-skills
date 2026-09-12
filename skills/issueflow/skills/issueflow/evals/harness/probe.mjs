// Runs against the supplied immutable source snapshot, not the evaluator's imports.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const [root, name, output, work] = process.argv.slice(2);
const lib = async (file) => import(pathToFileURL(join(root, 'scripts/lib', file)));
let actual;
if (['invented-evidence', 'zero-tests', 'exit-conflict', 'real-evidence', 'green-only'].includes(name)) {
  const { parseAllEvidence, twoSided } = await lib('evidence.mjs');
  let text;
  if (name === 'invented-evidence') text = '# pass 0\n# fail 1\n# pass 1\n# fail 0\n';
  if (name === 'zero-tests') text = '# pass 0\n# fail 1\n# pass 0\n# fail 0\n';
  if (name === 'exit-conflict') text = '# pass 0\n# fail 1\n# pass 1\n# fail 0\nexit code: 1\n';
  const executions = [];
  if (name === 'real-evidence' || name === 'green-only') {
    const test = join(work, 'behavior.test.cjs');
    writeFileSync(test, "const test = require('node:test'); const assert = require('node:assert/strict'); test('behavior', () => assert.equal(process.env.FIXTURE_VALUE, 'fixed'));\n");
    text = '';
    for (const value of name === 'green-only' ? ['fixed'] : ['broken', 'fixed']) {
      const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', test], {
        cwd: work, encoding: 'utf8', timeout: 15000, env: { ...process.env, FIXTURE_VALUE: value },
      });
      if (result.error || result.signal || result.status === null) throw new Error('test process did not finish');
      executions.push({ status: result.status, signal: result.signal });
      text += `${result.stdout}\n${result.stderr}\nexit code ${result.status}\n`;
    }
  }
  writeFileSync(join(work, 'evidence.txt'), text);
  actual = { ...twoSided(parseAllEvidence(text)), executions };
} else if (name === 'copy-risk') {
  actual = (await lib('run.mjs')).classifyIssue({ title: 'Fix copy operation corrupting files', body: 'Concurrent writes lose updates.' });
} else if (name === 'unknown-time' || name === 'concurrent-time') {
  const { telemetryEvent, summarizeTelemetry } = await lib('telemetry.mjs');
  const events = name === 'unknown-time'
    ? [telemetryEvent({ runtime: 'codex' }, 'worker', { agentTimeMs: null, wallTimeMs: 100, success: true })]
    : ['a', 'b'].map((attemptId) => telemetryEvent({ runtime: 'codex' }, 'worker', {
      attemptId, agentTimeMs: 100, wallTimeMs: 100, success: true,
    }, '2026-09-11T00:00:00.100Z'));
  actual = summarizeTelemetry(events);
} else throw new Error(`unknown probe ${name}`);
writeFileSync(output, `${JSON.stringify(actual, null, 2)}\n`, { flag: 'wx' });
