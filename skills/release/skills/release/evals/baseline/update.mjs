#!/usr/bin/env node
// Refresh the baseline fixtures from REAL runs against this repo.
//
// Run this only when the frozen inputs are genuinely stale — a new component,
// or a deliberate change to what release-status returns. Refreshing it to make
// a failing assertion go away defeats the entire point of the baseline.
//
//   node evals/baseline/update.mjs
//
// What is frozen and why:
//
//   status-<component>.json   Real `shipflow release-status` output, with the
//                             two live fields (statusHash, notes) stripped —
//                             those move whenever the working tree does, and a
//                             fixture that changes on every unrelated edit is a
//                             fixture nobody trusts.
//   changelog-draft-*.md      The byte-exact draft rendered from a frozen
//                             status. Byte-exactness is right HERE because the
//                             rendered draft IS the output the author edits;
//                             one dropped bullet is a lost change.
//
// Deliberately NOT frozen: anything that tracks live repo state (which
// components exist, what is tagged today). Those are asserted with floors
// against the live repo in baseline.test.mjs, because pinning them would
// require refreshing this file after every release.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { groupCommits, renderDraft } from '../../scripts/release.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(HERE, '..', '..');
// skills/release/skills/release -> the repo root is four levels up.
const REPO_ROOT = resolve(SKILL_ROOT, '..', '..', '..', '..');
const SHIPFLOW = join(REPO_ROOT, 'skills', 'shipflow', 'skills', 'shipflow', 'bin', 'shipflow.js');

// One with many commits across several types, one with a single commit, and
// one with none — the three shapes the draft and the state machine behave
// differently on.
const COMPONENTS = ['ghostwriter', 'press', 'eval'];

mkdirSync(HERE, { recursive: true });

for (const name of COMPONENTS) {
  const raw = execFileSync(process.execPath, [SHIPFLOW, 'release-status', '--repo', REPO_ROOT, '--component', name], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const status = JSON.parse(raw);
  delete status.statusHash; // moves with the working tree
  delete status.notes; // reports unrelated dirt, which is never the same twice
  writeFileSync(join(HERE, `status-${name}.json`), `${JSON.stringify(status, null, 2)}\n`);

  if (status.commits.length > 0) {
    writeFileSync(join(HERE, `changelog-draft-${name}.md`), `${renderDraft(groupCommits(status.commits))}\n`);
  }
  console.log(`froze ${name}: ${status.state}, ${status.commits.length} commits`);
}
