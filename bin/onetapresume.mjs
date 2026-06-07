#!/usr/bin/env node
/**
 * onetapresume CLI — tailor a resume to a job and render a PDF.
 *
 * Self-registers the TS-on-the-fly loader so it runs with a plain
 * `node bin/onetapresume.mjs ...` (no --import flag needed).
 *
 * Smart invocation:
 *   - pass resume + job as positional args, or
 *   - omit either and it prompts interactively (when stdin is a TTY).
 *
 *   node bin/onetapresume.mjs <resume-path> <job-url-or-text> [flags]
 *
 * Flags:
 *   --template <name>   one of: modern classic technical polished timeline editorial spotlight (default: modern)
 *   --out <dir>         output directory (default: ./onetap-out)
 *   --model <name>      LLM model override (default: sonnet via the cli adapter)
 *   --pdf-only          write only the PDF (skip the ResumeJSON sidecar)
 *   --json              print the diff as JSON instead of prose
 *   -h, --help          show this help
 */
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

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
  --template <name>  modern | classic | technical | polished | timeline | editorial | spotlight  (default: modern)
  --out <dir>        output directory (default: ./onetap-out)
  --model <name>     LLM model override (default: sonnet)
  --pdf-only         write only the PDF (skip the ResumeJSON sidecar)
  --json             print the change summary as JSON
  -h, --help         show this help

Missing arguments are prompted for interactively.`;

const { parseArgs } = await import("../lib/cli-args.ts");

async function prompt(rl, question) {
  const answer = (await rl.question(question)).trim();
  return answer;
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(HELP);
    return;
  }

  let [resumePath, jobInput] = positional;

  // Interactive fallback for any missing required input.
  const interactive = stdin.isTTY && stdout.isTTY;
  if (!resumePath || !jobInput) {
    if (!interactive) {
      console.error("Error: missing required arguments and no TTY for prompts.\n");
      console.error(HELP);
      process.exit(2);
    }
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      if (!resumePath) resumePath = await prompt(rl, "Resume path (.pdf/.docx/.txt/.md): ");
      if (!jobInput) {
        console.log("Job posting — paste a URL, a file path, or the JD text:");
        jobInput = await prompt(rl, "> ");
      }
    } finally {
      rl.close();
    }
  }
  if (!resumePath || !jobInput) {
    console.error("Error: a resume path and a job posting are both required.");
    process.exit(2);
  }

  const { runPipeline } = await import("../lib/pipeline.ts");

  const usingMock = process.env.MOCK_LLM === "1";
  console.log(
    `\nTailoring ${relative(process.cwd(), resumePath) || resumePath} → ${flags.template ?? "modern"} template${usingMock ? " [MOCK_LLM]" : ""} …`,
  );

  const result = await runPipeline({
    resumePath,
    jobInput,
    template: flags.template,
    outDir: flags.out,
    pdfOnly: flags.pdfOnly,
    model: flags.model,
  });

  if (flags.json) {
    console.log(JSON.stringify({ pdfPath: result.pdfPath, jsonPath: result.jsonPath, diff: result.diff }, null, 2));
    return;
  }

  printResult(result);
}

function printResult(r) {
  const d = r.diff;
  const cwd = process.cwd();
  const rel = (p) => (p ? relative(cwd, p) || p : null);
  console.log(`\n✓ Tailored resume for ${r.resume.name}`);
  if (r.jobTitle) console.log(`  Job: ${r.jobTitle}`);
  console.log(
    `  Bullets: ${d.totalBullets} total · ${d.optimizedCount} optimized · ${d.droppedCount} dropped · ${d.keptCount} kept · ${d.roles} roles`,
  );
  console.log(`\n  PDF:  ${rel(r.pdfPath)}`);
  if (r.jsonPath) console.log(`  JSON: ${rel(r.jsonPath)}`);

  if (d.optimized.length) {
    console.log(`\n  Optimized bullets:`);
    for (const o of d.optimized) {
      console.log(`   • [${o.role}]`);
      console.log(`     - ${o.original}`);
      console.log(`     + ${o.rewritten}`);
    }
  }
  if (d.dropped.length) {
    console.log(`\n  Dropped (irrelevant) bullets:`);
    for (const b of d.dropped) console.log(`   - ${b}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(`\n✖ ${err.message ?? err}`);
  process.exit(1);
});
