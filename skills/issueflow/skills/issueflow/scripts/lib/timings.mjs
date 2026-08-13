/**
 * Past durations of this repo's own stage runs, read from the run's sibling
 * directories.
 *
 * `dirname(runDir)` is `owner__name` (see `run.mjs`'s `runDir`), so its
 * siblings are this repo's other runs and nothing else — no configuration,
 * no cross-repo pooling. Stage duration is dominated by codebase size and
 * test-suite runtime, both properties of the repo, so pooling would produce a
 * confident number measured on a different codebase. A sibling this cannot
 * parse — schema 1, truncated JSON, no `run.json` at all — is skipped, never
 * thrown: a history scan degrading to "no history" must never crash a brief.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { formatSpan, SCHEMA } from './run.mjs';

/** One completed duration, briefed to delivered, in milliseconds — `durationOf`'s own rule, read from the raw JSON. */
function durationMs(entry) {
  const { briefed, delivered } = entry?.at ?? {};
  if (!briefed || !delivered) return null;
  const ms = Date.parse(delivered) - Date.parse(briefed);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** Every completed stage duration in one run: the shared stages once, then each lane's own. */
function samplesOf(run) {
  const out = [];
  for (const entry of Array.isArray(run.stages) ? run.stages : []) {
    const ms = durationMs(entry);
    if (ms !== null) out.push({ stage: entry.id, ms });
  }
  for (const lane of Array.isArray(run.lanes) ? run.lanes : []) {
    for (const entry of Array.isArray(lane.stages) ? lane.stages : []) {
      const ms = durationMs(entry);
      if (ms !== null) out.push({ stage: entry.id, ms });
    }
  }
  return out;
}

const median = (sorted) => {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Every completed stage duration found among `runDir`'s siblings, grouped by
 * stage id. One entry per stage id with at least one sample —
 * `{ stage, n, min, median, max }`, each duration formatted the way
 * `durationOf` renders one. A stage with no samples anywhere is simply
 * absent from the result; the caller decides what "no history" says.
 */
export function readTimings(runDir) {
  const parent = dirname(runDir);
  let names;
  try {
    names = existsSync(parent) ? readdirSync(parent) : [];
  } catch {
    return [];
  }

  const byStage = new Map();
  for (const name of names) {
    const dir = join(parent, name);
    if (dir === runDir) continue;
    const statePath = join(dir, 'run.json');
    if (!existsSync(statePath)) continue;

    let run;
    try {
      run = JSON.parse(readFileSync(statePath, 'utf8'));
    } catch {
      continue;
    }
    if (run?.schema !== SCHEMA) continue;

    let samples;
    try {
      samples = samplesOf(run);
    } catch {
      continue;
    }
    for (const { stage, ms } of samples) {
      if (!byStage.has(stage)) byStage.set(stage, []);
      byStage.get(stage).push(ms);
    }
  }

  return [...byStage.entries()].map(([stage, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      stage,
      n: sorted.length,
      min: formatSpan(sorted[0]),
      median: formatSpan(median(sorted)),
      max: formatSpan(sorted[sorted.length - 1]),
    };
  });
}
