#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { detectRepoState, classifyProtectionOwner, resolveOwnerRepo } from '../lib/detect.mjs';
import { computePlan } from '../lib/plan.mjs';
import {
  applyPlan,
  listPendingReleasePromotions,
  confirmPromotionMerged,
  clearReleasePendingLabel,
  dispatchReleaseWorkflow,
} from '../lib/apply.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_PATH = join(PACKAGE_ROOT, 'templates', 'dev-to-main-automerge.yml.tmpl');

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

function readConfig(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function defaultConfigPath(repoPath) {
  return join(repoPath, '.github', 'shipflow.json');
}

function printJson(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function fail(message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
}

// --- commands ---------------------------------------------------------------

function cmdDetect(args) {
  const { values } = parseArgs({
    args,
    options: {
      repo: { type: 'string' },
      main: { type: 'string', default: 'main' },
      dev: { type: 'string', default: 'dev' },
      'release-credential': { type: 'string' },
    },
  });
  if (!values.repo) return fail('detect: --repo is required');

  const repoState = detectRepoState(values.repo, {
    branches: { main: values.main, dev: values.dev },
    releaseCredentialName: values['release-credential'] ?? null,
  });
  const protectionOwner = classifyProtectionOwner(repoState);
  printJson({ ...repoState, protectionOwnerClassification: protectionOwner });
}

function cmdPlan(args) {
  const { values } = parseArgs({
    args,
    options: {
      repo: { type: 'string' },
      config: { type: 'string' },
    },
  });
  if (!values.repo) return fail('plan: --repo is required');

  const configPath = values.config ?? defaultConfigPath(values.repo);
  let config;
  try {
    config = readConfig(configPath);
  } catch (e) {
    return fail(`plan: could not read config at ${configPath}: ${e.message}`);
  }

  const repoState = detectRepoState(values.repo, {
    branches: config.branches,
    releaseCredentialName: config.release?.releaseCredential ?? null,
  });
  const templateSource = readFileSync(TEMPLATE_PATH, 'utf8');
  const plan = computePlan(repoState, config, templateSource);
  printJson({ plan, stateHash: repoState.stateHash });
}

function cmdApply(args) {
  const { values } = parseArgs({
    args,
    options: {
      repo: { type: 'string' },
      config: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'expect-state-hash': { type: 'string' },
      force: { type: 'string', multiple: true, default: [] },
    },
  });
  if (!values.repo) return fail('apply: --repo is required');

  const configPath = values.config ?? defaultConfigPath(values.repo);
  let config;
  try {
    config = readConfig(configPath);
  } catch (e) {
    return fail(`apply: could not read config at ${configPath}: ${e.message}`);
  }

  if (config.release?.mode === 'auto') {
    return fail(
      'apply: release.mode "auto" is accepted in config but not yet implemented in this version of shipflow — see CHANGELOG.md (Phase B, not yet shipped). Set release.mode to "manual-gate" or wait for a future release.'
    );
  }

  const ownerRepo = resolveOwnerRepo(values.repo);
  const repoState = detectRepoState(values.repo, {
    branches: config.branches,
    releaseCredentialName: config.release?.releaseCredential ?? null,
  });
  const templateSource = readFileSync(TEMPLATE_PATH, 'utf8');
  const plan = computePlan(repoState, config, templateSource);

  // The CLI-level TOCTOU gate: compare the freshly-detected state against
  // what the user confirmed at plan time (--expect-state-hash, captured
  // from an earlier `shipflow plan` call). applyPlan's own internal check
  // (currentStateHash vs plan.sourceStateHash) is always trivially satisfied
  // here since both are computed from the same fresh detect — this
  // CLI-level comparison against the user-confirmed hash is the meaningful
  // gate against drift between plan-confirmation and apply-start.
  if (!values['dry-run'] && values['expect-state-hash'] && values['expect-state-hash'] !== repoState.stateHash) {
    return printJson({
      applied: [],
      skipped: [],
      errors: [{ id: 'toctou', message: 'repo state changed since the plan was confirmed — re-run to get an updated plan' }],
      renderedTemplateHashes: {},
    });
  }

  const result = applyPlan(plan, {
    dryRun: values['dry-run'],
    currentStateHash: repoState.stateHash,
    force: values.force,
    ownerRepo,
    repoPath: values.repo,
    config,
  });
  printJson(result);
}

function cmdReleases(args) {
  const { values } = parseArgs({ args, options: { repo: { type: 'string' }, config: { type: 'string' } } });
  if (!values.repo) return fail('releases: --repo is required');
  const configPath = values.config ?? defaultConfigPath(values.repo);
  const config = readConfig(configPath);
  const ownerRepo = resolveOwnerRepo(values.repo);
  if (!ownerRepo) return fail('releases: could not resolve owner/repo from git remote');

  const result = listPendingReleasePromotions(ownerRepo, config.branches.main);
  if (!result.ok) return fail(`releases: ${result.error}`);

  const withMergeCheck = result.promotions.map((p) => ({
    ...p,
    ...confirmPromotionMerged(ownerRepo, p.number),
  }));
  printJson({ promotions: withMergeCheck });
}

function cmdReleaseDispatch(args) {
  const { values } = parseArgs({
    args,
    options: {
      repo: { type: 'string' },
      pr: { type: 'string' },
      'workflow-file': { type: 'string', multiple: true },
      ref: { type: 'string' },
    },
  });
  if (!values.repo || !values.pr || !values['workflow-file'] || !values.ref) {
    return fail('release-dispatch: --repo, --pr, --workflow-file (repeatable), and --ref are required');
  }
  const ownerRepo = resolveOwnerRepo(values.repo);
  if (!ownerRepo) return fail('release-dispatch: could not resolve owner/repo from git remote');

  const merged = confirmPromotionMerged(ownerRepo, values.pr);
  if (!merged.ok || !merged.merged) {
    return fail(`release-dispatch: PR #${values.pr} is not confirmed MERGED — refusing to dispatch`);
  }

  const results = values['workflow-file'].map((wf) => ({ workflowFile: wf, ...dispatchReleaseWorkflow(ownerRepo, wf, values.ref) }));
  const allOk = results.every((r) => r.ok);
  if (!allOk) {
    printJson({ dispatched: results, labelCleared: false, note: 'not all dispatches succeeded — label left in place, will resurface next run' });
    return;
  }
  const cleared = clearReleasePendingLabel(ownerRepo, values.pr);
  printJson({ dispatched: results, labelCleared: cleared.ok, labelClearError: cleared.ok ? null : cleared.error });
}

function printHelp() {
  console.log(`shipflow ${readPackageVersion()}

Usage: shipflow <command> [options]

Commands:
  detect --repo <path> [--main <name>] [--dev <name>] [--release-credential <name>]
  plan --repo <path> [--config <path>]
  apply --repo <path> [--config <path>] [--dry-run] [--expect-state-hash <hash>] [--force <id>]...
  releases --repo <path> [--config <path>]
  release-dispatch --repo <path> --pr <number> --workflow-file <file>... --ref <ref>

Every command prints JSON to stdout.`);
}

// ─── dispatch ────────────────────────────────────────────────────────────────
// Only run the CLI dispatch when this file is executed directly, not when it
// is imported (e.g. by the test suite). Both sides are realpath'd: under
// npm/npx, argv[1] is the node_modules/.bin/shipflow SYMLINK while
// import.meta.url is the resolved file — a naive === never matches and
// every npx invocation becomes a silent no-op (this exact bug bit devlog —
// see this repo's CHANGELOG/commit e69b6ba).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  const arg = process.argv[2];
  const rest = process.argv.slice(3);
  switch (arg) {
    case 'detect':
      cmdDetect(rest);
      break;
    case 'plan':
      cmdPlan(rest);
      break;
    case 'apply':
      cmdApply(rest);
      break;
    case 'releases':
      cmdReleases(rest);
      break;
    case 'release-dispatch':
      cmdReleaseDispatch(rest);
      break;
    case '-v':
    case '--version':
      console.log(readPackageVersion());
      break;
    case undefined:
    case '-h':
    case '--help':
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${arg}`);
      printHelp();
      process.exit(1);
  }
}
