// One-time (but idempotent, safely re-runnable) migration that backfills the
// frozen `no` field onto every pre-existing manifest row that lacks one. Run
// once against the published corpus after `publishEntry` started emitting
// `no` for new entries (see publish_entry.mjs) — everything published before
// that point needs a number assigned retroactively.
//
// `no` is a single global sequence across ALL projects (issue numbers of one
// publication), so this walks every project directory under corpusDir
// together rather than numbering each project's manifest independently.
//
// Tiebreak for entries sharing a date (common in this corpus — multiple
// projects, and multiple releases of one project, often ship the same day):
// date ascending, then project name ascending, then filename ascending. Both
// of those are stable fields already on the row, so the order is
// deterministic and reproducible from the data alone, with no external
// input (e.g. "whichever I published first today") required to redo it.
//
// Mutates ONLY the `no` field. Never touches `.md` files. Never touches
// `cover`. Preserves every other field's value and the manifest's existing
// key order — `no` is inserted immediately before `cover` (matching where
// publishEntry places it on a fresh row) or appended at the end when the row
// has no cover, so old and newly-migrated rows end up shaped the same way.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteJSON } from './core.mjs';

function compareRows(a, b) {
  return String(a.date).localeCompare(String(b.date))
    || a.project.localeCompare(b.project)
    || String(a.file).localeCompare(String(b.file));
}

function insertNo(entry, no) {
  const out = {};
  let inserted = false;
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'cover' && !inserted) {
      out.no = no;
      inserted = true;
    }
    out[key] = value;
  }
  if (!inserted) out.no = no;
  return out;
}

// dryRun: compute and return the assignment without writing anything —
// useful to preview before committing to a run.
export function migrateEntryNumbers(corpusDir, { dryRun = false } = {}) {
  if (!existsSync(corpusDir)) throw new Error(`Corpus directory not found: ${corpusDir}`);

  const projects = readdirSync(corpusDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const manifestsByProject = new Map();
  let maxNo = 0;
  const unnumbered = [];

  for (const project of projects) {
    const manifestPath = join(corpusDir, project, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!manifest || !Array.isArray(manifest.entries)) {
      throw new Error(`Malformed manifest at ${manifestPath}: expected { "entries": [...] }.`);
    }
    manifestsByProject.set(project, manifest);

    manifest.entries.forEach((entry, index) => {
      if (!entry) return;
      if (Number.isInteger(entry.no)) {
        if (entry.no > maxNo) maxNo = entry.no;
      } else {
        unnumbered.push({ project, index, date: String(entry.date), file: String(entry.file) });
      }
    });
  }

  unnumbered.sort(compareRows);

  const assigned = [];
  let next = maxNo + 1;
  for (const row of unnumbered) {
    const manifest = manifestsByProject.get(row.project);
    manifest.entries[row.index] = insertNo(manifest.entries[row.index], next);
    assigned.push({ project: row.project, file: row.file, date: row.date, no: next });
    next += 1;
  }

  const touchedProjects = [...new Set(unnumbered.map((r) => r.project))].sort();
  if (!dryRun) {
    for (const project of touchedProjects) {
      atomicWriteJSON(join(corpusDir, project, 'manifest.json'), manifestsByProject.get(project));
    }
  }

  return { assigned, touchedProjects, startingNo: maxNo + 1, endingNo: next - 1 };
}

// CLI entry point: `node migrate_entry_numbers.mjs <corpusDir> [--dry-run]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const corpusDir = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!corpusDir) {
    console.error('Usage: node migrate_entry_numbers.mjs <corpusDir> [--dry-run]');
    process.exit(2);
  }
  const result = migrateEntryNumbers(corpusDir, { dryRun });
  console.log(JSON.stringify(result, null, 2));
  if (result.assigned.length === 0) {
    console.error('Nothing to do — every entry already has `no`.');
  } else {
    console.error(`${dryRun ? '[dry run] would assign' : 'Assigned'} ${result.assigned.length} numbers (${result.startingNo}..${result.endingNo}).`);
  }
}
