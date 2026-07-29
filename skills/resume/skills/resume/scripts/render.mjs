#!/usr/bin/env node
/**
 * render.mjs — render a tailored résumé JSON to a PDF using a CSS theme.
 *
 * The skill has ONE résumé structure (scripts/build-html.mjs) and swappable
 * themes (assets/themes/*.css). Adding a look means writing a stylesheet, not
 * adding a config to a hardcoded union — see references/theme-contract.md.
 *
 * Rendering is headless Chromium via Playwright. The theme CSS is inlined
 * into the document and handed to page.setContent(), never loaded from disk
 * by the browser, so rendering does not depend on the working directory.
 *
 * Usage:
 *   node scripts/render.mjs --json <path> [--theme <name|path>] [--out <dir>] [--open]
 *
 * Flags:
 *   --json <path>     path to a tailored résumé JSON (see scripts/validate.mjs's ResumeJSON)
 *   --theme <ref>     shipped theme name, or a path to your own .css (default: press)
 *   --out <dir>       output directory (default: ~/resume-out)
 *   --open            open the rendered PDF in the default viewer when done
 *   --json-output     print the result as JSON instead of a plain line
 *   -h, --help        show this help
 */
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, basename } from "node:path";
import { homedir, platform } from "node:os";
import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

import { ResumeJSON } from "./validate.mjs";
import { buildResumeHtml } from "./build-html.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(__dirname, "..");

/** Themes that ship with the skill. */
export const SHIPPED_THEMES_DIR = join(SKILL_ROOT, "assets", "themes");
/** The user's personal themes, which win over shipped ones of the same name. */
export const HOME_THEMES_DIR = join(homedir(), ".claude", "resume", "themes");
export const DEFAULT_THEME = "press";

