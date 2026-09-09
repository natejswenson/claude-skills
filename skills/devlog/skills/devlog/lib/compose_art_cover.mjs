// Additive, offline raster-art compositor. Success records rendering, never visual approval.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { chromium } from 'playwright';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const escape = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fail = (code, message) => Object.assign(new Error(message), { code });
function string(value, field, max, optional = false) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw fail('ART_SPEC_INVALID', `${field} must be nonempty text of at most ${max} characters without control characters`);
  }
  return value;
}
function local(value, field, base) {
  string(value, field, 4096);
  if (!path.isAbsolute(value) && /^[a-z][a-z0-9+.-]*:/i.test(value)) throw fail('ART_SPEC_INVALID', `${field} must be a local filesystem path`);
  return path.resolve(base, value);
}
async function json(file, field) {
  const bytes = await readFile(file);
  try { return { bytes, value: JSON.parse(bytes.toString('utf8')) }; }
  catch { throw fail('ART_SPEC_INVALID', `${field} must contain valid JSON`); }
}

/** Schema 1: {schema:1, source, brand, title, kicker?, stand?, fontPath?}.
 * Paths in the spec resolve against its directory; outDir resolves against cwd.
 * Output directory must not exist. On failure it may contain partial artifacts,
 * but never result.json; the compositor never deletes any directory.
 */
