/**
 * Propagation — how a token change reaches every product.
 *
 * There are two different questions, and conflating them is what leaves a
 * consumer silently stale:
 *
 *   INTEGRITY  "does this region match the press version this repo adopted?"
 *              Answered by `check`, run inside each consumer against a PINNED
 *              version. Pinned because a mutable reference in a repo that
 *              auto-deploys to production is a supply-chain hole, and because a
 *              reproducible check is the only kind worth gating a merge on.
 *
 *   FRESHNESS  "has this repo adopted the CURRENT brand?"
 *              Answered here, by running the newest press against a consumer's
 *              checkout. A pinned check can never answer this — it passes
 *              forever against the version it was pinned to, which is exactly
 *              how natejswenson.io sat two releases behind with green CI.
 *
 * So freshness is pushed from the source of truth rather than polled by each
 * consumer: press re-emits into the checkout, bumps the pin it finds, and the
 * caller turns that into a pull request. Consumers still review and merge, so
 * nothing lands unreviewed — but nobody has to *remember*.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { emitBody } from './emit.mjs';
import { findRegion, spliceRegion } from './region.mjs';
import { selectTargets, targetPath } from './targets.mjs';

/** The npm reference consumers pin in CI, e.g. `@natjswenson/press@0.3.0`. */
const PIN_RE = /(@natjswenson\/press@)(\d+\.\d+\.\d+)/g;

/**
 * Re-emit every resolvable region in `root` and bump any pinned press version
 * found in its workflows.
 *
 * Returns a summary rather than printing, so the same call serves the human
 * table, the `--json` output a CI job branches on, and the tests.
 */
export function propagate({ tokens, targets, root, version, dryRun = false }) {
  const selected = selectTargets(targets, { root, ids: [] });
  const regions = [];

  for (const target of selected) {
    const path = targetPath(target, root);
    const before = readFileSync(path, 'utf8');
    const found = findRegion(before, target.region, target.syntax);
    if (!found) {
      regions.push({ id: target.id, path: target.path, status: 'missing' });
      continue;
    }
    const body = emitBody(tokens, target.emitter, target.params ?? {});
    const after = spliceRegion(before, target.region, target.syntax, body, version);
    // Two different kinds of "changed", kept apart on purpose.
    //
    //   brand    the generated VALUES moved — something renders differently and
    //            the diff must be reviewed as a design change.
    //   version  only the marker's recorded version moved. Nothing renders
    //            differently; the repo is adopting a newer press.
    //
    // Both are written. Skipping the write when only the version moved is what
    // produced three divergent version numbers per repo — pin, region receipt
    // and current release all disagreeing, with no way to tell a healthy
    // consumer from a stale one at a glance.
    const brandChanged = found.body.replace(/\s+$/, '') !== body.replace(/\s+$/, '');
    const versionChanged = found.version !== version;
    const changed = brandChanged || versionChanged;
    if (changed && !dryRun) writeFileSync(path, after, 'utf8');
    regions.push({
      id: target.id,
      path: target.path,
      // Carried as booleans, never re-derived from the status string: matching
      // /updated$/ once silently missed "would update", so a dry run reported
      // "nothing to do" while showing a changed region.
      changed,
      brandChanged,
      versionChanged,
      status: brandChanged
        ? (dryRun ? 'would change brand' : 'brand updated')
        : versionChanged
          ? (dryRun ? 'would adopt' : 'adopted')
          : 'current',
      wroteBy: found.version,
    });
  }

  const pins = bumpPins(root, version, dryRun);

  return {
    root,
    version,
    regions,
    pins,
    // A repo needs a pull request if anything moved at all — values or version
    // — so that its pin, its region receipt and the current release stay one
    // readable number. Letting the receipt lag "because the body did not
    // change" produced three divergent versions per repo and no way to tell a
    // healthy consumer from a stale one at a glance.
    changed: regions.some((r) => r.changed) || pins.some((p) => p.status !== 'current'),
    // The subset a human must actually look at: these change what renders.
    // Everything else is routine adoption and reviews in seconds.
    brand: regions.filter((r) => r.brandChanged).map((r) => r.id),
    stale: regions.filter((r) => r.changed).map((r) => r.id),
    missing: regions.filter((r) => r.status === 'missing').map((r) => r.id),
  };
}

/**
 * Rewrite `@natjswenson/press@X` to the running version across a repo's
 * workflow files. The pin and the region must move together: adopting new
 * bytes while still pinning the old version makes that repo's own `check` fail,
 * which would be a confusing way to learn about a brand update.
 */
function bumpPins(root, version, dryRun) {
  const dir = join(root, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const path = join(dir, name);
    const text = readFileSync(path, 'utf8');
    const found = [...text.matchAll(PIN_RE)].map((m) => m[2]);
    if (found.length === 0) continue;
    const behind = found.filter((v) => v !== version);
    if (behind.length === 0) {
      out.push({ file: `.github/workflows/${name}`, from: found[0], to: version, status: 'current' });
      continue;
    }
    if (!dryRun) writeFileSync(path, text.replace(PIN_RE, `$1${version}`), 'utf8');
    out.push({
      file: `.github/workflows/${name}`,
      from: [...new Set(behind)].join(', '),
      to: version,
      status: dryRun ? 'would bump' : 'bumped',
    });
  }
  return out;
}
