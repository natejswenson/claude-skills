import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { publishGuide } from '../lib/publish_guide.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = (file, value) => writeFileSync(file, JSON.stringify(value));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'devlog-publish-guide-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cloneDir = join(dir, 'clone'); mkdirSync(cloneDir);
  const markdown = readFileSync(new URL('./fixtures/guide/import-safe-cli.md', import.meta.url), 'utf8');
  const start = '<!-- agent-handoff:start -->', end = '<!-- agent-handoff:end -->';
  const s = markdown.indexOf(start), e = markdown.indexOf(end);
  const prompt = /^```text\r?\n([\s\S]*?)\r?\n```\s*$/m.exec(markdown.slice(s + start.length, e))[1];
  const reference = markdown.slice(0, s) + markdown.slice(e + end.length);
  const payload = `${prompt}\n\n<reference-guide>\n${reference.trim()}\n</reference-guide>\n`;
  const articlePath = join(dir, 'article.md'), evidencePath = join(dir, 'evidence.json');
  writeFileSync(articlePath, markdown); writeFileSync(join(dir, 'agent-prompt.txt'), payload); writeFileSync(join(dir, 'output.txt'), 'Observed: 6 passed, 0 failed\n');
  const binding = { status: 'passed', summary: 'Fixture observations only; test does not execute tutorial code.', articleSha256: hash(markdown), agentPromptSha256: hash(payload) };
  const execution = { ...binding, commands: [{ command: 'node --test', exitCode: 0, output: { path: 'output.txt', sha256: hash(readFileSync(join(dir, 'output.txt'))) } }] };
  const adaptation = { ...binding, fixture: { original: 'fixture-before', result: 'fixture-after' }, independentChecks: [{ check: 'Public imports stay quiet', observation: 'No stdout during import', passed: true }] };
  const review = { ...binding, reviewer: 'Independent test reviewer', blockingFindings: [] };
  json(join(dir, 'execution.json'), execution); json(join(dir, 'adaptation.json'), adaptation); json(join(dir, 'review.json'), review);
  const ref = path => ({ path, sha256: hash(readFileSync(join(dir, path))) });
  const evidence = { schema: 1, anchor: { project: 'devlog', version: 'v0.5.1', date: '2026-09-09' }, articleSha256: hash(markdown), agentPrompt: ref('agent-prompt.txt'), execution: ref('execution.json'), adaptation: ref('adaptation.json'), review: ref('review.json') };
  const save = () => json(evidencePath, evidence); save();
  return { dir, cloneDir, articlePath, evidencePath, evidence, execution, adaptation, review, ref, save, args: { cloneDir, articlePath, evidencePath } };
}

test('publishes a strictly validated guide through the existing immutable publisher', async t => {
  const f = fixture(t);
  const result = await publishGuide(f.args);
  assert.equal(result.evidenceValidated, true);
  assert.equal(result.manifestUpdated, true);
  assert.equal(readFileSync(join(f.cloneDir, 'devlog/v0.5.1.md'), 'utf8'), readFileSync(f.articlePath, 'utf8'));
  const manifest = JSON.parse(readFileSync(join(f.cloneDir, 'devlog/manifest.json')));
  assert.equal(manifest.entries[0].version, 'v0.5.1');
  await assert.rejects(publishGuide(f.args), /occupied/);
});

test('missing or stale required evidence never creates content', async t => {
  for (const mutate of [
    f => { delete f.evidence.adaptation; },
    f => { f.evidence.execution.sha256 = '0'.repeat(64); },
    f => { writeFileSync(f.articlePath, readFileSync(f.articlePath, 'utf8') + '\nChanged.'); },
    f => { writeFileSync(join(f.dir, 'output.txt'), 'changed observations'); },
    f => { f.evidence.anchor.version = 'v0.5.2'; },
    f => { f.evidence.anchor.date = '2026-02-30'; },
    f => { f.evidence.review = true; },
  ]) {
    const f = fixture(t); mutate(f); f.save();
    await assert.rejects(publishGuide(f.args), { code: 'GUIDE_EVIDENCE_INVALID' });
    assert.deepEqual(readdirSync(f.cloneDir), []);
  }
});

