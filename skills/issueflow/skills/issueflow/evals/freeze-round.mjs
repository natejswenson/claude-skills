#!/usr/bin/env node
/**
 * Freeze REAL pull request review rounds out of a finished run, so the
 * registrar can be re-run over them offline and byte-compared.
 *
 *   node evals/freeze-round.mjs --run-dir <run> --lane <slug> --rounds 1,2
 *
 * Lives beside `baseline/`, not inside it: `baseline/update.mjs` clears the
 * files it owns on every refresh, and the first copy of this script was
 * written there and silently deleted by the next refresh.
 *
 * What is copied, per round: the diff the round reviewed, every finder's
 * candidates file, every verifier's verdicts file, the fixer's report when
 * there is one, and the registrar's own outputs (`registered.json`,
 * `review-payload.json`) as the golden. Plus a snapshot of every file the
 * round could look at — every file in the diff and every file a candidate or
 * verdict cites — as it was at that round's head, read with `git show`, so
 * the golden test can rebuild a throwaway repository whose commits carry
 * exactly those trees and register the frozen round against it for real.
 *
 * Nothing here is invented: the candidates are what real opus finders filed,
 * the verdicts what real opus verifiers ruled, the diff the real change. The
 * source repository is public (the same city-report / #132 precedent), so
 * the snapshot carries no private data.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun } from '../scripts/lib/run.mjs';
import { historyTree } from '../scripts/lib/worktree.mjs';
import { parseDiff, reviewDir } from '../scripts/lib/prreview.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'inputs', 'review-round');

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null)).filter(Boolean));
if (!args['run-dir'] || !args.lane) {
  console.error('usage: freeze-round.mjs --run-dir <run> --lane <slug> [--rounds 1,2]');
  process.exit(2);
}
const runDir = args['run-dir'];
const run = loadRun(runDir);
const lane = run.lanes.find((l) => l.slug === args.lane);
if (!lane) throw new Error(`no lane ${args.lane}`);
const rounds = (args.rounds ? args.rounds.split(',').map(Number) : lane.review.rounds.map((r) => r.round));
const tree = historyTree(run);
const git = (a) => execFileSync('git', a, { cwd: tree, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const meta = {
  comment: 'Real pull request review rounds, frozen by evals/freeze-round.mjs. Candidates are what real opus finders filed, verdicts what real opus verifiers ruled, the diff the real change; files/ holds every cited or changed file at each round\'s head.',
  source: `${run.repo.owner}/${run.repo.name}#${run.issue.number}`,
  lane: lane.slug, pr: lane.pr?.number ?? null, base: lane.base, branch: lane.branch, rounds: [],
};

// The union of every file any requested round could look at — every file in a
// diff, every file a candidate, verdict or finding cites. Snapshotted at EVERY
// round's head, not just the round that cites it, so the rebuilt repository's
// round-to-round delta is the real one: a file first cited in round 2 but
// unchanged since round 1 must not show up as "added" between the two commits.
const files = new Set();
for (const n of rounds) {
  const src = reviewDir(runDir, lane, n);
  for (const f of parseDiff(readFileSync(join(src, 'diff.patch'), 'utf8'))) files.add(f.path);
  for (const f of readdirSync(src)) {
    if (!/^(candidates|verdicts)-\d+\.json$/.test(f)) continue;
    const data = JSON.parse(readFileSync(join(src, f), 'utf8'));
    for (const c of data.candidates ?? []) files.add(c.file);
    for (const v of data.verdicts ?? []) if (v.path) files.add(v.path);
  }
  for (const f of JSON.parse(readFileSync(join(src, 'registered.json'), 'utf8')).findings) files.add(f.file);
}

for (const n of rounds) {
  const entry = lane.review.rounds.find((r) => r.round === n);
  if (!entry?.registered) throw new Error(`round ${n} is not registered — nothing to freeze`);
  const src = reviewDir(runDir, lane, n);
  const dst = join(OUT, `r${n}`);
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(src)) {
    if (/^(diff\.patch|candidates-\d+\.json|verdicts-\d+\.json|registered\.json|review-payload\.json|fix-report\.json)$/.test(f)) {
      // Machine paths out: the lane worktree and the repository root become
      // `<repo>`, so the fixture carries no home directory and the golden
      // compares the same bytes on any machine.
      const text = readFileSync(join(src, f), 'utf8').split(`${tree}/`).join('').split(tree).join('<repo>')
        .split(`${run.repo.path}/`).join('').split(run.repo.path).join('<repo>');
      writeFileSync(join(dst, f), text);
    }
  }
  // The verification plan the live round used — which candidates survived
  // pooling and how they were dealt to verifiers. The replay reuses it rather
  // than re-pooling: the golden pins the registrar and the payload, and the
  // pooling rule has its own unit tests and is allowed to move.
  writeFileSync(join(dst, 'plan.json'), `${JSON.stringify({
    verifiers: entry.verifiers, candidateIds: entry.candidateIds ?? [], priorIds: entry.priorIds ?? [], candidates: entry.candidates ?? [],
  }, null, 2)}\n`.split(`${tree}/`).join('').split(tree).join('<repo>').split(`${run.repo.path}/`).join('').split(run.repo.path).join('<repo>'));
  const snap = join(OUT, 'files', `r${n}`);
  let count = 0;
  for (const path of files) {
    let text;
    try {
      text = git(['show', `${entry.head}:${path}`]);
    } catch {
      continue; // a deleted file has no tree entry at this head
    }
    mkdirSync(dirname(join(snap, path)), { recursive: true });
    writeFileSync(join(snap, path), text);
    count += 1;
  }
  meta.rounds.push({ round: n, head: entry.head, prevHead: entry.prevHead, lines: entry.lines, finders: entry.finders, verifiers: entry.verifiers, verdict: entry.verdict, counts: entry.counts, files: count });
  console.log(`froze round ${n}: ${entry.finders} finder(s), ${entry.verifiers} verifier(s), ${count} file(s) at ${entry.head.slice(0, 12)}, verdict ${entry.verdict}`);
}
writeFileSync(join(OUT, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
console.log(`wrote ${join(OUT, 'meta.json')}`);
