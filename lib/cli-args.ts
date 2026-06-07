/**
 * Pure argument parser for the onetapresume CLI. Kept separate from
 * bin/onetapresume.mjs so it can be unit-tested without spawning a process.
 */
export interface ParsedFlags {
  pdfOnly: boolean;
  json: boolean;
  help: boolean;
  template?: string;
  out?: string;
  model?: string;
}

export interface ParsedArgs {
  flags: ParsedFlags;
  positional: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: ParsedFlags = { pdfOnly: false, json: false, help: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") flags.help = true;
    else if (a === "--pdf-only") flags.pdfOnly = true;
    else if (a === "--json") flags.json = true;
    else if (a === "--template") flags.template = argv[++i];
    else if (a === "--out") flags.out = argv[++i];
    else if (a === "--model") flags.model = argv[++i];
    else if (a.startsWith("--template=")) flags.template = a.slice("--template=".length);
    else if (a.startsWith("--out=")) flags.out = a.slice("--out=".length);
    else if (a.startsWith("--model=")) flags.model = a.slice("--model=".length);
    else if (a.startsWith("-")) throw new Error(`unknown flag: ${a}`);
    else positional.push(a);
  }
  return { flags, positional };
}
