/**
 * Applying a plan — all of it, or none of it.
 *
 * Wiring a skill in halfway is worse than not wiring it at all, because the
 * half that landed makes the missing half look done. So every anchor is
 * resolved and every destination checked BEFORE the first byte is written, and
 * a single unresolvable anchor aborts the whole apply with the reason.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const read = (p) => readFileSync(p, 'utf8');

class PlanError extends Error {}

/**
 * Re-serialize JSON the way the file was already written.
 *
 * `targets.json` is maintained by press's Python tooling, which writes
 * `ensure_ascii=True` — so every em dash is stored as `—`. Round-tripping
 * it through `JSON.stringify` alone rewrites hundreds of unrelated lines, which
 * buries the two-line change smith actually made and makes the diff unreviewable.
 * Adding one entry should touch one entry.
 */
export function serializeLike(original, data) {
  const text = JSON.stringify(data, null, 2);
  const wasAscii = /\\u[0-9a-fA-F]{4}/.test(original);
  if (!wasAscii) return text;
  return text.replace(/[-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Resolve every edit against the repo as it is right now, returning the exact
 * new text for each touched file. Throws before anything is written.
 */
export function resolveEdits(repo, edits) {
  const resolved = new Map(); // path -> text

  for (const e of edits) {
    const abs = join(repo, e.path);
    if (!existsSync(abs)) throw new PlanError(`${e.path}: does not exist — cannot wire into a registry that is not there`);
    const before = resolved.get(e.path) ?? read(abs);

    if (e.json) {
      const next = e.json(JSON.parse(before));
      // A null return means "already present" — idempotent, not an error.
      resolved.set(e.path, next === null ? before : `${serializeLike(before, next)}\n`);
      continue;
    }

    if (e.appendTableRow) {
      if (before.includes(e.appendTableRow.row)) {
        resolved.set(e.path, before);
        continue;
      }
      const matches = [...before.matchAll(e.appendTableRow.after)];
      if (matches.length === 0) throw new PlanError(`${e.path}: no table to append to (${e.why})`);
      const last = matches[matches.length - 1];
      const at = last.index + last[0].length;
      resolved.set(e.path, `${before.slice(0, at)}\n${e.appendTableRow.row}${before.slice(at)}`);
      continue;
    }

    if (before.includes(e.replace)) {
      resolved.set(e.path, before); // already applied
      continue;
    }
    if (!before.includes(e.find)) {
      throw new PlanError(`${e.path}: anchor not found — ${JSON.stringify(e.find.slice(0, 60))} (${e.why})`);
    }
    resolved.set(e.path, before.replace(e.find, e.replace));
  }

  return resolved;
}

/**
 * Apply a scaffold plan. Returns a report of what changed.
 * `force` is required to overwrite an existing file — a skill directory that
 * already exists is far more likely to be someone's work than a mistake.
 */
export function applyPlan(repo, plan, { force = false, dryRun = false } = {}) {
  const collisions = plan.files.filter((f) => existsSync(join(repo, f.path)));
  if (collisions.length > 0 && !force) {
    throw new PlanError(
      `${collisions.length} file(s) already exist, refusing to overwrite: ${collisions.map((c) => c.path).join(', ')}`,
    );
  }

  const edited = resolveEdits(repo, plan.edits);
  const rows = [];

  for (const f of plan.files) {
    const abs = join(repo, f.path);
    const action = existsSync(abs) ? 'overwrite' : 'create';
    if (!dryRun) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.content);
    }
    rows.push({ path: f.path, action, bytes: Buffer.byteLength(f.content) });
  }

  for (const [path, text] of edited) {
    const abs = join(repo, path);
    const changed = read(abs) !== text;
    if (!dryRun && changed) writeFileSync(abs, text);
    rows.push({ path, action: changed ? 'wire' : 'already wired', bytes: Buffer.byteLength(text) });
  }

  return rows;
}

export { PlanError };
