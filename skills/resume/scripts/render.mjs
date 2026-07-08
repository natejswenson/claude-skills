#!/usr/bin/env node
/**
 * render.mjs — render a tailored résumé JSON to a PDF in one of 7 templates.
 *
 * Self-registers the TS-on-the-fly loader so it runs as a plain
 * `node scripts/render.mjs ...` (same pattern the old bin/resume.mjs used —
 * no --import flag needed).
 *
 * Usage:
 *   node scripts/render.mjs --json <path> [--template <name>] [--out <dir>] [--open] [--json-output]
 *
 * Flags:
 *   --json <path>       path to a tailored résumé JSON (schemas/resume.ts shape)
 *   --template <name>   modern | classic | technical | polished | timeline | editorial | spotlight (default: modern)
 *   --out <dir>         output directory (default: ~/resume-out)
 *   --open              open the rendered PDF in the default viewer when done
 *   --json-output       print the result as JSON instead of a plain line
 *   -h, --help          show this help
 */
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { homedir, platform } from "node:os";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
register(
  "./_tsx-loader.mjs",
  pathToFileURL(join(__dirname, "/")).href,
);

const HELP = `render — render a tailored résumé JSON to a PDF

Usage:
  node scripts/render.mjs --json <path> [flags]

Flags:
  --json <path>       path to a tailored résumé JSON (schemas/resume.ts shape)
  --template <name>   modern | classic | technical | polished | timeline | editorial | spotlight (default: modern)
  --out <dir>         output directory (default: ~/resume-out)
  --open              open the rendered PDF in the default viewer when done
  --json-output       print the result as JSON instead of a plain line
  -h, --help          show this help`;

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") flags.help = true;
    else if (a === "--json") flags.json = argv[++i];
    else if (a === "--template") flags.template = argv[++i];
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
    return;
  }
  if (!flags.json) {
    console.error("Error: --json <path> is required.\n");
    console.error(HELP);
    process.exit(2);
  }

  const { ResumeJSON } = await import("../schemas/resume.ts");
  const { renderTemplateFromResume, normalizeTemplate } = await import("../lib/render.ts");

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

  let template;
  try {
    template = normalizeTemplate(flags.template);
  } catch (err) {
    console.error(`✖ ${err.message ?? err}`);
    process.exit(1);
  }

  const outDir = flags.out ? resolve(flags.out) : join(homedir(), "resume-out");
  const pdfPath = await renderTemplateFromResume(parsed.data, template, outDir);

  if (flags.open) openFile(pdfPath);

  if (flags.jsonOutput) {
    console.log(JSON.stringify({ pdfPath, template }, null, 2));
  } else {
    console.log(`✓ Rendered ${template} style → ${relative(process.cwd(), pdfPath) || pdfPath}`);
  }
}

main().catch((err) => {
  console.error(`\n✖ ${err.message ?? err}`);
  process.exit(1);
});
