#!/usr/bin/env node
/**
 * validate.mjs — deterministic checks on a tailored résumé JSON before it's
 * rendered: (1) a zod structural gate against schemas/resume.ts, then
 * (2) content rules from lib/validate.ts (banned phrases, scope qualifiers
 * not in source, derived durations, invented numbers).
 *
 * The structural gate runs first and separately from the content checks —
 * lib/validate.ts's validateTailoring() assumes an already-schema-valid
 * object and only checks content. Skipping the structural gate here would
 * let a malformed JSON (missing field, stray property) sail through and
 * fail later with an unhelpful error deep inside render.mjs's PDF renderer.
 *
 * Self-registers the TS-on-the-fly loader (same pattern as render.mjs) so
 * it runs as a plain `node scripts/validate.mjs ...`.
 *
 * Usage:
 *   node scripts/validate.mjs --json <path> --resume <path-or-text>
 *
 * Exit 0 and prints "✓ clean" if both the structural gate and content
 * checks pass. Exit 1 with a list of issues otherwise — the agent should
 * fix its tailored JSON and re-run until clean.
 */
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
register(
  "./_tsx-loader.mjs",
  pathToFileURL(join(__dirname, "/")).href,
);

const HELP = `validate — check a tailored résumé JSON for schema and content violations

Usage:
  node scripts/validate.mjs --json <path> --resume <path-or-text>

Flags:
  --json <path>          path to the tailored résumé JSON to check
  --resume <path|text>    path to the original résumé text, or the literal text itself
  -h, --help              show this help`;

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") flags.help = true;
    else if (a === "--json") flags.json = argv[++i];
    else if (a === "--resume") flags.resume = argv[++i];
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(HELP);
    return;
  }
  if (!flags.json || !flags.resume) {
    console.error("Error: --json <path> and --resume <path-or-text> are both required.\n");
    console.error(HELP);
    process.exit(2);
  }

  const { ResumeJSON } = await import("../schemas/resume.ts");
  const { validateTailoring } = await import("../lib/validate.ts");

  const jsonPath = resolve(flags.json);
  let raw;
  try {
    raw = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (err) {
    console.error(`✖ could not read résumé JSON at ${jsonPath}: ${err.message ?? err}`);
    process.exit(1);
  }

  // Step 1: structural gate.
  const parsed = ResumeJSON.safeParse(raw);
  if (!parsed.success) {
    console.error(`✖ schema violations in ${jsonPath}:`);
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  // Step 2: content rules, checked against the original résumé source text.
  const resumeArg = flags.resume;
  const sourceText = existsSync(resumeArg) ? readFileSync(resumeArg, "utf8") : resumeArg;

  const result = validateTailoring(parsed.data, sourceText);
  if (!result.ok) {
    console.error(`✖ content violations:`);
    for (const v of result.violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }

  console.log("✓ clean — no schema or content violations");
}

main().catch((err) => {
  console.error(`\n✖ ${err.message ?? err}`);
  process.exit(1);
});
