import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { validate, render, publish } from '../issuecreator.js';
const real = JSON.parse(readFileSync(new URL('../../evals/real-draft.json', import.meta.url)));
const cli = new URL('../issuecreator.js', import.meta.url).pathname;
const temp = t => { const dir = mkdtempSync(join(tmpdir(), 'issuecreator-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };

test('real draft passes; missing requirements, unknown keys and blocking questions fail', () => {
  assert.deepEqual(validate(real), []);
  for (const key of ['title', 'problem', 'desiredBehavior', 'scope', 'context', 'acceptanceCriteria', 'verification', 'dependencies', 'outOfScope', 'openQuestions']) {
    const d = structuredClone(real); delete d[key]; assert.ok(validate(d).length, key);
  }
  for (const patch of [{ scope: [] }, { acceptanceCriteria: ['TODO'] }, { title: 'bad\ntitle' }, { kind: 'epic' }, { openQuestions: ['Which repository?'] }, { criterai: ['Lost requirement'] }]) {
    assert.ok(validate({ ...real, ...patch }).length); assert.throws(() => render({ ...real, ...patch }));
  }
  for (const malformed of [null, [], 'text', 42]) assert.ok(validate(malformed).length);
});

test('bug requires reproduction and expected/actual environment evidence', () => {
  const bug = { ...real, kind: 'bug' }; assert.equal(validate(bug).length, 4);
  Object.assign(bug, { reproduction: 'Submit an empty selection.', expected: 'Empty state.', actual: 'Generic error.', environment: 'Reported on macOS; exact app version unavailable.' });
  assert.deepEqual(validate(bug), []); assert.match(render(bug), /## Actual behavior\n\nGeneric error/);
});

test('literal code, multiline Markdown and repository template survive rendering', () => {
  const d = { ...real, problem: 'Use `literal` and $(touch never)\n\n```sh\necho "$HOME"\n```', templateBody: '### Required form field\n\nFilled content.' };
  const body = render(d); assert.ok(body.startsWith(d.templateBody)); assert.ok(body.includes(d.problem));
  for (const ac of real.acceptanceCriteria) assert.ok(body.includes(`- [ ] ${ac}`));
  assert.ok(!body.includes('## Dependencies'));
});

test('publication passes literal arguments and verifies the observed issue', t => {
  const out = temp(t); const calls = [];
  const draft = { ...real, title: 'Preserve `code` $(touch never) "$HOME"' };
  const url = 'https://github.com/example/repository/issues/42';
  const fake = args => {
    calls.push(args);
    if (args[1] === 'create') {
      assert.equal(args[5], draft.title);
      assert.equal(readFileSync(args[7], 'utf8'), render(draft)); return url;
    }
    return JSON.stringify({ url, number: 42, title: draft.title, body: render(draft).replace(/\n/g, '\r\n') });
  };
  assert.equal(publish({ draft, out, repo: 'example/repository' }, fake).status, 'verified');
  assert.equal(calls.length, 2);
  assert.throws(() => publish({ draft, out, repo: 'example/repository' }, fake), /Receipt already exists/);
  assert.equal(calls.length, 2);
});

test('mismatched read-back retains URL and blocks automatic re-creation', t => {
  const out = temp(t); let creates = 0;
  const fake = args => { if (args[1] === 'create') { creates++; return 'https://github.com/example/repository/issues/42'; } return JSON.stringify({ number: 42, url: 'https://github.com/example/repository/issues/42', title: 'Wrong title', body: render(real) }); };
  assert.throws(() => publish({ draft: real, out, repo: 'example/repository' }, fake), /does not match/);
  const receipt = JSON.parse(readFileSync(join(out, 'receipt.json'))); assert.equal(receipt.status, 'created-unverified'); assert.ok(receipt.url);
  assert.throws(() => publish({ draft: real, out, repo: 'example/repository' }, fake), /Receipt already exists/); assert.equal(creates, 1);
});

test('network uncertainty is durable and never retries', t => {
  const out = temp(t); let calls = 0; const fake = () => { calls++; throw new Error('connection lost'); };
  assert.throws(() => publish({ draft: real, out, repo: 'example/repository' }, fake), /do not retry blindly/);
  assert.equal(JSON.parse(readFileSync(join(out, 'receipt.json'))).status, 'uncertain');
  assert.throws(() => publish({ draft: real, out, repo: 'example/repository' }, fake), /Receipt already exists/); assert.equal(calls, 1);
});

test('invalid destination and invalid draft never reach GitHub', t => {
  const out = temp(t); const fake = () => assert.fail('must not reach GitHub');
  for (const repo of ['', '/tmp/repo', '--help', 'owner/repo/extra']) assert.throws(() => publish({ draft: real, out, repo }, fake), /OWNER\/REPO/);
  assert.throws(() => publish({ draft: { ...real, acceptanceCriteria: [] }, out, repo: 'example/repository' }, fake), /acceptanceCriteria/);
});

test('unexpected issue URL stops before read-back', t => {
  let calls = 0;
  assert.throws(() => publish({ draft: real, out: temp(t), repo: 'example/repository' }, () => { calls++; return 'https://github.com/wrong/repository/issues/42'; }), /Unexpected issue URL/);
  assert.equal(calls, 1);
});

test('CLI works from another directory and rejects incomplete flags', t => {
  const out = temp(t);
  const input = new URL('../../evals/real-draft.json', import.meta.url).pathname;
  execFileSync(process.execPath, [cli, 'render', '--input', input, '--out', out], { cwd: tmpdir() });
  assert.equal(readFileSync(join(out, 'issue.md'), 'utf8'), render(real));
  for (const args of [['create', '--input', input], ['validate', '--input', input, '--wat', 'x'], ['render', '--input', input, '--out']]) assert.notEqual(spawnSync(process.execPath, [cli, ...args]).status, 0);
});

test('multiline acceptance criteria keep nested code and lists inside the checkbox', () => {
  const draft = { ...real, acceptanceCriteria: ['The command emits:\n\n```text\nready\n```\n\n- No extra output.'] };
  assert.ok(render(draft).includes('- [ ] The command emits:\n  \n  ```text\n  ready\n  ```\n  \n  - No extra output.'));
});

test('non-bug evidence fields are never silently discarded', () => {
  assert.ok(validate({ ...real, reproduction: 'Steps that must not disappear.' }).some(x => /reproduction/.test(x)));
});


test('rendering an issue.json input into its own directory preserves every requirement', t => {
  const out = temp(t); const input = join(out, 'issue.json');
  writeFileSync(input, JSON.stringify(real));
  execFileSync(process.execPath, [cli, 'render', '--input', input, '--out', out]);
  const recovered = JSON.parse(readFileSync(input));
  assert.deepEqual(recovered, real);
  assert.deepEqual(validate(recovered), []);
});

test('render refuses a publication directory and preserves its submitted body', t => {
  const out = temp(t);
  writeFileSync(join(out, 'receipt.json'), JSON.stringify({ status: 'uncertain' }));
  writeFileSync(join(out, 'issue.md'), 'Original submission');
  const input = new URL('../../evals/real-draft.json', import.meta.url).pathname;
  const result = spawnSync(process.execPath, [cli, 'render', '--input', input, '--out', out]);
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(join(out, 'issue.md'), 'utf8'), 'Original submission');
});