/** Names of the shipped themes, derived from the directory (not hardcoded). */
export function shippedThemeNames() {
  try {
    return readdirSync(SHIPPED_THEMES_DIR)
      .filter((f) => f.endsWith(".css"))
      .map((f) => f.replace(/\.css$/, ""))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Resolve a theme reference to a concrete stylesheet.
 *
 * Precedence, mirroring ghostwriter's brand_css_path():
 *   1. an explicit path (anything containing a separator or ending in .css)
 *   2. ~/.claude/resume/themes/<name>.css   — the user's replaceable copy
 *   3. assets/themes/<name>.css             — the shipped default
 *
 * An unknown NAME throws rather than falling back. A silent fallback means the
 * user asks for one look, gets another, and the PDF renders fine and looks
 * deliberate — there is no way to notice.
 *
 * @returns {{name: string, path: string, source: "custom"|"home"|"shipped"}}
 */
export function resolveTheme(ref) {
  const name = ref || DEFAULT_THEME;

  // 1. An explicit path wins outright.
  if (name.includes("/") || name.includes("\\") || name.endsWith(".css")) {
    const path = resolve(name);
    if (!existsSync(path)) {
      throw new Error(`theme_not_found: no stylesheet at ${path}`);
    }
    return { name: basename(path).replace(/\.css$/, ""), path, source: "custom" };
  }

  // 2. The user's own copy of a named theme.
  const homePath = join(HOME_THEMES_DIR, `${name}.css`);
  if (existsSync(homePath)) return { name, path: homePath, source: "home" };

  // 3. The shipped theme.
  const shippedPath = join(SHIPPED_THEMES_DIR, `${name}.css`);
  if (existsSync(shippedPath)) return { name, path: shippedPath, source: "shipped" };

  const known = shippedThemeNames().join(", ");
  throw new Error(
    `unknown_theme: ${name} — choose one of ${known}, or pass a path to your own .css`
  );
}

function slug(value, max = 60) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

/**
 * Filename for one rendered résumé.
 *
 * When the résumé records what it was tailored for, the name carries it:
 *   nate-swenson-alteryx-ai-platform-engineer.pdf
 * Without that every application overwrites the last one, which is exactly
 * what happened in the first live run.
 *
 * The default theme owns the plain name; any other theme appends its own, so
 * the primary deliverable stays the obvious file in the directory.
 */
export function outputStem(resume, themeName) {
  const person = slug(resume?.name) || "resume";
  const t = resume?.target;
  const base =
    t?.company && t?.role
      ? [person, slug(t.company, 40), slug(t.role, 60)].filter(Boolean).join("-")
      : person;
  return themeName === DEFAULT_THEME && t?.company && t?.role
    ? base
    : `${base}-${themeName}`;
}

/** US Letter at 96dpi, and a nominal half-inch page inset for previews. */
const PREVIEW_WIDTH = 816;
const PREVIEW_INSET_PX = 48;

async function openBrowser(launch) {
  let doLaunch = launch;
  if (!doLaunch) {
    const { chromium } = await import("playwright");
    doLaunch = (o) => chromium.launch(o);
  }
  try {
    return await doLaunch(undefined);
  } catch (err) {
    throw new Error(
      "Chromium is not installed (or failed to launch) — run `npx playwright install chromium`.\n" +
        `  underlying error: ${err?.message ?? err}`
    );
  }
}

/** Write one document's PDF (and optionally a preview PNG) using an open browser. */
async function printOne(browser, html, pdfPath, { timeoutMs, previewPath }) {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
    await page.pdf({
      path: pdfPath,
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
      timeout: timeoutMs,
    });
    if (previewPath) {
      // Print media so the preview shows the themed page, not a screen variant.
      // A full-page shot rather than faked page slices: Chromium does not
      // paginate the DOM, so any "page 2" crop would be a guess that disagrees
      // with the real PDF at every break-inside rule.
      await page.emulateMedia({ media: "print" });
      await page.setViewportSize({ width: PREVIEW_WIDTH, height: 1056 });
      // @page margins apply to paged media only, so on screen the content runs
      // to the viewport edge and the preview looks clipped. Re-inset it here.
      // Safe to mutate: the PDF is already written by this point.
      await page.addStyleTag({
        content: `html { padding: ${PREVIEW_INSET_PX}px; box-sizing: border-box; }`,
      });
      await page.screenshot({ path: previewPath, fullPage: true });
    }
  } finally {
    await page.close();
  }
}

/** Page count, read straight from the PDF we just wrote. */
async function pdfPageCount(pdfPath) {
  try {
    const { getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(readFileSync(pdfPath)));
    return doc.numPages;
  } catch {
    return null;
  }
}

/**
 * Render résumé HTML to a PDF at outPath.
 *
 * `launch` is a test-only seam (same shape as devlog's renderCoverImage): it
 * lets a test inject a fake browser and assert the call sequence without
 * paying for a real Chromium launch. It is not part of the documented CLI.
 */
export async function renderHtmlToPdf(html, outPath, opts = {}) {
  const { timeoutMs = 30000, launch, previewPath } = opts;
  const browser = await openBrowser(launch);
  try {
    await printOne(browser, html, outPath, { timeoutMs, previewPath });
  } finally {
    await browser.close();
  }
  return outPath;
}

/**
 * Render a tailored résumé to a PDF in the given theme/outDir.
 *
 * The generated HTML is written next to the PDF on purpose: tweaking the
 * markup or CSS and re-rendering is the intended loop when authoring a theme,
 * and deleting the source on success breaks it.
 *
 * @returns {Promise<{pdfPath: string, htmlPath: string, theme: object}>}
 */
/**
 * Render one résumé in several themes using a SINGLE browser.
 *
 * Chromium launch dominates the cost of a render (roughly a second), so
 * launching per theme doubled the wall clock for what is otherwise the same
 * work. Every theme shares one browser and gets its own page.
 */
export async function renderThemes(resume, themeRefs, outDir, opts = {}) {
  const { timeoutMs = 30000, launch, preview = false } = opts;
  const themes = themeRefs.map(resolveTheme);

  await mkdir(outDir, { recursive: true });
  const browser = await openBrowser(launch);
  const results = [];
  try {
    for (const theme of themes) {
      const css = readFileSync(theme.path, "utf8");
      const html = buildResumeHtml(resume, css);
      const stem = outputStem(resume, theme.name);
      const pdfPath = join(outDir, `${stem}.pdf`);
      const htmlPath = join(outDir, `${stem}.html`);
      const previewPath = preview ? join(outDir, `${stem}-preview.png`) : undefined;

      writeFileSync(htmlPath, html, "utf8");
      await printOne(browser, html, pdfPath, { timeoutMs, previewPath });
      results.push({ pdfPath, htmlPath, previewPath: previewPath ?? null, theme });
    }
  } finally {
    await browser.close();
  }

  for (const r of results) r.pages = await pdfPageCount(r.pdfPath);
  return results;
}

/** Single-theme convenience wrapper over renderThemes(). */
export async function renderThemeFromResume(resume, themeRef, outDir, opts = {}) {
  const [only] = await renderThemes(resume, [themeRef], outDir, opts);
  return only;
}

const HELP = `render — render a tailored résumé JSON to a themed PDF

Usage:
  node scripts/render.mjs --json <path> [flags]

Flags:
  --json <path>     path to a tailored résumé JSON (see scripts/validate.mjs's ResumeJSON)
  --theme <refs>    comma-separated theme names or .css paths (default: ${DEFAULT_THEME}).
                    Several themes share ONE browser, so rendering both shipped
                    themes costs barely more than rendering one.
  --out <dir>       output directory (default: ~/resume-out)
  --preview         also write a PNG of each rendered résumé, for showing the user
  --open            open the first rendered PDF in the default viewer when done
  --json-output     print the result as JSON instead of plain lines
  -h, --help        show this help

Output names come from the résumé's \`target\` ({company, role}) when it has one:
  nate-swenson-alteryx-ai-platform-engineer.pdf        (default theme)
  nate-swenson-alteryx-ai-platform-engineer-ats-plain.pdf`;

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") flags.help = true;
    else if (a === "--json") flags.json = argv[++i];
    else if (a === "--theme") flags.theme = argv[++i];
    else if (a === "--out") flags.out = argv[++i];
    else if (a === "--preview") flags.preview = true;
    else if (a === "--open") flags.open = true;
    else if (a === "--json-output") flags.jsonOutput = true;
  }
  return flags;
}

