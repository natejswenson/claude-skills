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

function sanitizeStem(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Render résumé HTML to a PDF at outPath.
 *
 * `launch` is a test-only seam (same shape as devlog's renderCoverImage): it
 * lets a test inject a fake browser and assert the call sequence without
 * paying for a real Chromium launch. It is not part of the documented CLI.
 */
export async function renderHtmlToPdf(html, outPath, opts = {}) {
  const { timeoutMs = 30000, launch } = opts;

  let doLaunch = launch;
  if (!doLaunch) {
    const { chromium } = await import("playwright");
    doLaunch = (o) => chromium.launch(o);
  }

  let browser;
  try {
    browser = await doLaunch(undefined);
  } catch (err) {
    throw new Error(
      "Chromium is not installed (or failed to launch) — run `npx playwright install chromium`.\n" +
        `  underlying error: ${err?.message ?? err}`
    );
  }

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
    await page.pdf({
      path: outPath,
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
      timeout: timeoutMs,
    });
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
export async function renderThemeFromResume(resume, themeRef, outDir, opts = {}) {
  const theme = resolveTheme(themeRef);
  const css = readFileSync(theme.path, "utf8");
  const html = buildResumeHtml(resume, css);

  await mkdir(outDir, { recursive: true });
  const stem = sanitizeStem(resume.name) || "resume";
  const pdfPath = join(outDir, `${stem}-${theme.name}.pdf`);
  const htmlPath = join(outDir, `${stem}-${theme.name}.html`);

  writeFileSync(htmlPath, html, "utf8");
  await renderHtmlToPdf(html, pdfPath, opts);

  return { pdfPath, htmlPath, theme };
}

const HELP = `render — render a tailored résumé JSON to a themed PDF

Usage:
  node scripts/render.mjs --json <path> [flags]

Flags:
  --json <path>     path to a tailored résumé JSON (see scripts/validate.mjs's ResumeJSON)
  --theme <ref>     shipped theme name, or a path to your own .css (default: ${DEFAULT_THEME})
  --out <dir>       output directory (default: ~/resume-out)
  --open            open the rendered PDF in the default viewer when done
  --json-output     print the result as JSON instead of a plain line
  -h, --help        show this help`;

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") flags.help = true;
    else if (a === "--json") flags.json = argv[++i];
    else if (a === "--theme") flags.theme = argv[++i];
    else if (a === "--out") flags.out = argv[++i];
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

  let result;
  try {
    result = await renderThemeFromResume(parsed.data, flags.theme, outDir);
  } catch (err) {
    console.error(`✖ ${err.message ?? err}`);
    process.exit(1);
  }

  if (flags.open) openFile(result.pdfPath);

  if (flags.jsonOutput) {
    console.log(
      JSON.stringify(
        {
          pdfPath: result.pdfPath,
          htmlPath: result.htmlPath,
          theme: result.theme.name,
          themeSource: result.theme.source,
          themePath: result.theme.path,
        },
        null,
        2
      )
    );
  } else {
    const where = result.theme.source === "shipped" ? "" : ` (${result.theme.source})`;
    console.log(
      `✓ Rendered ${result.theme.name} theme${where} → ${relative(process.cwd(), result.pdfPath) || result.pdfPath}`
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`\n✖ ${err.message ?? err}`);
    process.exit(1);
  });
}
