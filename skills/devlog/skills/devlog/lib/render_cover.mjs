// Rasterize a Claude-composed HTML/CSS cover into a fixed-size PNG.
//
// This is the one genuinely deterministic, testable function in the cover-generation
// path — composing the HTML itself is agent behavior, not a library call (see SKILL.md
// Step 5 / devlog cover-context). Uses headless Chromium (the `playwright` package,
// never `playwright-core` — the CLI needs the full package so
// `npx playwright install chromium` works).
import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import sharp from 'sharp';

export const COVER_FONT_FAMILY = 'DevlogCoverFont';
export const DEFAULT_RENDER_TIMEOUT_MS = 15000;
const FONT_PATH = join(homedir(), '.claude', 'skills', 'devlog', 'image-style', 'font.ttf');
const QUANTIZE_TARGET_BYTES = 500 * 1024;

// Deterministic Node code, never agent-authored text: reads the installed font file and
// builds a base64 data URI. The font's bytes never pass through Claude's own text
// generation — a qualitatively different (and much less reliable, at this size) operation
// than Claude directly viewing reference cover images.
function readFontBase64(fontPath) {
  if (!existsSync(fontPath)) {
    throw new Error(`Cover font not found at ${fontPath} — run \`devlog init\` to install it.`);
  }
  let bytes;
  try {
    bytes = readFileSync(fontPath);
  } catch (e) {
    throw new Error(`Cover font at ${fontPath} could not be read: ${e.message}`);
  }
  if (bytes.length === 0) {
    throw new Error(`Cover font at ${fontPath} is empty (0 bytes) — reinstall it with \`devlog init\`.`);
  }
  return bytes.toString('base64');
}

// Lossy palette quantization toward a ~300-500KB target. Best-effort: never throws for
// size reasons, just returns the smallest of the attempts tried. Quantization affects
// color depth/file size only, never pixel dimensions.
async function quantize(pngBuffer) {
  const attempts = [
    { palette: true, quality: 90, effort: 8 },
    { palette: true, quality: 70, colors: 128, effort: 8 },
    { palette: true, quality: 50, colors: 64, effort: 8 },
  ];
  let best = pngBuffer;
  for (const opts of attempts) {
    let out;
    try {
      out = await sharp(pngBuffer).png(opts).toBuffer();
    } catch {
      continue; // this attempt's options weren't accepted; fall through to the next
    }
    if (out.length < best.length) best = out;
    if (out.length <= QUANTIZE_TARGET_BYTES) return out;
  }
  return best;
}

/**
 * @param {string} html full, self-contained HTML document (must start with <!DOCTYPE html>)
 * @param {{width:number, height:number, timeoutMs?:number, fontPath?:string, executablePath?:string}} opts
 * @returns {Promise<Buffer>} PNG bytes, exactly {width}x{height} pixels
 *
 * Throws on exactly three realistic failure modes: a render timeout; Chromium not being
 * installed; a missing/unreadable installed font file. Does NOT throw on malformed HTML —
 * Chromium's HTML5 parser is deliberately fault-tolerant and recovers into some DOM
 * regardless of input; a poorly composed document renders wrong, it doesn't fail to render.
 */
export async function renderCoverImage(html, opts = {}) {
  const {
    width,
    height,
    timeoutMs = DEFAULT_RENDER_TIMEOUT_MS,
    fontPath = FONT_PATH,
    executablePath,
    // Test-only seam, not part of the documented contract: lets tests inject a fake
    // launch() to spy on page.setContent/addStyleTag/evaluate/screenshot call order
    // without spinning up real Chromium. Defaults to the real playwright launcher.
    launch = executablePath ? (o) => chromium.launch({ ...o, executablePath }) : (o) => chromium.launch(o),
  } = opts;

  if (typeof html !== 'string' || html.trim() === '') {
    throw new Error('renderCoverImage: html must be a non-empty string');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('renderCoverImage: width/height must be positive integers');
  }

  // Read + validate the font BEFORE ever launching Chromium — a missing/corrupt font is a
  // plain, cheap filesystem check and shouldn't cost a browser launch to detect.
  const fontBase64 = readFontBase64(fontPath);

  let browser;
  try {
    browser = await launch(undefined);
  } catch (e) {
    throw new Error(
      `Chromium is not installed (or failed to launch) — run \`npx playwright install chromium\`. (${e.message})`
    );
  }

  try {
    const page = await browser.newPage({ viewport: { width, height } });

    // Parse Claude's document exactly as authored first, in standards mode — never a raw
    // string prepend of the font-face rule, which would force quirks mode (per the HTML5
    // tree-construction algorithm, any non-whitespace content before the DOCTYPE token
    // does) and risks a same-specificity shadow from Claude's own CSS.
    await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });

    // Inject the real font into the already-parsed document via the DOM API. Landing here
    // — added after the page's own stylesheets are already parsed — also means this rule
    // wins any cascade tie against markup referencing the same family, by document order.
    const fontFaceCss =
      `@font-face { font-family: '${COVER_FONT_FAMILY}'; ` +
      `src: url(data:font/ttf;base64,${fontBase64}) format('truetype'); }`;
    await page.addStyleTag({ content: fontFaceCss });

    // Merely declaring @font-face does not synchronously start the load — Chromium only
    // triggers the fetch/decode once a style-recalc discovers text resolving to that
    // family, and that recalc isn't guaranteed to have run yet. document.fonts.load()
    // explicitly kicks off the load so the immediately-following document.fonts.ready
    // check is guaranteed to cover it, closing a real race where the ready-promise could
    // otherwise resolve before the embedded font has actually finished decoding.
    const fontsReady = (async () => {
      await page.evaluate((family) => document.fonts.load(`1em '${family}'`), COVER_FONT_FAMILY);
      await page.evaluate(() => document.fonts.ready);
    })();
    // Attach a no-op handler immediately so a late rejection (e.g. the timeout branch below
    // wins the race, then this promise itself rejects after the page is torn down) never
    // surfaces as an unhandled rejection — the race below is still driven by this same
    // promise reference.
    fontsReady.catch(() => {});
    await Promise.race([
      fontsReady,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`renderCoverImage: timed out after ${timeoutMs}ms waiting on font load`)),
          timeoutMs
        )
      ),
    ]);

    // Viewport-clipped screenshot (fullPage omitted/false, Playwright's default) — never
    // fullPage: true, which would capture the whole scrollable page rather than just the
    // viewport. This is what guarantees the output is always exactly {width, height}
    // regardless of whether the composed HTML's content overflows it.
    const png = await page.screenshot({ type: 'png', timeout: timeoutMs });
    return await quantize(png);
  } finally {
    await browser.close();
  }
}
