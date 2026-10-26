import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { transpileModule, ModuleKind, ScriptTarget, JsxEmit } from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(root, '.history-test-'));
after(() => rm(scratch, { recursive: true, force: true }));
async function compile(name) {
    const source = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
    const entry = join(scratch, name.replace(/\.tsx?$/, '.mjs'));
    await writeFile(entry, transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022, jsx: JsxEmit.ReactJSX } }).outputText);
    return import(pathToFileURL(entry).href);
}
const { matchesRun, loadSelectedRun, createRefreshQueue } = await compile('history.ts');
const { RunLoadState } = await compile('RunLoadState.tsx');

const runs = [
    { id: 'original', title: 'A long original task'.padEnd(80, '.'), skillId: 'city-report', messages: [{ role: 'user', text: `${'A long original task'.padEnd(100, '.')} include Duluth demographics` }] },
    { id: 'followup', title: 'A report', skillId: 'devlog', messages: [{ role: 'user', text: 'Start a report' }, { role: 'assistant', text: 'The architecture analysis is ready.' }, { role: 'user', text: 'Add accessibility findings' }] },
];
test('history search finds original content past truncated titles, follow-ups, responses and skill', () => {
    assert.deepEqual(runs.filter(run => matchesRun(run, 'DULUTH')).map(run => run.id), ['original']);
    assert.deepEqual(runs.filter(run => matchesRun(run, 'accessibility')).map(run => run.id), ['followup']);
    assert.equal(matchesRun(runs[1], 'architecture analysis'), true);
    assert.equal(matchesRun(runs[0], 'city-report'), true);
    assert.equal(matchesRun(runs[1], '  a report  '), true);
    assert.equal(matchesRun(runs[0], '  '), true);
    assert.equal(matchesRun(runs[0], 'unrelated'), false);
});

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
test('a failed selected run can be retried successfully without remaining in loading state', async () => {
    const states = [];
    loadSelectedRun(() => Promise.reject(new Error('Run not found')), { onLoad: run => states.push(run), onError: error => states.push(error) });
    await settle();
    assert.deepEqual(states, ['Run not found']);
    loadSelectedRun(() => Promise.resolve({ id: 'recovered' }), { onLoad: run => states.push(run), onError: error => states.push(error) });
    await settle();
    assert.deepEqual(states, ['Run not found', { id: 'recovered' }]);
});

test('changing selection suppresses both stale successful and failed requests', async () => {
    for (const outcome of ['resolve', 'reject']) {
        const previous = deferred();
        const loaded = [], errors = [];
        const cancel = loadSelectedRun(() => previous.promise, { onLoad: run => loaded.push(run), onError: error => errors.push(error) });
        cancel();
        loadSelectedRun(() => Promise.resolve({ id: 'current' }), { onLoad: run => loaded.push(run), onError: error => errors.push(error) });
        previous[outcome](outcome === 'reject' ? new Error('Stale failure') : { id: 'previous' });
        await settle();
        assert.deepEqual(loaded, [{ id: 'current' }]);
        assert.deepEqual(errors, []);
    }
});

test('selected-run errors expose Retry and Back to runs rather than an endless opening indicator', () => {
    const props = { error: 'Run not found', onRetry: () => 'retry', onBack: () => 'runs' };
    const html = renderToStaticMarkup(React.createElement(RunLoadState, props));
    assert.match(html, /Could not open this run/);
    assert.match(html, /role="alert"/);
    assert.match(html, /Run not found/);
    assert.match(html, />Retry<\/button>/);
    assert.match(html, />Back to runs<\/button>/);
    assert.doesNotMatch(html, /Opening your run/);
    const children = RunLoadState(props).props.children;
    const buttons = children.filter(child => child?.type === 'button');
    assert.equal(buttons[0].props.onClick(), 'retry');
    assert.equal(buttons[1].props.onClick(), 'runs');
    const loading = renderToStaticMarkup(React.createElement(RunLoadState, { ...props, error: '' }));
    assert.match(loading, /Opening your run/);
    assert.doesNotMatch(loading, /Retry|role="alert"/);
});


test('slow live refreshes stay single-flight and coalesce notifications without losing the final update', async () => {
    const first=deferred(), second=deferred();let calls=0,inFlight=0,max=0;
    const refresh=createRefreshQueue(async()=>{calls++;inFlight++;max=Math.max(max,inFlight);await (calls===1?first.promise:second.promise);inFlight--;});
    const work=refresh();refresh();refresh();refresh();assert.equal(calls,1);
    first.resolve();await settle();assert.equal(calls,2);assert.equal(max,1);
    second.resolve();await work;assert.equal(calls,2);
});
test('a failed refresh releases the single-flight queue so retry can succeed', async () => {
    let calls=0;const refresh=createRefreshQueue(async()=>{if(++calls===1)throw new Error('offline');});
    await assert.rejects(refresh(),/offline/);await refresh();assert.equal(calls,2);
});


test('paged history exposes older matches without requiring full conversation bodies', async () => {
    const source=await readFile(new URL('../src/RunHistory.tsx',import.meta.url),'utf8');
    const entry=join(scratch,'RunHistory.mjs');
    await writeFile(entry,transpileModule(source.replace("'./history'","'./history.mjs'"),{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022,jsx:JsxEmit.ReactJSX}}).outputText);
    const {RunHistoryResults}=await import(pathToFileURL(entry).href);
    const opened=[],again=[],pages=[];
    const props={page:{runs:[{id:'old',title:'Old matching run',skillId:'devlog',status:'completed',createdAt:'2026-10-17T00:00:00Z',updatedAt:'2026-10-17T00:00:00Z'}],total:101,nextOffset:100},offset:50,skills:[],onOpen:id=>opened.push(id),onAgain:id=>again.push(id),onPage:offset=>pages.push(offset),busy:false};
    const html=renderToStaticMarkup(React.createElement(RunHistoryResults,props));
    assert.match(html,/Old matching run/);assert.match(html,/51/);assert.match(html,/101/);assert.match(html,/Previous/);assert.match(html,/Next/);
    assert.doesNotMatch(html,/undefined|archived body/);
    const noNext=renderToStaticMarkup(React.createElement(RunHistoryResults,{...props,page:{...props.page,nextOffset:null}}));
    assert.match(noNext,/<button[^>]*disabled[^>]*>Next/);
});


test('action refresh waiters resolve after their own batch during an ongoing stream', async () => {
    const batches=[deferred(),deferred(),deferred()];let calls=0,firstDone=false,secondDone=false;
    const refresh=createRefreshQueue(()=>batches[calls++].promise);
    const first=refresh().then(()=>{firstDone=true;});const second=refresh().then(()=>{secondDone=true;});
    batches[0].resolve();await settle();assert.equal(firstDone,true);assert.equal(secondDone,false);
    const third=refresh();batches[1].resolve();await settle();assert.equal(secondDone,true);assert.equal(calls,3);
    batches[2].resolve();await Promise.all([first,second,third]);
});
