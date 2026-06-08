#!/usr/bin/env node
/**
 * onetapresume CLI — tailor a resume to a job and render a PDF.
 *
 * Self-registers the TS-on-the-fly loader so it runs with a plain
 * `node bin/onetapresume.mjs ...` (no --import flag needed).
 *
 * Smart invocation:
 *   - pass resume + job as positional args, or
 *   - omit the resume (or pass --pick) to choose it from a native file dialog,
 *   - omit either and it prompts interactively (when stdin is a TTY).
 *
 *   node bin/onetapresume.mjs <resume-path> <job-url-or-text> [flags]
 *
 * Flags:
 *   --pick              choose the resume from a native file picker (macOS)
 *   --template <name>   one of: modern classic technical polished timeline editorial spotlight (default: modern)
 *   --out <dir>         output directory (default: ./onetap-out)
 *   --model <name>      LLM model override (default: haiku via the cli adapter)
 *   --pdf-only          write only the PDF (skip the ResumeJSON sidecar)
 *   --json              print the diff as JSON instead of tables
 *   -h, --help          show this help
 */
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
register(
  "../scripts/_tsx-loader.mjs",
  pathToFileURL(join(__dirname, "/")).href,
);

const HELP = `onetapresume — tailor a resume to a job description and render a PDF

Usage:
  onetapresume <resume-path> <job-url-or-text> [flags]

Arguments:
  resume-path        path to your resume (.pdf .docx .txt .md)
  job-url-or-text    a job posting URL, a path to a .txt JD, or pasted JD text

Flags:
  --pick             choose the resume from a native file picker (macOS)
  --open             open the rendered PDF in the default viewer when done
  --render <json>    re-render an existing tailored JSON in a new --template
                     (skips tailoring — instant style switch)
  --template <name>  modern | classic | technical | polished | timeline | editorial | spotlight  (default: modern)
  --out <dir>        output directory (default: ./onetap-out)
  --model <name>     LLM model override (default: haiku on the CLI path)
  --pdf-only         write only the PDF (skip the ResumeJSON sidecar)
  --json             print the change summary as JSON
  -h, --help         show this help

Missing arguments are prompted for interactively (resume opens a file picker).`;

const { parseArgs } = await import("../lib/cli-args.ts");

async function prompt(rl, question) {
  const answer = (await rl.question(question)).trim();
  return answer;
}

async function resolveResumePath(flags, resumePath, interactive) {
  if (resumePath && !flags.pick) return resumePath;

  const { pickResumeFile, nativePickerAvailable } = await import(
    "../lib/ui/file-picker.ts"
  );

  if ((flags.pick || !resumePath) && nativePickerAvailable()) {
    stderr.write("◌ Opening file picker — select your résumé…\n");
    const picked = await pickResumeFile();
    if (picked) return picked;
    if (resumePath) return resumePath; // picker cancelled, keep any arg
    stderr.write("  (no file selected)\n");
  }

  if (!resumePath && interactive) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      return await prompt(rl, "Resume path (.pdf/.docx/.txt/.md): ");
    } finally {
      rl.close();
    }
  }
  return resumePath;
}

async function main() {
  const startedAt = Date.now();
  const { flags, positional } = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(HELP);
    return;
  }

  // Fast path: re-render an already-tailored JSON in a different template.
  // No parsing, job extraction, or LLM call — used by the interactive style
  // picker to switch looks instantly.
  if (flags.render) {
    await renderOnly(flags);
    return;
  }

  // With --pick the résumé comes from the file dialog, so the lone positional
  // is the job posting. Without it, positionals are [resume, job].
  let resumePath;
  let jobInput;
  if (flags.pick) {
    [jobInput] = positional;
  } else {
    [resumePath, jobInput] = positional;
  }
  const interactive = stdin.isTTY && stdout.isTTY;

  resumePath = await resolveResumePath(flags, resumePath, interactive);

  // Interactive fallback for a missing job posting.
  if (!jobInput) {
    if (!interactive) {
      console.error("Error: missing job posting and no TTY for prompts.\n");
      console.error(HELP);
      process.exit(2);
    }
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      console.log("Job posting — paste a URL, a file path, or the JD text:");
      jobInput = await prompt(rl, "> ");
    } finally {
      rl.close();
    }
  }

  if (!resumePath || !jobInput) {
    console.error("Error: a resume path and a job posting are both required.");
    process.exit(2);
  }

  const { runPipeline } = await import("../lib/pipeline.ts");
  const { Progress } = await import("../lib/ui/progress.ts");

  const usingMock = process.env.MOCK_LLM === "1";
  const pretty = !flags.json;

  if (pretty) {
    stderr.write(
      `\n  onetapresume · ${relative(process.cwd(), resumePath) || resumePath} → ${flags.template ?? "modern"} template${usingMock ? " [MOCK_LLM]" : ""}\n\n`,
    );
  }

  const progress = pretty ? new Progress() : undefined;

  // Quiet the library's structured/debug logs during the run so the only
  // output is the clean progress (stderr) and the final result (stdout).
  const origLog = console.log;
  const origWarn = console.warn;
  if (pretty) {
    console.log = () => {};
    console.warn = () => {};
  }

  let result;
  try {
    result = await runPipeline({
      resumePath,
      jobInput,
      template: flags.template,
      outDir: flags.out,
      pdfOnly: flags.pdfOnly,
      model: flags.model,
      reporter: progress,
    });
  } catch (err) {
    progress?.stop();
    throw err;
  } finally {
    if (pretty) {
      console.log = origLog;
      console.warn = origWarn;
    }
  }

  if (flags.open) {
    const { openFile } = await import("../lib/ui/file-picker.ts");
    openFile(result.pdfPath);
  }

  if (flags.json) {
    console.log(
      JSON.stringify(
        { pdfPath: result.pdfPath, jsonPath: result.jsonPath, diff: result.diff },
        null,
        2,
      ),
    );
    return;
  }

  await printResult(result, (Date.now() - startedAt) / 1000);
}

