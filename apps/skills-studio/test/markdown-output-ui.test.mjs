import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { transpileModule, ModuleKind, ScriptTarget, JsxEmit } from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(root, '.markdown-output-test-'));
after(() => rm(scratch, { recursive: true, force: true }));
async function compile(name) {
    const source = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
    const entry = join(scratch, name.replace(/\.tsx?$/, '.mjs'));
    const code = transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022, jsx: JsxEmit.ReactJSX } }).outputText;
    await writeFile(entry, code.replaceAll("'./Markdown'", "'./Markdown.mjs'").replaceAll("'./markdown-output'", "'./markdown-output.mjs'"));
    return import(pathToFileURL(entry).href);
}
const { readMarkdownPreview, loadMarkdownOutput } = await compile('markdown-output.ts');
await compile('Markdown.tsx');
const { MarkdownContent } = await compile('MarkdownOutput.tsx');
const bytes = text => new TextEncoder().encode(text);
function streamed(chunks) {
    let cancelled = false;
    const response = new Response(new ReadableStream({
        start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
        cancel() { cancelled = true; },
    }, { highWaterMark: 0 }));
    // A regression to full-body buffering must fail even for small documents.
    response.text = () => { throw new Error('Full body must not be read'); };
    return { response, cancelled: () => cancelled };
}
for (const [name, source] of [['empty', ''], ['below limit', 'x'.repeat(65535)], ['exact limit', 'x'.repeat(65536)]]) {
    test(`${name} Markdown remains complete without a partial notice`, async () => {
        const { response, cancelled } = streamed(source ? [bytes(source)] : []);
        assert.deepEqual(await readMarkdownPreview(response), { text: source, truncated: false });
        assert.equal(cancelled(), false);
    });
}
test('oversized Markdown stops at 64 KiB and cancels before consuming the remainder', async () => {
    const stream = streamed([bytes('x'.repeat(65536)), bytes('!'), bytes('unread')]);
    assert.deepEqual(await readMarkdownPreview(stream.response), { text: 'x'.repeat(65536), truncated: true });
    assert.equal(stream.cancelled(), true);
});
test('a single oversized chunk is bounded and a UTF-8 character split by the cap is omitted cleanly', async () => {
    const stream = streamed([bytes('a'.repeat(65535) + '💡tail')]);
    assert.deepEqual(await readMarkdownPreview(stream.response), { text: 'a'.repeat(65535), truncated: true });
});
test('UTF-8 split across network chunks remains intact within the limit', async () => {
    const source = bytes('A💡éZ');
    assert.deepEqual(await readMarkdownPreview(streamed([source.slice(0, 3), source.slice(3, 6), source.slice(6)]).response), { text: 'A💡éZ', truncated: false });
});
test('HTTP, absent streaming body and stream failures expose a recoverable error', async () => {
    await assert.rejects(readMarkdownPreview(new Response('missing', { status: 404 })), /Could not load/);
    await assert.rejects(readMarkdownPreview(new Response(null)), /stream|preview/i);
    await assert.rejects(readMarkdownPreview(new Response(new ReadableStream({ start(controller) { controller.error(new Error('Connection lost')); } }))), /Connection lost/);
});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
test('switching outputs aborts the old fetch and suppresses late success and failure', async () => {
    for (const outcome of ['resolve', 'reject']) {
        const previous = deferred();
        const loaded = [], errors = [];
        let oldSignal;
        const cancel = loadMarkdownOutput(signal => { oldSignal = signal; return previous.promise; }, { onLoad: value => loaded.push(value), onError: error => errors.push(error) });
        cancel();
        assert.equal(oldSignal.aborted, true);
        loadMarkdownOutput(() => Promise.resolve(streamed([bytes('# Current')]).response), { onLoad: value => loaded.push(value), onError: error => errors.push(error) });
        previous[outcome](outcome === 'reject' ? new Error('Stale error') : streamed([bytes('# Previous')]).response);
        await settle();
        assert.deepEqual(loaded, [{ text: '# Current', truncated: false }]);
        assert.deepEqual(errors, []);
    }
});
test('switching outputs cancels an in-flight body read without publishing partial content', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes('# Old')); }, cancel() { cancelled = true; } }));
    const states = [];
    const cancel = loadMarkdownOutput(() => Promise.resolve(response), { onLoad: value => states.push(value), onError: error => states.push(error) });
    await settle(); cancel(); await settle();
    assert.equal(cancelled, true);
    assert.deepEqual(states, []);
});
test('current network failures leave loading and show the error', async () => {
    const states = [];
    loadMarkdownOutput(() => Promise.reject(new Error('Network unavailable')), { onLoad: value => states.push(value), onError: error => states.push(error) });
    await settle();
    assert.deepEqual(states, ['Network unavailable']);
});
test('partial Markdown discloses its limit and links to the original full download', () => {
    const html = renderToStaticMarkup(React.createElement(MarkdownContent, { preview: { text: '# Report', truncated: true }, url: '/api/runs/run/artifacts/id', name: 'report.md' }));
    assert.match(html, /partial|Partial/);
    assert.match(html, /64 KiB/);
    assert.match(html, /href="\/api\/runs\/run\/artifacts\/id\?download=1" download="report.md"/);
    assert.match(html, /<h1>Report<\/h1>/);
});
test('small Markdown retains GFM rendering and captured file navigation without a partial notice', () => {
    const html = renderToStaticMarkup(React.createElement(MarkdownContent, { preview: { text: '| Skill | Purpose |\n| --- | --- |\n| city-report | Research |\n\n- [x] Done\n\n[report](./report.md)', truncated: false }, url: '/artifact', name: 'report.md', files: ['report.md'], onOpenFile() {} }));
    assert.match(html, /<th>Skill<\/th>/);
    assert.match(html, /type="checkbox" disabled="" checked=""/);
    assert.match(html, /<button class="inline-file"/);
    assert.doesNotMatch(html, /partial|64 KiB/i);
});
