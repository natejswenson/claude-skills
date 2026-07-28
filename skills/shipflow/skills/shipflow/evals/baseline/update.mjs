#!/usr/bin/env node
// Refresh the shipflow rendered-workflow baseline from this monorepo's live
// dogfood state. Run this ONLY when a template or config change is intentional:
//
//   node evals/baseline/update.mjs
//
// It re-copies the repo's `.github/shipflow.json` and the workflow that shipflow
// rendered from it. It deliberately does NOT re-render the golden itself from the
// template — copying the LIVE file is what keeps the fixture tied to reality. If
// you changed the template, run `shipflow apply` on the repo FIRST so the live
// workflow and renderedTemplateHashes are current, then run this.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(HERE, '..', '..');
const REPO_ROOT = resolve(SKILL_ROOT, '..', '..', '..', '..');

const PAIRS = [
  [join(REPO_ROOT, '.github', 'shipflow.json'), join(HERE, 'dogfood-shipflow.json')],
  [
    join(REPO_ROOT, '.github', 'workflows', 'dev-to-main-automerge.yml'),
    join(HERE, 'dogfood-dev-to-main-automerge.yml'),
  ],
];

mkdirSync(HERE, { recursive: true });
for (const [src, dest] of PAIRS) {
  if (!existsSync(src)) {
    console.error(`missing source: ${src}`);
    process.exit(1);
  }
  copyFileSync(src, dest);
  console.log(`updated ${dest.replace(SKILL_ROOT + '/', '')}`);
}
console.log('\nBaseline refreshed. Re-run `npm test` to confirm it is consistent.');
