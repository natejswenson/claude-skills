import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { lintGuide, prepareGuidePreview } from '../lib/guide_draft.mjs';

const fixture = fileURLToPath(new URL('./fixtures/guide/import-safe-cli.md', import.meta.url));
const brandPath = fileURLToPath(new URL('./fixtures/guide/press-tokens.json', import.meta.url));
const markdown = await fs.readFile(fixture, 'utf8');
const start = '<!-- agent-handoff:start -->';
const end = '<!-- agent-handoff:end -->';
const block = markdown.slice(markdown.indexOf(start), markdown.indexOf(end) + end.length);
const prompt = block.match(/```text\n([\s\S]*?)\n```/)[1];
const payload = `${prompt}\n\n<reference-guide>\n${markdown.replace(block, '').trim()}\n</reference-guide>\n`;
async function scratch(t) {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'devlog-guide-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('real ESM pilot passes guide lint; mutations fail without weakening legacy rules', () => {
  assert.equal(lintGuide(markdown, { voice: true }).ok, true);
  assert.equal(lintGuide(markdown.replaceAll('\n', '\r\n')).ok, true);
  const bad = [markdown.replace(block, ''), markdown + block, markdown.replace(start, 'SWAP-MARKER').replace(end, start).replace('SWAP-MARKER', end), markdown.replace(start, 'Intro before handoff.\n' + start), markdown.replace(prompt, ' '), markdown.replace('```text', '```sh'), markdown.replace('## Gotchas', '## Notes'), markdown.replace(end, '```text\nsecond\n```\n' + end)];
  for (const value of bad) assert.equal(lintGuide(value).ok, false);
});

test('preview preserves exact copy payload, immutable source, portable outputs and hashes', async t => {
  const dir = await scratch(t);
  const outDir = path.join(dir, 'draft');
  const result = await prepareGuidePreview({ articlePath: fixture, outDir, brandPath });
  assert.equal(await fs.readFile(path.join(outDir, 'article.md'), 'utf8'), markdown);
  assert.equal(await fs.readFile(path.join(outDir, 'agent-prompt.txt'), 'utf8'), payload);
  assert.equal(result.agentPromptSha256, createHash('sha256').update(payload).digest('hex'));
  assert.equal(result.previewSha256, createHash('sha256').update(await fs.readFile(path.join(outDir, 'index.html'))).digest('hex'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(outDir, 'result.json'), 'utf8')), result);
  assert.deepEqual(result.verification, { implementation: 'not-run', independentReview: 'not-run' });
  assert.ok(!JSON.stringify(result).includes(dir));
  await assert.rejects(prepareGuidePreview({ articlePath: fixture, outDir, brandPath }), { code: 'EEXIST' });
  assert.equal(await fs.readFile(path.join(outDir, 'agent-prompt.txt'), 'utf8'), payload);
  const link = path.join(dir, 'alias');
  await fs.symlink(outDir, link);
  await assert.rejects(prepareGuidePreview({ articlePath: fixture, outDir: link, brandPath }), { code: 'EEXIST' });
});

test('bad source, injected brand and corrupt cover fail before creating output', async t => {
  const dir = await scratch(t);
  const articlePath = path.join(dir, 'bad.md');
  await fs.writeFile(articlePath, markdown.replace(block, ''));
  const outDir = path.join(dir, 'draft');
  await assert.rejects(prepareGuidePreview({ articlePath, outDir, brandPath }), error => error.code === 'GUIDE_LINT' && error.findings.some(f => f.rule === 'guide-handoff-markers'));
  const injected = JSON.parse(await fs.readFile(brandPath, 'utf8'));
  injected.fonts.display_stack = 'sans-serif;} </style><script>alert(1)</script>';
  const badBrand = path.join(dir, 'brand.json');
  await fs.writeFile(badBrand, JSON.stringify(injected));
  await assert.rejects(prepareGuidePreview({ articlePath: fixture, outDir, brandPath: badBrand }), { code: 'GUIDE_BRAND_INVALID' });
  const coverPath = path.join(dir, 'cover.png');
  await fs.writeFile(coverPath, 'not a PNG');
  await assert.rejects(prepareGuidePreview({ articlePath: fixture, outDir, brandPath, coverPath }), { code: 'GUIDE_COVER_INVALID' });
  await assert.rejects(fs.stat(outDir), { code: 'ENOENT' });
});