/** Open a file in the OS default app. Best-effort, non-blocking, never throws. */
function openFile(path) {
  try {
    if (platform() === "win32") {
      // `start "<path>"` treats the first quoted arg as a window title, not
      // the target — pass an empty title explicitly so paths with spaces work.
      const child = spawn("cmd", ["/c", "start", "", path], {
        stdio: "ignore",
        detached: true,
      });
      child.on("error", () => {});
      child.unref();
      return true;
    }
    const cmd = platform() === "darwin" ? "open" : "xdg-open";
    const child = spawn(cmd, [path], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(HELP);
    console.log(`\nShipped themes: ${shippedThemeNames().join(", ")}`);
    return;
  }
  if (!flags.json) {
    console.error("Error: --json <path> is required.\n");
    console.error(HELP);
    process.exit(2);
  }

  const jsonPath = resolve(flags.json);
  let raw;
  try {
    raw = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (err) {
    console.error(`✖ could not read résumé JSON at ${jsonPath}: ${err.message ?? err}`);
    process.exit(1);
  }
  const parsed = ResumeJSON.safeParse(raw);
  if (!parsed.success) {
    console.error(`✖ invalid résumé JSON at ${jsonPath} (does not match the ResumeJSON schema):`);
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  const outDir = flags.out ? resolve(flags.out) : join(homedir(), "resume-out");
  const themeRefs = (flags.theme ?? DEFAULT_THEME)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  let results;
  const startedAt = Date.now();
  try {
    results = await renderThemes(parsed.data, themeRefs, outDir, { preview: flags.preview });
  } catch (err) {
    console.error(`✖ ${err.message ?? err}`);
    process.exit(1);
  }
  const elapsedMs = Date.now() - startedAt;

  if (flags.open && results[0]) openFile(results[0].pdfPath);

  if (flags.jsonOutput) {
    console.log(
      JSON.stringify(
        {
          elapsedMs,
          target: parsed.data.target ?? null,
          rendered: results.map((r) => ({
            theme: r.theme.name,
            themeSource: r.theme.source,
            themePath: r.theme.path,
            pages: r.pages,
            pdfPath: r.pdfPath,
            htmlPath: r.htmlPath,
            previewPath: r.previewPath,
          })),
        },
        null,
        2
      )
    );
  } else {
    for (const r of results) {
      const where = r.theme.source === "shipped" ? "" : ` (${r.theme.source})`;
      const pages = r.pages ? `${r.pages}p` : "?";
      console.log(
        `✓ ${r.theme.name}${where} · ${pages} → ${relative(process.cwd(), r.pdfPath) || r.pdfPath}`
      );
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`\n✖ ${err.message ?? err}`);
    process.exit(1);
  });
}
