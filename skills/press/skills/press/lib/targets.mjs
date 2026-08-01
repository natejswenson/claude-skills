/**
 * The consumer registry.
 *
 * A target is one region in one file in one repo. Declaring a consumer here is
 * what makes it press's business; anything not declared is invisible to
 * `check`, which is why `doctor` exists to show the whole registry rather than
 * only what resolved locally.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TARGETS_PATH = join(HERE, '..', 'targets.json');

export class TargetError extends Error {}

export function loadTargets(path = TARGETS_PATH) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const targets = raw.targets ?? [];
  const seen = new Set();
  for (const t of targets) {
    for (const key of ['id', 'repo', 'path', 'region', 'emitter', 'syntax']) {
      if (!t[key]) throw new TargetError(`target ${t.id ?? '<unnamed>'} is missing "${key}"`);
    }
    if (seen.has(t.id)) throw new TargetError(`duplicate target id "${t.id}"`);
    seen.add(t.id);
  }
  return targets;
}

/** Nearest ancestor containing a .git, or the path itself. */
export function repoRoot(start = process.cwd()) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export const targetPath = (target, root) =>
  isAbsolute(target.path) ? target.path : join(root, target.path);

/**
 * The repository a checkout actually is, from its origin remote.
 *
 * File presence alone cannot identify a consumer: `README.md` exists in every
 * repo, so a README target would select inside any checkout and be checked
 * against the wrong file. Returns null when there is no remote (a temp dir in a
 * test), in which case callers fall back to presence.
 */
export function repoIdentity(root) {
  try {
    const url = execFileSync('git', ['-C', root, 'config', '--get', 'remote.origin.url'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const m = /([^/:]+?)(?:\.git)?$/.exec(url);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Which targets this invocation is responsible for.
 *
 * Selection is by *file presence* under the repo root, so the same registry
 * works unchanged whether it runs inside claude-skills, budget, or the site.
 * An explicit `--target` always selects, present or not, so a typo'd path
 * reports as missing rather than silently selecting nothing.
 */
export function selectTargets(targets, { root, ids }) {
  if (ids?.length) {
    return ids.map((id) => {
      const found = targets.find((t) => t.id === id);
      if (!found) {
        throw new TargetError(
          `no target "${id}" — known targets: ${targets.map((t) => t.id).join(', ')}`,
        );
      }
      return found;
    });
  }
  const identity = repoIdentity(root);
  return targets.filter((t) => {
    if (!existsSync(targetPath(t, root))) return false;
    // When the checkout names itself, trust that over a path that happens to
    // exist — otherwise every repo's README matches every README target.
    if (identity) return identity === (t.github ?? t.repo);
    return true;
  });
}