test('matching hashes cannot replace exact payload checks, lint, or meaningful reports', async t => {
  for (const mutate of [
    f => { writeFileSync(join(f.dir, 'agent-prompt.txt'), 'wrong payload'); f.evidence.agentPrompt = f.ref('agent-prompt.txt'); },
    f => { f.adaptation.independentChecks = []; json(join(f.dir, 'adaptation.json'), f.adaptation); f.evidence.adaptation = f.ref('adaptation.json'); },
    f => { f.execution.commands[0].exitCode = 1; json(join(f.dir, 'execution.json'), f.execution); f.evidence.execution = f.ref('execution.json'); },
    f => { f.review.blockingFindings = ['Needs correction']; json(join(f.dir, 'review.json'), f.review); f.evidence.review = f.ref('review.json'); },
    f => { const content = readFileSync(f.articlePath, 'utf8').replace('<!-- agent-handoff:start -->', ''); writeFileSync(f.articlePath, content); f.evidence.articleSha256 = hash(content); },
  ]) {
    const f = fixture(t); mutate(f); f.save();
    await assert.rejects(publishGuide(f.args), { code: 'GUIDE_EVIDENCE_INVALID' });
    assert.deepEqual(readdirSync(f.cloneDir), []);
  }
});

test('manifest-only occupied and tombstoned identities are refused before writes', async t => {
  for (const removed of [false, true]) {
    const f = fixture(t); mkdirSync(join(f.cloneDir, 'devlog'));
    const manifestPath = join(f.cloneDir, 'devlog/manifest.json');
    json(manifestPath, { entries: [{ version: 'v0.5.1', file: 'v0.5.1.md', ...(removed ? { removed: true } : {}) }] });
    const before = readFileSync(manifestPath, 'utf8');
    await assert.rejects(publishGuide(f.args), /occupied or tombstoned/);
    assert.equal(readFileSync(manifestPath, 'utf8'), before);
    assert.deepEqual(readdirSync(join(f.cloneDir, 'devlog')), ['manifest.json']);
  }
});

test('cover publication requires decoded dimensions and matching visual review of the exact bytes', async t => {
  const f = fixture(t), coverPath = join(f.dir, 'cover.png');
  const cover = await sharp({ create: { width: 1600, height: 900, channels: 3, background: 'white' } }).png({ palette: false }).toBuffer();
  writeFileSync(coverPath, cover); f.evidence.coverSha256 = hash(cover); f.save();
  await assert.rejects(publishGuide({ ...f.args, coverPath }), /Cover bytes/);
  assert.deepEqual(readdirSync(f.cloneDir), []);
  f.review.coverSha256 = hash(cover); f.review.coverReview = 'Fixture is a full-size blank test cover; not an approved editorial image.';
  json(join(f.dir, 'review.json'), f.review); f.evidence.review = f.ref('review.json'); f.save();
  const result = await publishGuide({ ...f.args, coverPath });
  assert.equal(result.coverWritten, true);
  assert.deepEqual(readFileSync(join(f.cloneDir, 'devlog/v0.5.1.png')), cover);
});

test('corrupt and wrong-size covers fail before content mutation even with matching receipts', async t => {
  for (const cover of [Buffer.from('not PNG'), await sharp({ create: { width: 32, height: 32, channels: 3, background: 'white' } }).png().toBuffer()]) {
    const f = fixture(t), coverPath = join(f.dir, 'cover.png');
    writeFileSync(coverPath, cover);
    f.evidence.coverSha256 = hash(cover); f.review.coverSha256 = hash(cover); f.review.coverReview = 'Claimed inspection cannot override failed decoding.';
    json(join(f.dir, 'review.json'), f.review); f.evidence.review = f.ref('review.json'); f.save();
    await assert.rejects(publishGuide({ ...f.args, coverPath }), { code: 'GUIDE_EVIDENCE_INVALID' });
    assert.deepEqual(readdirSync(f.cloneDir), []);
  }
});