export async function composeArtCover(specPath, outDir) {
  try { return await compose(specPath, outDir); }
  catch (error) {
    if (error.code?.startsWith('ART_')) throw error;
    throw fail('ART_COMPOSE_FAILED', `Art cover failed: ${error.message}`);
  }
}
async function compose(specPath, outDir) {
  const resolvedSpec = path.resolve(string(specPath, 'specPath', 4096));
  const destination = path.resolve(string(outDir, 'outDir', 4096));
  const base = path.dirname(resolvedSpec);
  const { bytes: specBytes, value: spec } = await json(resolvedSpec, 'spec');
  if (!spec || spec.schema !== 1 || Array.isArray(spec)) throw fail('ART_SPEC_INVALID', 'spec.schema must be 1');
  const known = new Set(['schema', 'source', 'brand', 'title', 'kicker', 'stand', 'fontPath']);
  if (Object.keys(spec).some(key => !known.has(key))) throw fail('ART_SPEC_INVALID', 'Unknown spec field; HTML/CSS input is not supported');
  const title = string(spec.title, 'title', 300);
  const kicker = string(spec.kicker, 'kicker', 80, true) || 'ENGINEERING FIELD NOTES';
  const stand = string(spec.stand, 'stand', 180, true);
  const sourcePath = local(spec.source, 'source', base);
  const brandPath = local(spec.brand, 'brand', base);
  const { bytes: brandBytes, value: brand } = await json(brandPath, 'brand');
  for (const key of ['paper', 'ink', 'dim', 'accent']) {
    if (!/^#[\da-f]{6}$/i.test(brand?.colors?.[key] ?? '')) throw fail('ART_BRAND_INVALID', `brand.colors.${key} must be a six-digit hex color`);
  }
  for (const key of ['display_stack', 'serif_stack', 'mono_stack']) {
    const value = brand?.fonts?.[key];
    if (typeof value !== 'string' || !/^[a-z\d ,"'_-]{1,500}$/i.test(value)) throw fail('ART_BRAND_INVALID', `brand.fonts.${key} must be a safe local font stack`);
  }
  const stamp = string(brand?.identity?.stamp, 'brand.identity.stamp', 12);
  const name = string(brand?.identity?.name, 'brand.identity.name', 80);
  const sourceBytes = await readFile(sourcePath);
  let metadata, raster;
  try {
    metadata = await sharp(sourceBytes, { animated: true, limitInputPixels: 40_000_000 }).metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.pages ?? 1) !== 1) throw Error('Only single-frame PNG, JPEG, or WebP artwork is supported');
    raster = await sharp(sourceBytes, { failOn: 'warning', limitInputPixels: 40_000_000 }).rotate().toColourspace('srgb').png({ palette: false }).toBuffer();
  } catch (e) { throw fail('ART_SOURCE_INVALID', `Cannot decode source artwork: ${e.message}`); }
  let fontCss = '', fontInfo = { mode: 'system-stacks', hostDependent: true, stacks: brand.fonts };
  let display = brand.fonts.display_stack;
  if (spec.fontPath !== undefined) {
    const fontPath = local(spec.fontPath, 'fontPath', base);
    const fontBytes = await readFile(fontPath);
    if (!fontBytes.length || fontBytes.length > 10_000_000) throw fail('ART_FONT_INVALID', 'Local font must contain 1 to 10000000 bytes');
    fontCss = `@font-face{font-family:ArtCoverDisplay;src:url(data:font/ttf;base64,${fontBytes.toString('base64')})}`;
    display = `'ArtCoverDisplay', ${display}`;
    fontInfo = { mode: 'embedded-display', path: fontPath, sha256: hash(fontBytes), hostDependent: true, fallback: 'Display glyph fallback and serif/mono stacks remain host dependent', stacks: brand.fonts };
  }
  const c = brand.colors;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><title>${escape(title)}</title><style>
${fontCss}
*{box-sizing:border-box}html,body{margin:0;width:1600px;height:900px;background:${c.paper};color:${c.ink}}
main{position:relative;width:1600px;height:900px;padding:54px 64px;overflow:hidden}
header{border-top:8px solid ${c.ink};display:flex;align-items:center;gap:20px;padding-top:18px}
.stamp{font:900 25px ${display};border:3px solid ${c.accent};padding:8px;transform:rotate(-4deg)}
.kicker,.name,footer{font:16px ${brand.fonts.mono_stack}}.name{margin-left:auto;color:${c.dim}}.kicker{max-width:820px}
h1{position:absolute;left:64px;top:203px;width:495px;margin:0;font:900 70px/1.02 ${display};letter-spacing:-.03em;overflow-wrap:anywhere}
.art{position:absolute;left:580px;top:196px;width:970px;height:610px;object-fit:contain}
.stand{position:absolute;left:66px;top:675px;width:465px;max-height:128px;margin:0;font:italic 26px/1.3 ${brand.fonts.serif_stack};color:${c.dim}}
footer{position:absolute;left:64px;right:64px;bottom:35px;border-top:2px solid ${c.ink};padding-top:16px;color:${c.dim}}
</style></head><body><main><header><div class="stamp">${escape(stamp)}</div><div class="kicker">${escape(kicker)}</div><div class="name">${escape(name)}</div></header><h1>${escape(title)}</h1><img class="art" alt="" src="data:image/png;base64,${raster.toString('base64')}"><p class="stand">${escape(stand)}</p><footer>IMPLEMENT IT IN YOUR PROJECT</footer></main></body></html>`;
  // Exclusive mkdir establishes ownership; no recursive mkdir and no deletion on errors.
  try { await mkdir(destination); }
  catch (e) { throw fail(e.code === 'EEXIST' ? 'ART_OUTPUT_EXISTS' : 'ART_OUTPUT_INVALID', `Output must be a new directory with an existing parent: ${destination} (${e.message})`); }
  let browser, imageBytes, geometry;
  try {
    browser = await chromium.launch({ headless: true, timeout: 15000 });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await page.route('**/*', route => route.abort());
    await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
    geometry = await page.evaluate(async hasFont => {
      await Promise.race([
        (async () => {
          if (hasFont) {
            try { if (!(await document.fonts.load('70px ArtCoverDisplay')).length) throw Error('No matching face'); }
            catch { throw Error('Embedded display font failed to load'); }
          }
          await document.fonts.ready;
          await Promise.all([...document.images].map(image => image.decode()));
        })(),
        new Promise((_, reject) => setTimeout(() => reject(Error('Font/image readiness timed out')), 10000)),
      ]);
      if (document.querySelector('header').getBoundingClientRect().bottom > 176) throw Error('Header overflows into the title/art area; shorten the kicker or identity');
      const heading = document.querySelector('h1');
      let size = 70;
      while (heading.getBoundingClientRect().bottom > 645 && size > 54) { size -= 2; heading.style.fontSize = `${size}px`; }
      if (heading.getBoundingClientRect().bottom > 645) throw Error('Title overflows at minimum 54px; shorten it');
      const bounds = {};
      for (const selector of ['h1', '.art', '.stand', '.stamp', '.kicker', '.name', 'footer']) {
        const el = document.querySelector(selector), r = el.getBoundingClientRect();
        if (r.left < 0 || r.top < 0 || r.right > 1600 || r.bottom > 900 || el.scrollWidth > el.clientWidth + 1 || (selector === '.stand' && el.scrollHeight > el.clientHeight + 1)) throw Error(`Text or art overflows: ${selector}`);
        bounds[selector] = { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      return { titleFontSize: size, bounds };
    }, Boolean(spec.fontPath));
    imageBytes = await page.screenshot({ type: 'png', timeout: 15000 });
  } catch (e) { throw fail('ART_RENDER_FAILED', `Offline cover render failed: ${e.message}`); }
  finally { if (browser) await browser.close(); }
  const cover = await sharp(imageBytes).removeAlpha().toColourspace('srgb').png({ palette: false, compressionLevel: 9 }).toBuffer();
  const thumbnail = await sharp(cover).resize(320, 180).png({ palette: false }).toBuffer();
  const artifacts = { 'composition.html': Buffer.from(html), 'cover.png': cover, 'thumbnail.png': thumbnail };
  for (const [file, bytes] of Object.entries(artifacts)) await writeFile(path.join(destination, file), bytes, { flag: 'wx' });
  const result = {
    schema: 1, renderer: 'offline-raster-art-v1', visualReview: 'pending', outputDir: destination,
    inputs: { spec: { path: resolvedSpec, sha256: hash(specBytes) }, source: { path: sourcePath, sha256: hash(sourceBytes), format: metadata.format, width: metadata.width, height: metadata.height }, brand: { path: brandPath, sha256: hash(brandBytes) }, font: fontInfo },
    title, geometry, width: 1600, height: 900, palette: false,
    outputs: Object.fromEntries(Object.entries(artifacts).map(([file, bytes]) => [file, { sha256: hash(bytes), bytes: bytes.length }])),
  };
  // Commit marker written last. Absence means this attempt did not complete.
  await writeFile(path.join(destination, 'result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  return result;
}
