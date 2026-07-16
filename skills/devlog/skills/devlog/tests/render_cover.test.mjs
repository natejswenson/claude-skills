import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { renderCoverImage, COVER_FONT_FAMILY } from '../lib/render_cover.mjs';

const REAL_FONT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'image-style', 'font.ttf');

const FIXTURE_HTML = `<!DOCTYPE html>
<html><head><style>
  html, body { margin: 0; width: 1600px; height: 900px; background: #0a0a0b; }
  h1 { color: #ededed; font-family: '${COVER_FONT_FAMILY}', sans-serif; }
</style></head>
<body><h1>Fixture cover</h1></body></html>`;

function makeTmpDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'devlog-render-cover-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('renderCoverImage returns a PNG buffer of exactly the requested pixel dimensions', async () => {
  const png = await renderCoverImage(FIXTURE_HTML, { width: 1600, height: 900, fontPath: REAL_FONT_PATH });
  assert.ok(Buffer.isBuffer(png));
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 1600);
  assert.equal(meta.height, 900);
});

test('renderCoverImage throws after its configured timeout rather than hanging', async () => {
  await assert.rejects(
    () => renderCoverImage(FIXTURE_HTML, { width: 1600, height: 900, fontPath: REAL_FONT_PATH, timeoutMs: 1 }),
    /timed out|Timeout/i,
  );
});

test('renderCoverImage throws an actionable error when Chromium is not installed', async () => {
  await assert.rejects(
    () => renderCoverImage(FIXTURE_HTML, {
      width: 1600,
      height: 900,
      fontPath: REAL_FONT_PATH,
      executablePath: '/nonexistent/path/to/chromium-binary',
    }),
    /Chromium is not installed.*npx playwright install chromium/s,
  );
});

test('renderCoverImage throws when the installed font file is missing', async (t) => {
  const dir = makeTmpDir(t);
  await assert.rejects(
    () => renderCoverImage(FIXTURE_HTML, { width: 1600, height: 900, fontPath: join(dir, 'missing-font.ttf') }),
    /Cover font not found/,
  );
});

test('renderCoverImage throws when the installed font file is zero-byte/corrupted', async (t) => {
  const dir = makeTmpDir(t);
  const fontPath = join(dir, 'font.ttf');
  writeFileSync(fontPath, '');
  await assert.rejects(
    () => renderCoverImage(FIXTURE_HTML, { width: 1600, height: 900, fontPath }),
    /empty \(0 bytes\)/,
  );
});

test('renderCoverImage validates its own arguments before touching the font or Chromium', async () => {
  await assert.rejects(() => renderCoverImage('', { width: 1600, height: 900 }), /non-empty string/);
  await assert.rejects(() => renderCoverImage(FIXTURE_HTML, { width: 0, height: 900 }), /positive integers/);
});

test('renderCoverImage calls document.fonts.load() then document.fonts.ready, after addStyleTag and before screenshot', async () => {
  const calls = [];
  const fakePngBytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .png()
    .toBuffer();

  const fakePage = {
    setContent: async (...args) => { calls.push({ name: 'setContent', args }); },
    addStyleTag: async (...args) => { calls.push({ name: 'addStyleTag', args }); },
    evaluate: async (fn, arg) => {
      calls.push({ name: 'evaluate', fnSource: fn.toString(), arg });
      return undefined;
    },
    screenshot: async (...args) => { calls.push({ name: 'screenshot', args }); return fakePngBytes; },
  };
  const fakeBrowser = {
    newPage: async () => fakePage,
    close: async () => {},
  };

  const png = await renderCoverImage(FIXTURE_HTML, {
    width: 1600,
    height: 900,
    fontPath: REAL_FONT_PATH,
    launch: async () => fakeBrowser,
  });
  assert.ok(Buffer.isBuffer(png));

  const names = calls.map((c) => c.name);
  assert.deepEqual(names, ['setContent', 'addStyleTag', 'evaluate', 'evaluate', 'screenshot']);

  const [firstEvaluate, secondEvaluate] = calls.filter((c) => c.name === 'evaluate');
  assert.match(firstEvaluate.fnSource, /fonts\.load/);
  assert.match(secondEvaluate.fnSource, /fonts\.ready/);
});
