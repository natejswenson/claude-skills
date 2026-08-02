#!/usr/bin/env node
/**
 * repocount — the deterministic half of the skill.
 *
 * Everything mechanical lives here so the agent never reshapes output with
 * sed/grep/jq in the transcript: one command returns everything a step needs,
 * already as a table. The agent's job is the conversation; this binary's job
 * is facts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

function argv(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inline !== undefined) out[key] = inline;
      else if (args[i + 1] && !args[i + 1].startsWith('--')) { out[key] = args[i + 1]; i += 1; }
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

export const table = (headers, rows) => {
  if (rows.length === 0) return '';
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => `| ${cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' | ')} |`;
  return [line(headers), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...rows.map(line)].join('\n');
};

async function cmdDetect(args) {
  const repo = resolve(args.repo ?? '.');
  // the repo's remote, default branch and release convention, as one table
  throw new Error('detect: not implemented yet — skillfactory scaffolded this command, the author step fills it');
}

async function cmdCount(args) {
  const repo = resolve(args.repo ?? '.');
  // open PRs, stale branches and unreleased commits, each with its age
  throw new Error('count: not implemented yet — skillfactory scaffolded this command, the author step fills it');
}

const USAGE = `repocount v${VERSION} — Count what a repository owes you — open PRs, stale branches, unreleased commits — as one table.

  repocount detect [--repo <path>]
  repocount count [--repo <path>]
`;

async function main() {
  const args = argv(process.argv.slice(2));
  const cmd = args._[0];
  if (args.version) return console.log(VERSION);
  try {
    switch (cmd) {
      case 'detect': return await cmdDetect(args);
      case 'count': return await cmdCount(args);
      default:
        console.log(USAGE);
        process.exitCode = cmd ? 2 : 0;
    }
  } catch (err) {
    console.error(`repocount: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
