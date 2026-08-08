#!/usr/bin/env node
/**
 * The known-bad half of the baseline. THIS SCRIPT MUST EXIT NON-ZERO.
 *
 * It drifts a copy of the frozen snapshot and asks `check` whether anything
 * changed. Drift detected → exit 1, which is the passing outcome. The day
 * someone weakens the gate, this exits 0 and the generated baseline test fails.
 *
 * A golden alone cannot catch that: a build golden goes on matching perfectly
 * while `check` quietly stops checking, and every stale card then answers with
 * full confidence. Two-sidedness is the whole point.
 */
import { cpSync, rmSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildAll, checkAll } from '../scripts/lib/store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAP = join(HERE, 'fixtures', 'snapshot');

const work = mkdtempSync(join(tmpdir(), 'skillhelp-trap-'));
const repo = join(work, 'repo');
const index = join(work, 'index');
cpSync(SNAP, repo, { recursive: true });

// 1. Index the repo as it stands.
buildAll(repo, { skillDir: index, write: true });
const clean = checkAll(repo, { skillDir: index });
if (!clean.ok) {
  console.error(`trap FAILED to set up: a freshly built index reported ${clean.results.filter((r) => r.verdict !== 'ok').length} non-ok cards.`);
  console.error('The clean state must be reachable, or the gate could never be satisfied and this trap proves nothing.');
  rmSync(work, { recursive: true, force: true });
  process.exit(9);
}

// 2. Drift it in a way that genuinely changes an answer.
const target = join(repo, 'skills', 'press', 'skills', 'press', 'SKILL.md');
if (!existsSync(target)) { console.error('trap FAILED to set up: snapshot is missing press/SKILL.md'); process.exit(9); }
writeFileSync(target, `${readFileSync(target, 'utf8')}\n## Troubleshooting\n\n- A drifted line that no committed card contains, added by evals/trap.mjs.\n`);

// 3. And remove a skill's card entirely, so both drift shapes are covered.
rmSync(join(index, 'index', 'shipflow.md'), { force: true });

const after = checkAll(repo, { skillDir: index });
const bad = after.results.filter((r) => r.verdict !== 'ok');
rmSync(work, { recursive: true, force: true });

if (after.ok) {
  console.error('TRAP DID NOT FIRE — check reported a clean index over a drifted skill and a deleted card.');
  console.error('The drift gate is not gating. A stale card will now answer with full confidence.');
  process.exit(0); // exit 0 is the FAILURE here; the baseline test asserts non-zero
}

console.log(`trap fired as required — ${bad.length} cards reported not current:`);
for (const r of bad) console.log(`  ${r.name} — ${r.verdict}`);
process.exit(1);
