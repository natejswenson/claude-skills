import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { transpileModule, ModuleKind, JsxEmit } from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(root, '.request-test-'));
after(() => rm(scratch, { recursive: true, force: true }));
const source = await readFile(new URL('../src/Request.tsx', import.meta.url), 'utf8');
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, jsx: JsxEmit.ReactJSX } }).outputText;
const entry = join(scratch, 'Request.mjs');
await writeFile(entry, compiled);
const { Request } = await import(pathToFileURL(entry).href);
const render = (method, params, busy = false) => renderToStaticMarkup(React.createElement(Request, { request: { id: '7', method, params }, busy, onRespond() {} }));

test('command approval exposes reason, executable action and working directory before technical details', () => {
  const html = render('item/commandExecution/requestApproval', { command: 'npm run build', cwd: '/work/project', reason: 'Verify the production bundle' });
  const main = html.split('<details')[0];
  assert.match(main, /Allow this command\?/);
  assert.match(main, /Verify the production bundle/);
  assert.match(main, /<pre>npm run build<\/pre>/);
  assert.match(main, /Working directory<\/dt><dd>\/work\/project/);
  assert.match(html, /Decline/);
  assert.match(html, /Allow this action/);
  assert.doesNotMatch(html, /Allow.*session/);
});

test('network approvals identify host and protocol in the decision itself', () => {
  const html = render('item/commandExecution/requestApproval', { command: 'curl https://docs.example.com', networkApprovalContext: { host: 'docs.example.com', protocol: 'https' } });
  const main = html.split('<details')[0];
  assert.match(main, /Allow network access\?/);
  assert.match(main, /Host<\/dt><dd>docs.example.com/);
  assert.match(main, /Protocol<\/dt><dd>https/);
  assert.match(main, /curl https:\/\/docs.example.com/);
});

test('file approvals show the actual proposed diff and requested write location', () => {
  const html = render('item/fileChange/requestApproval', { grantRoot: '/work/docs', proposedChanges: '/work/docs/readme.md\n@@ -1 +1 @@\n-old title\n+new title' });
  const main = html.split('<details')[0];
  assert.match(main, /Allow these file changes\?/);
  assert.match(main, /aria-label="Proposed file changes"/);
  assert.match(main, /\/work\/docs\/readme.md/);
  assert.match(main, /class="diff-removal">-old title/);
  assert.match(main, /class="diff-addition">\+new title/);
  assert.match(main, /Requested write access/);
  assert.doesNotMatch(main, /&quot;proposedChanges&quot;/);
  assert.match(render('item/fileChange/requestApproval', {}), /A file diff was not provided/);
});

test('questions support optional choices and mask secret answers', () => {
  const html = render('item/tool/requestUserInput', { questions: [
    { id: 'token', question: 'Enter your token', isSecret: true },
    { id: 'name', question: 'Project name' },
    { id: 'format', question: 'Choose format', options: [{ label: 'PDF', description: 'Ready to print' }] },
  ] });
  assert.match(html, /type="password"[^>]*autoComplete="off"[^>]*aria-label="Your answer: Enter your token"/);
  assert.match(html, /type="text"[^>]*aria-label="Your answer: Project name"/);
  assert.match(html, /type="radio" name="format" value="PDF"/);
  assert.match(html, /Ready to print/);
  assert.match(html, /Or write your own answer/);
  assert.match(html, /disabled="">Continue/);
});

test('busy requests disable decisions and unsupported requests offer no approval', () => {
  const busy = render('item/commandExecution/requestApproval', { command: 'npm test' }, true);
  assert.match(busy, /disabled="">Decline/);
  assert.match(busy, /disabled="">Allow this action/);
  const unknown = render('unknown/request', { command: 'surprise' });
  assert.match(unknown, /cannot be approved/);
  assert.doesNotMatch(unknown, /Allow this action/);
});

test('only offered one-action decisions are shown, including cancel-only refusal', () => {
  const html = render('item/commandExecution/requestApproval', { command: 'printf proof', availableDecisions: ['accept', { acceptWithExecpolicyAmendment: { command: ['printf'] } }, 'cancel'] });
  assert.match(html, /Decline and stop/);
  assert.match(html, /Allow this action/);
  assert.doesNotMatch(html, />Decline</);
  const cancel = render('item/commandExecution/requestApproval', { availableDecisions: ['cancel'] });
  assert.match(cancel, /Decline and stop/);
  assert.doesNotMatch(cancel, /Allow this action/);
  const unsupported = render('item/commandExecution/requestApproval', { availableDecisions: ['acceptForSession'] });
  assert.match(unsupported, /Use Stop run/);
  assert.doesNotMatch(unsupported, /Allow this action/);
});
