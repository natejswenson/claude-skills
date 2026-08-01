/**
 * The drift gate.
 *
 * `check` re-derives what each region should contain and compares it to what is
 * on disk. Three things must fail, not just the obvious one:
 *
 *   drift    — the region exists but its bytes differ (someone hand-edited it,
 *              or the tokens moved and nobody re-emitted);
 *   missing  — the file exists but has no region at all. A consumer that
 *              silently dropped its marker would otherwise report "all clean"
 *              while checking nothing;
 *   absent   — a declared file isn't there.
 *
 * And a run that resolved *zero* targets is itself a failure. A glob that
 * quietly matches nothing must go red — that is how a gate turns decorative.
 */
import { readFileSync } from 'node:fs';
import { emitBody } from './emit.mjs';
import { findRegion, RegionError } from './region.mjs';
import { selectTargets, targetPath } from './targets.mjs';

export function checkTarget(target, root, tokens, version) {
  const path = targetPath(target, root);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { target, path, status: 'absent' };
  }

  let found;
  try {
    found = findRegion(text, target.region, target.syntax);
  } catch (err) {
    if (err instanceof RegionError) return { target, path, status: 'corrupt', detail: err.message };
    throw err;
  }
  if (!found) return { target, path, status: 'missing' };

  const expected = emitBody(tokens, target.emitter, target.params ?? {}).replace(/\s+$/, '');
  const actual = found.body.replace(/\s+$/, '');
  if (expected === actual) {
    return { target, path, status: 'ok', writtenBy: found.version };
  }
  return { target, path, status: 'drift', diff: lineDiff(expected, actual), writtenBy: found.version };
}

export function checkAll({ tokens, targets, root, ids, version }) {
  const selected = selectTargets(targets, { root, ids });
  const results = selected.map((t) => checkTarget(t, root, tokens, version));
  const failures = results.filter((r) => r.status !== 'ok');
  return {
    results,
    failures,
    empty: selected.length === 0,
    ok: selected.length > 0 && failures.length === 0,
  };
}

/**
 * A compact diff: common prefix and suffix are elided, so a one-line token
 * change reads as one line instead of the whole region.
 */
export function lineDiff(expected, actual) {
  const a = expected.split('\n');
  const b = actual.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1;
  }
  const out = [];
  if (head > 0) out.push(`  … ${head} identical line${head === 1 ? '' : 's'}`);
  for (const line of b.slice(head, b.length - tail)) out.push(`- ${line}`);
  for (const line of a.slice(head, a.length - tail)) out.push(`+ ${line}`);
  if (tail > 0) out.push(`  … ${tail} identical line${tail === 1 ? '' : 's'}`);
  return out.join('\n');
}

export const EXPLAIN = {
  ok: 'in sync',
  drift: 'region content differs from what the tokens produce',
  missing: 'file has no press region — the generated block was removed',
  absent: 'declared file does not exist at this path',
  corrupt: 'region markers are malformed',
};
