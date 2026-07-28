// Baseline eval: the rendered-workflow golden, pinned to a real apply run.
//
// Offline, deterministic, $0 — runs in `ci / shipflow` with the normal suite.
//
// shipflow's whole job is turning a config into a correct GitHub Actions workflow.
// The unit tests in render.test.mjs prove token substitution works on toy inputs;
// they do not prove that a REAL config still produces the REAL file. That gap is
// what this file closes, using the strongest artifact available: this monorepo
// dogfoods shipflow on itself, so `.github/shipflow.json` and
// `.github/workflows/dev-to-main-automerge.yml` are a genuine input/output pair
// from a real `shipflow apply` run — and `renderedTemplateHashes` in that config
// is the receipt shipflow itself wrote at the time.
//
// Byte-exactness is correct HERE and nowhere else in the baseline suite: the
// rendered file IS the contract. A single changed character in a workflow is a
// behavior change to the repo's merge automation.
//
// Three checks, deliberately overlapping:
//   1. config -> params -> render reproduces the frozen golden, byte for byte.
//      Catches a regression anywhere in the chain, including the pattern module's
//      config->params mapping (which render.test.mjs never exercises).
//   2. sha256(golden) equals the hash the real apply run recorded. Catches a
//      golden fixture that was hand-edited to make check 1 pass.
//   3. The frozen golden still equals the repo's LIVE committed workflow. Catches
//      the fixture going stale — without this, checks 1 and 2 would keep agreeing
//      with each other long after they stopped describing reality.
//
// Check 3 reads outside the skill directory. That is safe: package.json's `files`
// excludes tests/ and evals/, so this never ships to npm — it only ever runs
// inside this monorepo, where those paths exist by construction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderTemplate } from '../lib/render.mjs';
import * as devMainPromotion from '../lib/patterns/dev-main-promotion/index.mjs';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_DIR = join(SKILL_ROOT, 'evals', 'baseline');
// skills/shipflow/skills/shipflow -> repo root is four levels up.
const REPO_ROOT = resolve(SKILL_ROOT, '..', '..', '..', '..');

const FROZEN_CONFIG = JSON.parse(
  readFileSync(join(BASELINE_DIR, 'dogfood-shipflow.json'), 'utf8')
);
const FROZEN_GOLDEN = readFileSync(
  join(BASELINE_DIR, 'dogfood-dev-to-main-automerge.yml'),
  'utf8'
);

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function renderFromConfig(config) {
  const entry = devMainPromotion.templates(config)[0];
  const source = readFileSync(entry.templateSourcePath, 'utf8');
  return { entry, rendered: renderTemplate(source, entry.params) };
}

test('baseline: the real dogfood config still renders the frozen golden byte-for-byte', () => {
  const { rendered } = renderFromConfig(FROZEN_CONFIG);
  if (rendered !== FROZEN_GOLDEN) {
    // Show the first divergent line — a bare "strings differ" on a 90-line YAML
    // file is the kind of failure that makes a baseline feel like a tax.
    const a = rendered.split('\n');
    const b = FROZEN_GOLDEN.split('\n');
    const i = a.findIndex((line, idx) => line !== b[idx]);
    assert.fail(
      `Rendered output diverges from the frozen golden at line ${i + 1}:\n` +
        `  rendered: ${JSON.stringify(a[i])}\n` +
        `  golden:   ${JSON.stringify(b[i])}\n\n` +
        `If the template change is INTENTIONAL, refresh the baseline with:\n` +
        `  node evals/baseline/update.mjs\n` +
        `and re-run shipflow apply on this repo so the live workflow and\n` +
        `renderedTemplateHashes are updated in the same change.`
    );
  }
});

test('baseline: the golden matches the hash the real apply run recorded', () => {
  const { entry } = renderFromConfig(FROZEN_CONFIG);
  const recorded = FROZEN_CONFIG.renderedTemplateHashes?.[entry.targetPath];
  assert.ok(
    recorded,
    `The frozen config has no renderedTemplateHashes entry for ${entry.targetPath}. ` +
      `Without it this baseline loses its independent receipt and checks 1 and 3 ` +
      `could drift together undetected.`
  );
  assert.equal(
    sha256(FROZEN_GOLDEN),
    recorded,
    `The frozen golden's hash does not match the hash shipflow recorded when it ` +
      `actually applied this config. Either the golden was hand-edited (do not do ` +
      `this — regenerate it) or the config's renderedTemplateHashes is stale.`
  );
});

test('baseline: the frozen golden still matches the live committed workflow', () => {
  const livePath = join(REPO_ROOT, '.github', 'workflows', 'dev-to-main-automerge.yml');
  assert.ok(
    existsSync(livePath),
    `Expected the dogfooded workflow at ${livePath}. This check is what keeps the ` +
      `frozen fixture honest; if the file genuinely moved, update this path rather ` +
      `than deleting the check.`
  );
  assert.equal(
    readFileSync(livePath, 'utf8'),
    FROZEN_GOLDEN,
    `The repo's live dev-to-main-automerge.yml no longer matches the frozen baseline.\n` +
      `Either someone hand-edited the workflow (CLAUDE.md forbids this — edit\n` +
      `.github/shipflow.json and re-run shipflow apply), or a legitimate re-render\n` +
      `landed without refreshing this fixture. Refresh with:\n` +
      `  node evals/baseline/update.mjs`
  );
});

// ---------------------------------------------------------------- two-sided half
// The checks above all assert "known-good input still produces known-good output".
// On their own they would keep passing if renderTemplate stopped validating and
// started substituting anything it was handed. These assert the guard rails that
// make the golden meaningful still fire.

test('baseline: a config with an injected quote is still rejected, not rendered', () => {
  const hostile = structuredClone(FROZEN_CONFIG);
  hostile.branches.dev = 'dev"\non-injected:';
  assert.throws(
    () => renderFromConfig(hostile),
    /unsafe value for token/,
    `A branch name containing a quote and newline rendered without error. That is ` +
      `YAML injection into a workflow file — the exact class of bug the 2026-07-15 ` +
      `Siege audit fixed. renderTemplate's validators must reject it.`
  );
});

test('baseline: a config missing a required field fails loudly rather than emitting a stub', () => {
  const incomplete = structuredClone(FROZEN_CONFIG);
  delete incomplete.branches.main;
  assert.throws(
    () => renderFromConfig(incomplete),
    /missing param|unsafe value/,
    `Rendering with no main branch configured must throw. Silently emitting a ` +
      `workflow with an empty or literal "{{MAIN_BRANCH}}" branch would produce a ` +
      `workflow that never fires, with no error at apply time.`
  );
});

test('baseline: the merge method actually reaches the rendered workflow', () => {
  // Guards the config->params mapping specifically: if mergeMethodToFlag were
  // bypassed or hardcoded, checks 1-3 would still pass for THIS config (which
  // uses "merge"), because the golden was generated with the same bug.
  const squashed = structuredClone(FROZEN_CONFIG);
  squashed.mergeMethod.devToMainMethod = 'squash';
  const { rendered } = renderFromConfig(squashed);
  assert.match(
    rendered,
    /--squash/,
    `Changing devToMainMethod to "squash" did not change the rendered merge flag. ` +
      `The config->params mapping in lib/patterns/dev-main-promotion/index.mjs is ` +
      `not being applied.`
  );
  assert.doesNotMatch(rendered, /--merge\b/, 'stale --merge flag still present');
});