test('unbundled assets fail before output, including reference links and remote images', async t => {
  const dir = await scratch(t);
  const articlePath = path.join(dir, 'article.md');
  const outDir = path.join(dir, 'draft');
  for (const suffix of ['\n[Example](example.zip)\n', '\n[Example][download]\n\n[download]: ./example.zip\n', '\n![Diagram](diagram.png)\n', '\n![Diagram](https://example.com/image.png)\n']) {
    await fs.writeFile(articlePath, markdown.replace('## Gotchas', suffix + '\n## Gotchas'));
    await assert.rejects(prepareGuidePreview({ articlePath, outDir, brandPath }), { code: 'GUIDE_ASSET_UNSUPPORTED' });
    await assert.rejects(fs.stat(outDir), { code: 'ENOENT' });
  }
});

test('real browser copies exact payload, handles denied clipboard, and renders no-JS handoff safely', async t => {
  const dir = await scratch(t);
  const articlePath = path.join(dir, 'article.md');
  const hostile = markdown.replace('title: "Give your CLI an import-safe entrypoint"', 'title: "</title><script>window.pwned=true</script>"') + '\n<script>window.pwned=true</script>\n\nFootnote claim.[^note]\n\n[^note]: Footnote explanation.\n';
  await fs.writeFile(articlePath, hostile);
  const coverPath = path.join(dir, 'input.png');
  await sharp({ create: { width: 1600, height: 900, channels: 3, background: 'white' } }).png().toFile(coverPath);
  const outDir = path.join(dir, 'draft');
  await prepareGuidePreview({ articlePath, outDir, brandPath, coverPath });
  const expected = await fs.readFile(path.join(outDir, 'agent-prompt.txt'), 'utf8');
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(pathToFileURL(path.join(outDir, 'index.html')).href);
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  const footnoteRef = page.locator('a[data-footnote-ref]');
  assert.equal(await footnoteRef.getAttribute('aria-describedby'), 'footnote-label');
  const referenceId = await footnoteRef.getAttribute('id');
  const noteTarget = await footnoteRef.getAttribute('href');
  assert.equal(await page.locator(noteTarget).count(), 1);
  const backref = page.locator('a[data-footnote-backref]');
  assert.equal(await backref.getAttribute('href'), `#${referenceId}`);
  await footnoteRef.click();
  assert.equal(new URL(page.url()).hash, noteTarget);
  await backref.click();
  assert.equal(new URL(page.url()).hash, `#${referenceId}`);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copied = text; } } }));
  await page.locator('#copy-agent').click();
  assert.equal(await page.evaluate(() => window.copied), expected);
  assert.match(await page.locator('#copy-status').textContent(), /^Copied/);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Denied'); } } }));
  await page.locator('#copy-agent').click();
  assert.equal(await page.locator('#copy-fallback').inputValue(), expected);
  assert.equal(await page.locator('#copy-fallback').isVisible(), true);
  assert.match(await page.locator('#copy-status').textContent(), /Automatic copy is unavailable/);
  assert.equal(await page.evaluate(() => document.querySelector('#copy-fallback').selectionEnd), expected.length);
  assert.ok(await page.evaluate(() => document.querySelector('.agent-handoff').getBoundingClientRect().top < document.querySelector('figure').getBoundingClientRect().top));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const noJs = await browser.newPage({ javaScriptEnabled: false });
  await noJs.goto(pathToFileURL(path.join(outDir, 'index.html')).href);
  assert.equal(await noJs.locator('noscript a').getAttribute('href'), 'agent-prompt.txt');
  assert.ok((await noJs.locator('main').textContent()).includes('Set up one complete package'));
});