/**
 * --render mode: load a tailored ResumeJSON sidecar and re-render it in a new
 * template, optionally opening it. Fast (no LLM). Powers the style picker.
 */
async function renderOnly(flags) {
  const { renderTemplateFromResume, normalizeTemplate } = await import("../lib/pipeline.ts");
  const { ResumeJSON } = await import("../schemas/resume.ts");
  const { openFile } = await import("../lib/ui/file-picker.ts");

  const jsonPath = resolve(flags.render);
  let raw;
  try {
    raw = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (err) {
    throw new Error(`could not read résumé JSON at ${jsonPath}: ${err.message ?? err}`);
  }
  const parsed = ResumeJSON.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`invalid résumé JSON at ${jsonPath} (not a tailored sidecar)`);
  }

  const template = normalizeTemplate(flags.template);
  const outDir = resolve(flags.out ?? "onetap-out");
  const pdfPath = await renderTemplateFromResume(parsed.data, template, outDir);
  if (flags.open) openFile(pdfPath);

  if (flags.json) {
    console.log(JSON.stringify({ pdfPath, template }, null, 2));
  } else {
    process.stdout.write(`\n✓ Rendered ${template} style → ${relative(process.cwd(), pdfPath) || pdfPath}\n\n`);
  }
}

async function printResult(r, elapsedSec) {
  const { renderTable } = await import("../lib/ui/table.ts");
  const d = r.diff;
  const cwd = process.cwd();
  const rel = (p) => (p ? relative(cwd, p) || p : null);
  const width = Math.min(process.stdout.columns || 100, 100);
  const w = (s) => process.stdout.write(s);

  w(`\n✓ Tailored résumé for ${r.resume.name}`);
  if (r.jobTitle) w(`  ·  ${r.jobTitle}`);
  w(`  ·  ${elapsedSec.toFixed(1)}s\n\n`);

  // Summary counts.
  w(
    renderTable(
      ["Metric", "Count"],
      [
        ["Bullets optimized", String(d.optimizedCount)],
        ["Bullets dropped", String(d.droppedCount)],
        ["Bullets kept verbatim", String(d.keptCount)],
        ["Total bullets", String(d.totalBullets)],
        ["Roles preserved", String(d.roles)],
      ],
      { align: ["left", "right"], maxWidth: width, indent: 2 },
    ),
  );
  w("\n\n");

  // Output files.
  const fileRows = [["PDF", rel(r.pdfPath)]];
  if (r.jsonPath) fileRows.push(["JSON", rel(r.jsonPath)]);
  w(renderTable(["Output", "Path"], fileRows, { maxWidth: width, indent: 2 }));
  w("\n");

  // Optimized bullets (before → after).
  if (d.optimized.length) {
    w(`\n  Optimized bullets (${d.optimized.length}):\n`);
    w(
      renderTable(
        ["Role", "Before", "After"],
        d.optimized.map((o) => [o.role, o.original, o.rewritten]),
        { maxWidth: width, indent: 2 },
      ),
    );
    w("\n");
  }

  // Dropped bullets.
  if (d.dropped.length) {
    w(`\n  Dropped (irrelevant) bullets (${d.dropped.length}):\n`);
    w(
      renderTable(
        ["#", "Bullet"],
        d.dropped.map((b, i) => [String(i + 1), b]),
        { align: ["right", "left"], maxWidth: width, indent: 2 },
      ),
    );
    w("\n");
  }
  w("\n");
}

main().catch((err) => {
  console.error(`\n✖ ${err.message ?? err}`);
  process.exit(1);
});
