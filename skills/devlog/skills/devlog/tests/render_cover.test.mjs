import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { renderCoverImage, checkHeroZoneOverlap, HERO_ZONE, COVER_FONT_FAMILY } from '../lib/render_cover.mjs';

const REAL_FONT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'image-style', 'font.ttf');

// A #hero-zone positioned/sized to exactly match the fixed HERO_ZONE constant — required
// so fixtures reach the overlap-check logic (COVER-Q-5/6) rather than throwing on the
// geometry-mismatch check (COVER-Q-11), which runs first inside checkHeroZoneOverlap.
const heroZoneDiv = `<div id="hero-zone" style="position:absolute; left:${HERO_ZONE.x}px; top:${HERO_ZONE.y}px; width:${HERO_ZONE.width}px; height:${HERO_ZONE.height}px;"></div>`;

const FIXTURE_HTML = `<!DOCTYPE html>
<html><head><style>
  html, body { margin: 0; width: 1600px; height: 900px; background: #0a0a0b; }
  h1 { color: #ededed; font-family: '${COVER_FONT_FAMILY}', sans-serif; }
</style></head>
<body><h1>Fixture cover</h1>${heroZoneDiv}</body></html>`;

// Builds a fixture with #hero-zone at the exact HERO_ZONE box, plus one
// [data-catalog-icon] element positioned via absolute left/top/width/height.
function fixtureWithIcon(iconRect) {
  const icon = `<div data-catalog-icon="testing" style="position:absolute; left:${iconRect.x}px; top:${iconRect.y}px; width:${iconRect.width}px; height:${iconRect.height}px;"></div>`;
  return `<!DOCTYPE html>
<html><head><style>
  html, body { margin: 0; width: 1600px; height: 900px; background: #0a0a0b; }
</style></head>
<body>${heroZoneDiv}${icon}</body></html>`;
}

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
      const src = fn.toString();
      // Stub the two geometry-guard queries so this fake-page test can reach screenshot()
      // without a real DOM: a single hero-zone rect matching HERO_ZONE exactly, and no
      // catalog icons (so the overlap check is a no-op here — geometry ordering is the
      // only thing this test verifies).
      if (src.includes('hero-zone')) return [{ x: HERO_ZONE.x, y: HERO_ZONE.y, width: HERO_ZONE.width, height: HERO_ZONE.height }];
      if (src.includes('data-catalog-icon')) return [];
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
  assert.deepEqual(names, ['setContent', 'addStyleTag', 'evaluate', 'evaluate', 'evaluate', 'evaluate', 'screenshot']);

  const fontEvaluates = calls.filter((c) => c.name === 'evaluate' && /fonts\.(load|ready)/.test(c.fnSource));
  assert.equal(fontEvaluates.length, 2);
  assert.match(fontEvaluates[0].fnSource, /fonts\.load/);
  assert.match(fontEvaluates[1].fnSource, /fonts\.ready/);

  // Geometry-guard evaluates run after the font evaluates and before screenshot.
  const allEvaluateIndexes = calls.map((c, i) => (c.name === 'evaluate' ? i : -1)).filter((i) => i >= 0);
  const screenshotIndex = calls.findIndex((c) => c.name === 'screenshot');
  assert.ok(allEvaluateIndexes.every((i) => i < screenshotIndex));
});

test('checkHeroZoneOverlap throws when #hero-zone is missing (COVER-Q-9a)', async () => {
  const html = `<!DOCTYPE html><html><head><style>html, body { margin: 0; width: 1600px; height: 900px; }</style></head><body><h1>No hero zone</h1></body></html>`;
  await assert.rejects(
    () => renderCoverImage(html, { width: 1600, height: 900, fontPath: REAL_FONT_PATH }),
    /no #hero-zone element/,
  );
});

test('checkHeroZoneOverlap throws when #hero-zone is duplicated (COVER-Q-9b)', async () => {
  const dupHeroZone = heroZoneDiv + heroZoneDiv;
  const html = `<!DOCTYPE html><html><head><style>html, body { margin: 0; width: 1600px; height: 900px; }</style></head><body>${dupHeroZone}</body></html>`;
  await assert.rejects(
    () => renderCoverImage(html, { width: 1600, height: 900, fontPath: REAL_FONT_PATH }),
    /2 elements sharing the #hero-zone id/,
  );
});

test('checkHeroZoneOverlap throws when #hero-zone does not match the fixed HERO_ZONE box (COVER-Q-11)', async () => {
  // A tiny box tucked in a corner — the exact exploit this check exists to close.
  const html = `<!DOCTYPE html><html><head><style>html, body { margin: 0; width: 1600px; height: 900px; }</style></head><body><div id="hero-zone" style="position:absolute; left:0px; top:0px; width:50px; height:50px;"></div></body></html>`;
  await assert.rejects(
    () => renderCoverImage(html, { width: 1600, height: 900, fontPath: REAL_FONT_PATH }),
    /does not match the fixed HERO_ZONE box/,
  );
});

test('checkHeroZoneOverlap succeeds when #hero-zone matches the fixed HERO_ZONE box exactly (COVER-Q-11)', async () => {
  const png = await renderCoverImage(FIXTURE_HTML, { width: 1600, height: 900, fontPath: REAL_FONT_PATH });
  assert.ok(Buffer.isBuffer(png));
});

test('renderCoverImage throws when a catalog icon overlaps #hero-zone (COVER-Q-5)', async () => {
  // Positioned inside the hero zone (which spans x:150-1450, y:425-825).
  const html = fixtureWithIcon({ x: 200, y: 450, width: 40, height: 40 });
  await assert.rejects(
    () => renderCoverImage(html, { width: 1600, height: 900, fontPath: REAL_FONT_PATH }),
    /catalog icon\(s\) \[testing\] overlaps hero zone/i,
  );
});

test('renderCoverImage succeeds when a catalog icon is positioned entirely outside #hero-zone (COVER-Q-6)', async () => {
  // Positioned above the hero zone (y:425), well within the round-5 accent-icon margin.
  const html = fixtureWithIcon({ x: 200, y: 350, width: 24, height: 24 });
  const png = await renderCoverImage(html, { width: 1600, height: 900, fontPath: REAL_FONT_PATH });
  assert.ok(Buffer.isBuffer(png));
});
