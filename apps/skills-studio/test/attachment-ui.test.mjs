import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { transpileModule, ModuleKind, JsxEmit } from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(root, '.attachments-test-'));
after(() => rm(scratch, { recursive: true, force: true }));
const source = await readFile(new URL('../src/Attachments.tsx', import.meta.url), 'utf8');
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, jsx: JsxEmit.ReactJSX } }).outputText;
const entry = join(scratch, 'Attachments.mjs');
await writeFile(entry, compiled);
const { AttachmentPicker, MessageAttachments, selectAttachments, encodeAttachments } = await import(pathToFileURL(entry).href);
const file = (name, size = 100) => ({ name, size, lastModified: 1 });
const MB = 1024 * 1024;

test('picker exposes native multiple-file control, selected file size and removal', () => {
    const html = renderToStaticMarkup(React.createElement(AttachmentPicker, { files: [file('reference.pdf', MB)], onChange() {} }));
    assert.match(html, /type="file" multiple=""/);
    assert.match(html, /aria-label="Attach files"/);
    assert.match(html, /reference.pdf/);
    assert.match(html, /1.0 MB/);
    assert.match(html, /aria-label="Remove reference.pdf"/);
    assert.match(html, /saved locally and made available to Codex when you send/);
});

test('busy picker disables file selection and removal', () => {
    const html = renderToStaticMarkup(React.createElement(AttachmentPicker, { files: [file('reference.pdf')], disabled: true, onChange() {} }));
    assert.match(html, /type="file" multiple="" disabled=""/);
    assert.match(html, /button disabled="" aria-label="Remove reference.pdf"/);
});

test('oversized selection retains existing and valid incoming files', () => {
    const existing = file('first.pdf');
    const result = selectAttachments([existing], [file('large.zip', 11 * MB), file('notes.md')]);
    assert.deepEqual(result.files.map(item => item.name), ['first.pdf', 'notes.md']);
    assert.equal(result.files[0], existing);
    assert.match(result.error, /large.zip exceeds 10 MB/);
});

test('count and total limits preserve selections; exact limits are accepted', () => {
    const five = Array.from({ length: 5 }, (_, i) => file(`${i}.txt`));
    const count = selectAttachments(five, [file('sixth.txt')]);
    assert.equal(count.files.length, 5);
    assert.match(count.error, /up to 5 files/);
    const total = selectAttachments([file('first.zip', 10 * MB)], [file('second.zip', 10 * MB), file('third.txt')]);
    assert.equal(total.files.length, 2);
    assert.match(total.error, /total 20 MB or less/);
});

test('duplicate selection is stable and a removed file can be added again', () => {
    const reference = file('reference.pdf');
    assert.equal(selectAttachments([reference], [reference]).files.length, 1);
    assert.deepEqual(selectAttachments([], [reference]).files, [reference]);
});

test('saved attachments expose only download routes, names and sizes', () => {
    const html = renderToStaticMarkup(React.createElement(MessageAttachments, { runId: 'run/1', attachments: [{ id: 'file/2', name: '<example>.html', size: MB, type: 'file', file: 'internal/private/source.html' }] }));
    assert.match(html, /href="\/api\/runs\/run%2F1\/attachments\/file%2F2\?download=1"/);
    assert.match(html, /&lt;example&gt;.html/);
    assert.doesNotMatch(html, /internal\/private|iframe|<img/);
});

test('encoding removes the data URL prefix and retains original file name', async () => {
    const previous = globalThis.FileReader;
    globalThis.FileReader = class { readAsDataURL() { this.result = 'data:application/octet-stream;base64,AAEC/w=='; this.onload(); } };
    try { assert.deepEqual(await encodeAttachments([file('binary.bin')]), [{ name: 'binary.bin', data: 'AAEC/w==' }]); }
    finally { globalThis.FileReader = previous; }
});

test('read failure rejects send preparation and keeps caller selections', async () => {
    const previous = globalThis.FileReader;
    const files = [file('unreadable.pdf')];
    globalThis.FileReader = class { readAsDataURL() { this.onerror(); } };
    try { await assert.rejects(encodeAttachments(files), /Could not read unreadable.pdf/); assert.equal(files.length, 1); }
    finally { globalThis.FileReader = previous; }
});
