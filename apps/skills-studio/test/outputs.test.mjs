import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(root, '.outputs-test-'));
after(() => rm(scratch, { recursive: true, force: true }));
const source = await readFile(new URL('../src/outputs.ts', import.meta.url), 'utf8');
const entry = join(scratch, 'outputs.mjs');
await writeFile(entry, transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } }).outputText);
const { pickOutput, pdfCompanion } = await import(pathToFileURL(entry).href);
const artifact = (id, name) => ({ id, name });

test('an empty list has no selection, even with a stale current id', () => {
    assert.equal(pickOutput([]), undefined);
    assert.equal(pickOutput([], 'removed'), undefined);
});

test('a presentable report wins over data, source code and debug images regardless of directory order', () => {
    const files = [artifact('data', 'data/results.json'), artifact('debug', 'debug/screenshot.png'), artifact('report', 'reports/annual.HTML'), artifact('code', 'scripts/render.py'), artifact('pdf', 'annual.pdf')];
    assert.equal(pickOutput(files), 'report');
    assert.equal(pickOutput([...files].reverse()), 'report');
    assert.equal(pickOutput(files, 'removed'), 'report');
    assert.equal(pickOutput(files.filter(file => file.id !== 'report')), 'pdf');
});

test('Markdown and common image formats are preferred to plain text, data and code', () => {
    const fallback = [artifact('code', 'build.ts'), artifact('json', 'data.json'), artifact('text', 'notes.txt')];
    for (const name of ['report.md', 'report.markdown', 'report.PNG', 'report.jpeg', 'report.jpg', 'report.svg', 'report.webp']) {
        const files = [...fallback, artifact('presentable', name)];
        assert.equal(pickOutput(files), 'presentable', name);
        assert.equal(pickOutput([...files].reverse()), 'presentable', name);
    }
    assert.equal(pickOutput(fallback), 'text');
});

test('same-priority candidates use full filenames and paths for a deterministic tie-break', () => {
    const files = [artifact('z', 'reports/z.html'), artifact('a', 'reports/a.HTML'), artifact('root', 'overview.html')];
    assert.equal(pickOutput(files), 'root');
    assert.equal(pickOutput([files[1], files[0], files[2]]), 'root');
    assert.equal(pickOutput(files.slice(0, 2)), 'a');
    assert.equal(pickOutput(files.slice(0, 2).reverse()), 'a');
});

test('new same-filename revisions follow the chosen file while preserving an explicit different file', () => {
    const files = [artifact('report-v1', 'report.html'), artifact('notes-v1', 'notes.md'), artifact('report-v2', 'report.html'), artifact('notes-v2', 'notes.md')];
    assert.equal(pickOutput(files), 'report-v2');
    assert.equal(pickOutput(files, 'report-v1'), 'report-v2');
    assert.equal(pickOutput(files, 'notes-v1'), 'notes-v2');
    assert.equal(pickOutput(files, 'notes-v2'), 'notes-v2');
    assert.equal(pickOutput([...files, artifact('new-report', 'a-report.html')], 'notes-v2'), 'notes-v2');
});

test('same basenames in different directories are distinct files and the input stays unchanged', () => {
    const files = [artifact('primary', 'public/report.html'), artifact('internal', 'archive/report.html'), artifact('primary-v2', 'public/report.html')];
    const before = structuredClone(files);
    assert.equal(pickOutput(files, 'primary'), 'primary-v2');
    assert.equal(pickOutput(files, 'internal'), 'internal');
    assert.deepEqual(files, before);
});

test('directory extensions and extensionless filenames do not identify a presentable report', () => {
    assert.equal(pickOutput([artifact('directory', 'archive.html/data.json'), artifact('bare', 'html'), artifact('report', 'report.pdf')]), 'report');
});


test('PDF companion uses a same-directory, same-stem image only for the latest PDF revision', () => {
    const files = [artifact('pdf-v1', 'reports/study.PDF'), artifact('other', 'other/study.png'), artifact('debug', 'reports/debug.png'), artifact('old', 'reports/study.PNG'), artifact('jpeg', 'reports/study.jpg'), artifact('pdf-v2', 'reports/study.PDF'), artifact('new', 'reports/study.PNG')];
    assert.equal(pdfCompanion(files, 'pdf-v2'), 'new');
    assert.equal(pdfCompanion(files, 'pdf-v1'), undefined);
    assert.equal(pdfCompanion(files, 'missing'), undefined);
    assert.equal(pdfCompanion([...files, artifact('html', 'reports/study.html')], 'html'), undefined);
    assert.equal(pdfCompanion([artifact('pdf', 'reports/study.pdf'), artifact('remote', 'https://example.com/study.png')], 'pdf'), undefined);
});
