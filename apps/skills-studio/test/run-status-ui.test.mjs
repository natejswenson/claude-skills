import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { transpileModule, ModuleKind, JsxEmit } from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(root, '.run-status-test-'));
after(() => rm(scratch, { recursive: true, force: true }));
const source = await readFile(new URL('../src/RunStatus.tsx', import.meta.url), 'utf8');
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, jsx: JsxEmit.ReactJSX } }).outputText;
const entry = join(scratch, 'RunStatus.mjs');
await writeFile(entry, compiled);
const { RunStatus, WorkspaceTabs, currentActivity } = await import(pathToFileURL(entry).href);
const render = props => renderToStaticMarkup(React.createElement(RunStatus, { onViewOutput() {}, ...props }));

test('working status reports actual latest activity without fabricated progress', () => {
    const html = render({ status: 'working', activity: { label: 'Writing the report' }, outputCount: 0 });
    assert.match(html, /Codex is working/);
    assert.match(html, /Writing the report/);
    assert.doesNotMatch(html, /\d+%|remaining|estimated|View output/i);
    assert.match(render({ status: 'working' }), /Follow the conversation or activity/);
});

test('waiting states direct the user to the decision or question', () => {
    assert.match(render({ status: 'approval_needed' }), /Your approval is needed/);
    assert.match(render({ status: 'approval_needed' }), /Review the requested action/);
    assert.match(render({ status: 'awaiting_input' }), /Codex has a question/);
    assert.match(render({ status: 'awaiting_input' }), /Answer in the conversation/);
});

test('completed runs distinguish finished files from a text response', () => {
    const files = render({ status: 'completed', outputCount: 2 });
    assert.match(files, /Ready to review/);
    assert.match(files, /2 finished files/);
    assert.match(files, />View output/);
    assert.match(render({ status: 'completed', outputCount: 1 }), /1 finished file[.<]/);
    const response = render({ status: 'completed', outputCount: 0 });
    assert.match(response, /Response ready/);
    assert.match(response, /Continue with a follow-up/);
    assert.doesNotMatch(response, /View output|finished file/);
    const onViewOutput = () => 'output selected';
    const element = RunStatus({ status: 'completed', outputCount: 1, onViewOutput });
    const button = element.props.children.find(child => child?.type === 'button');
    assert.equal(button.props.onClick(), 'output selected');
});

test('stopped, interrupted and failed runs explain deliberate continuation without auto retry', () => {
    for (const [status, headline] of [['stopped', 'Run stopped'], ['interrupted', 'Run interrupted'], ['failed', 'Run failed']]) {
        const html = render({ status, outputCount: 0 });
        assert.match(html, new RegExp(headline));
        assert.match(html, /follow-up/);
        assert.doesNotMatch(html, /retrying|resuming|automatically|View output/i);
    }
});

test('workspace tabs expose visible counts, selected state and requested navigation', () => {
    let selected;
    const props = { tab: 'conversation', outputCount: 2, activityCount: 5, onChange: tab => { selected = tab; } };
    const html = renderToStaticMarkup(React.createElement(WorkspaceTabs, props));
    assert.match(html, /aria-label="Workspace views"/);
    assert.match(html, /aria-pressed="true"[^>]*>Conversation/);
    assert.match(html, /aria-pressed="false"[^>]*>Output <span[^>]*>2<\/span>/);
    assert.match(html, /aria-pressed="false"[^>]*>Activity <span[^>]*>5<\/span>/);
    const buttons = WorkspaceTabs(props).props.children;
    buttons[1].props.onClick();
    assert.equal(selected, 'output');
    buttons[2].props.onClick();
    assert.equal(selected, 'activity');
    buttons[0].props.onClick();
    assert.equal(selected, 'conversation');
});

test('pending decisions remain discoverable from the output and activity views', () => {
 const html = renderToStaticMarkup(React.createElement(WorkspaceTabs, {tab:'output',outputCount:1,activityCount:3,attention:true,onChange(){}}));
 assert.match(html, /aria-label="Action needed"/);
 assert.match(html, /aria-pressed="false"[^>]*>Conversation<span/);
 assert.match(html, /aria-pressed="true"[^>]*>Output/);
});


test('new turns do not show completed or cancelled work as current progress', () => {
 const old = {label:'Old command',status:'inProgress',turnId:'previous'};
 const completed = {label:'Finished command',status:'completed',turnId:'current'};
 assert.equal(currentActivity([old, completed], 'current'), undefined);
 assert.equal(currentActivity([old], null), undefined);
 const fresh = {label:'Writing this report',status:'working',turnId:'current'};
 assert.equal(currentActivity([old,fresh,completed], 'current'), fresh);
 assert.doesNotMatch(render({status:'working',activity:currentActivity([old,completed],'current')}), /Old command|Finished command/);
});

test('file collection is an honest intermediate state without premature completion actions',()=>{
 const html=render({status:'collecting_output',outputCount:2});
 assert.match(html,/Preparing your outputs/);assert.match(html,/Saving local preview copies/);
 assert.doesNotMatch(html,/Ready to review|View output|Run status unavailable/);
});
