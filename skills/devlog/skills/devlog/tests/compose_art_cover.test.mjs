import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { composeArtCover } from '../lib/compose_art_cover.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'devlog-art-cover-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'source.png'), await sharp({ create: { width: 120, height: 240, channels: 3, background: 'white' } }).png().toBuffer());
  await writeFile(join(dir, 'brand.json'), await readFile(new URL('./fixtures/guide/press-tokens.json', import.meta.url)));
  const spec = { schema: 1, source: 'source.png', brand: 'brand.json', title: 'Keep the invariant', ...overrides };
  const file = join(dir, 'spec.json'), out = join(dir, 'output');
  await writeFile(file, JSON.stringify(spec));
  return { dir, spec, file, out };
}

test('offline raster render resolves relative paths, escapes text, produces true-color covers and matching receipts', async t => {
  const f = await fixture(t, { title: 'Use <script> & "quotes"', stand: 'Keep <img src=x> as literal text.' });
  const result = await composeArtCover(f.file, f.out);
  assert.equal(result.visualReview, 'pending');
  assert.equal(result.inputs.font.hostDependent, true);
  assert.equal(result.inputs.source.sha256, digest(await readFile(join(f.dir, 'source.png'))));
  assert.equal(result.inputs.spec.sha256, digest(await readFile(f.file)));
  assert.equal(result.inputs.brand.sha256, digest(await readFile(join(f.dir, 'brand.json'))));
  for (const [file, expected] of Object.entries(result.outputs)) {
    const bytes = await readFile(join(f.out, file));
    assert.equal(digest(bytes), expected.sha256);
    assert.equal(bytes.length, expected.bytes);
  }
  assert.deepEqual(JSON.parse(await readFile(join(f.out, 'result.json'), 'utf8')), result);
  const html = await readFile(join(f.out, 'composition.html'), 'utf8');
  assert.ok(html.includes('Use &lt;script&gt; &amp; &quot;quotes&quot;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('object-fit:contain'));
  const png = await readFile(join(f.out, 'cover.png'));
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 1600); assert.equal(meta.height, 900);
  assert.equal(Boolean(meta.isPalette), false);
  assert.equal(png[25], 2, 'PNG IHDR color type must be true-color RGB');
  const thumb = await sharp(await readFile(join(f.out, 'thumbnail.png'))).metadata();
  assert.equal(thumb.width, 320); assert.equal(thumb.height, 180);
});

test('refuses an existing caller directory without changing its files', async t => {
  const f = await fixture(t);
  await mkdir(f.out); await writeFile(join(f.out, 'owned.txt'), 'keep');
  await assert.rejects(composeArtCover(f.file, f.out), { code: 'ART_OUTPUT_EXISTS' });
  assert.equal(await readFile(join(f.out, 'owned.txt'), 'utf8'), 'keep');
  await assert.rejects(access(join(f.out, 'result.json')));
});

test('accepts native absolute filesystem paths without treating drive letters as URLs', async t => {
  const f = await fixture(t);
  f.spec.source = join(f.dir, 'source.png');
  f.spec.brand = join(f.dir, 'brand.json');
  await writeFile(f.file, JSON.stringify(f.spec));
  const result = await composeArtCover(f.file, f.out);
  assert.equal(result.inputs.source.path, f.spec.source);
  assert.equal(result.inputs.brand.path, f.spec.brand);
});

test('rejects corrupt, vector and animated inputs before creating output', async t => {
  for (const bytes of [Buffer.from('invalid PNG'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), await sharp({ create: { width: 2, height: 4, channels: 3, background: 'red' } }).raw().toBuffer().then(raw => { raw.fill(0, 12); return sharp(raw, { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer(); })]) {
    const f = await fixture(t);
    await writeFile(join(f.dir, 'source.png'), bytes);
    await assert.rejects(composeArtCover(f.file, f.out), { code: 'ART_SOURCE_INVALID' });
    await assert.rejects(access(f.out));
  }
});

test('refuses title overflow and leaves no completion marker', async t => {
  const f = await fixture(t, { title: 'Wide implementation concepts '.repeat(10) });
  await assert.rejects(composeArtCover(f.file, f.out), error => error.code === 'ART_RENDER_FAILED' && /Title overflows/.test(error.message));
  await assert.rejects(access(join(f.out, 'result.json')));
});

test('rejects untrusted CSS and HTML extension fields', async t => {
  const f = await fixture(t, { css: 'body{display:none}' });
  await assert.rejects(composeArtCover(f.file, f.out), { code: 'ART_SPEC_INVALID' });
  delete f.spec.css;
  await writeFile(f.file, JSON.stringify(f.spec));
  const brand = JSON.parse(await readFile(join(f.dir, 'brand.json'), 'utf8'));
  brand.fonts.display_stack = 'Arial; background:url(https://example.com)';
  await writeFile(join(f.dir, 'brand.json'), JSON.stringify(brand));
  await assert.rejects(composeArtCover(f.file, f.out), { code: 'ART_BRAND_INVALID' });
  await assert.rejects(access(f.out));
});

test('fails explicit corrupt font instead of silently accepting fallback', async t => {
  const f = await fixture(t, { fontPath: 'broken.ttf' });
  await writeFile(join(f.dir, 'broken.ttf'), 'broken font');
  await assert.rejects(composeArtCover(f.file, f.out), error => error.code === 'ART_RENDER_FAILED' && /font|Font/.test(error.message) && !/browserType.launch/.test(error.message));
  await assert.rejects(access(join(f.out, 'result.json')));
});


test('embeds the provided local display font and records its bytes', async t => {
  const f = await fixture(t, { fontPath: 'display.ttf' });
  const bytes = await readFile(new URL('../image-style/font.ttf', import.meta.url));
  await writeFile(join(f.dir, 'display.ttf'), bytes);
  const result = await composeArtCover(f.file, f.out);
  assert.equal(result.inputs.font.mode, 'embedded-display');
  assert.equal(result.inputs.font.sha256, digest(bytes));
  assert.match(result.inputs.font.fallback, /host dependent/);
});
