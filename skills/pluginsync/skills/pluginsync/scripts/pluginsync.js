#!/usr/bin/env node
/**
 * pluginsync — the deterministic half of the skill.
 *
 * Everything mechanical lives here so the agent never reshapes output with
 * sed/grep/jq in the transcript: one command returns everything a step needs,
 * already as a table. The agent's job is the conversation; this binary's job
 * is facts.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  claudePluginList,
  findShadows,
  readCatalog,
  readInstalled,
  readJson,
  readMarketplaces,
} from './lib/state.mjs';
import { changeable, classify, errored, renderApply, renderCheck, table } from './lib/report.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const DEFAULT_MARKETPLACE = 'claude-skills';

export { table };

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

const claudeHome = (args) => resolve(args.home ?? join(homedir(), '.claude'));

/**
 * The installed list comes from `claude plugin list --json`, or from a file
 * when one is named. The override is what lets the baseline eval re-run this
 * command offline for $0 — a CI gate that shells out to a live CLI is a gate
 * that flakes.
 */
function installedFrom(args) {
  if (args.installedJson) {
    const raw = readJson(resolve(args.installedJson));
    if (!raw) throw new Error(`cannot read --installed-json ${args.installedJson}`);
    return readInstalled(raw);
  }
  return readInstalled(claudePluginList());
}

function pickMarketplace(home, name) {
  const all = readMarketplaces(home);
  if (all.length === 0) throw new Error(`no marketplaces configured under ${home}/plugins`);
  const hit = all.find((m) => m.name === name);
  if (!hit) throw new Error(`marketplace "${name}" is not configured — have: ${all.map((m) => m.name).join(', ')}`);
  return hit;
}

/** Refresh the marketplace from its source. Skipped by --no-fetch. */
function fetchMarketplace(name, args) {
  if (args.noFetch) return;
  execFileSync('claude', ['plugin', 'marketplace', 'update', name], { encoding: 'utf8', stdio: 'pipe' });
}

function gather(args) {
  const home = claudeHome(args);
  const marketplace = pickMarketplace(home, args.marketplace ?? DEFAULT_MARKETPLACE);
  const catalog = readCatalog(marketplace);
  if (!catalog.ok) throw new Error(catalog.error);
  const installed = installedFrom(args);
  const rows = classify({ marketplace, catalog, installed });
  const shadows = findShadows(home, rows.map((r) => r.plugin));
  return { home, marketplace, catalog, installed, rows, shadows };
}

async function cmdCheck(args) {
  const name = args.marketplace ?? DEFAULT_MARKETPLACE;
  fetchMarketplace(name, args);
  const { marketplace, rows, shadows } = gather(args);

  const text = renderCheck({ marketplace, rows, shadows });
  const payload = { marketplace, rows, shadows, toChange: changeable(rows).length };

  // --out is what makes a run freezable: the baseline eval re-runs this exact
  // command into a temp dir and byte-compares these two files.
  if (args.out) {
    const dir = resolve(args.out);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'report.md'), `${text}\n`);
    writeFileSync(join(dir, 'report.json'), `${JSON.stringify(payload, null, 2)}\n`);
  }

  console.log(args.json ? JSON.stringify(payload, null, 2) : text);
  if (errored(rows).length) process.exitCode = 1;
}

/**
 * Install or update every drifted plugin, then read the resulting version back
 * off disk and compare. A command that exits 0 without moving the version is
 * reported as `stalled`, never as success — that conflation is the whole reason
 * this skill exists rather than a shell alias.
 */
async function cmdApply(args) {
  // --home redirects only the READS. Every write goes through the real
  // `claude` CLI against the real install, so an apply driven by a fixture home
  // would issue genuine install commands for plugins that exist only in the
  // fixture. Reading from one machine and writing to another is not a mode
  // worth supporting; it is just a way to damage someone's setup during a test.
  if (args.home) {
    throw new Error('apply refuses --home: reads would come from the fixture but every write goes to the real install. Use check --home for offline inspection.');
  }
  const name = args.marketplace ?? DEFAULT_MARKETPLACE;
  fetchMarketplace(name, args);
  const before = gather(args);
  const todo = changeable(before.rows);

  const results = [];
  for (const row of todo) {
    const verb = row.action === 'install' ? 'install' : 'update';
    let failure = null;
    try {
      execFileSync('claude', ['plugin', verb, `${row.plugin}@${before.marketplace.name}`], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err) {
      failure = (err.stderr || err.message || 'command failed').toString().trim().split('\n').pop();
    }
    results.push({ row, verb, failure });
  }

  // Re-read from disk. Trusting the exit code here is the bug this guards.
  const after = installedFrom({ ...args, installedJson: args.verifyJson ?? args.installedJson });
  const rows = results.map(({ row, verb, failure }) => {
    const now = after.get(`${row.plugin}@${before.marketplace.name}`)?.version ?? null;
    let outcome;
    let note = null;
    if (failure) {
      outcome = 'failed';
      note = failure;
    } else if (now === row.available) {
      outcome = verb === 'install' ? 'installed' : 'updated';
    } else {
      outcome = 'stalled';
      note = `${verb} exited 0 but the version on disk is still ${now ?? 'absent'}`;
    }
    return { plugin: row.plugin, was: row.installed, now, outcome, note };
  });

  const selfUpdated = rows.some((r) => r.plugin === 'pluginsync' && (r.outcome === 'updated' || r.outcome === 'installed'));
  if (args.json) {
    console.log(JSON.stringify({ marketplace: before.marketplace, rows, shadows: before.shadows, selfUpdated }, null, 2));
  } else {
    console.log(renderApply({ marketplace: before.marketplace, rows, shadows: before.shadows, selfUpdated }));
  }
  if (rows.some((r) => r.outcome === 'failed' || r.outcome === 'stalled')) process.exitCode = 1;
}

const USAGE = `pluginsync v${VERSION} — Reconcile the plugins installed on this machine with what the marketplace actually offers, and never call a plugin live before the restart that makes it so.

  pluginsync check [--marketplace <name>] [--no-fetch] [--json]
  pluginsync apply [--marketplace <name>] [--no-fetch] [--json]

  --marketplace <name>   default: ${DEFAULT_MARKETPLACE}
  --no-fetch             skip 'claude plugin marketplace update' — read disk only
  --home <path>          override ~/.claude (tests and evals)
  --installed-json <f>   read the installed list from a file instead of the CLI
  --out <dir>            also write report.md and report.json there (check only)
`;

async function main() {
  const args = argv(process.argv.slice(2));
  const cmd = args._[0];
  if (args.version) return console.log(VERSION);
  try {
    switch (cmd) {
      case 'check': return await cmdCheck(args);
      case 'apply': return await cmdApply(args);
      default:
        console.log(USAGE);
        process.exitCode = cmd ? 2 : 0;
    }
  } catch (err) {
    console.error(`pluginsync: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
