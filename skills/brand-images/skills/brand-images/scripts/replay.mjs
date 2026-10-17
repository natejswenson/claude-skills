#!/usr/bin/env node
// Offline replay of the deterministic portion of a real image run.
// Images are frozen live outputs, never synthesized or regenerated here.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execute, validate } from './brand-images.js';
const HERE = dirname(fileURLToPath(import.meta.url));
const INPUT = resolve(HERE, '../evals/demo-input');
const args = process.argv.slice(2);
const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : null;
const read = path => JSON.parse(readFileSync(path, 'utf8'));
function report(state, base, out) {
  validate(state, base);
  mkdirSync(out, { recursive: true });
  // No source text, feedback text, user identifiers, absolute paths, or private state.
  // The demonstration's creative brief contains only public example style/subject data.
  const summary = {
    schema: 1, currentRevision: state.current,
    revisions: state.revisions.map(r => ({ revision: r.revision, status: r.status })),
    runs: state.runs.map(r => ({ id: r.id, revision: r.revision, status: r.status,
      artifact: r.artifact, review: r.review, backend: r.backend })),
    feedback: state.feedback.map(f => ({ run: f.run, scope: f.scope, revision: f.revision, patch: f.patch })),
  };
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  for (const r of state.runs) writeFileSync(join(out, `${r.id}-brief.json`), JSON.stringify({
    revision: r.brief.revision, styleStatus: r.brief.styleStatus, prompt: r.brief.prompt,
  }, null, 2) + '\n');
}
let temp, trapOut;
try {
  const out = value('--out') ?? (args.includes('--trap') ? (trapOut = mkdtempSync(join(tmpdir(), 'brand-images-trap-'))) : null);
  if (!out) throw new Error('--out is required');
  if (value('--from-live')) {
    const base = resolve(value('--from-live'));
    report(read(join(base, 'state.json')), base, resolve(out));
  } else {
    temp = mkdtempSync(join(tmpdir(), 'brand-images-replay-'));
    const run = (command, data = {}) => execute(command, { home: temp, profile: 'editorial', ...data });
    run('profile', { action: 'init', from: join(INPUT, 'profile.json'), source: 'Public editorial mountain demonstration, draft interpretation' });
    run('brief', { from: join(INPUT, 'request.json'), run: 'mountain-first' });
    run('run', { run: 'mountain-first', status: 'generated', image: join(INPUT, 'mountain-first.png'), backend: 'codex-built-in-imagegen', review: join(INPUT, 'review.json') });
    run('feedback', { run: 'mountain-first', event: 'simplify-first', scope: 'durable', text: 'Slightly simplify future image composition',
      source: 'Explicit simplification feedback during real development run', patch: join(INPUT, 'patch.json'), expect: 1, confirm: true });
    run('brief', { from: join(INPUT, 'request-v2.json'), run: 'mountain-simplified' });
    run('run', { run: 'mountain-simplified', status: 'generated', image: join(INPUT, 'mountain-simplified.png'), backend: 'codex-built-in-imagegen', review: join(INPUT, 'review-v2.json') });
    const state = run('history');
    if (args.includes('--trap')) state.runs[1].profileHash = state.runs[0].profileHash;
    report(state, join(temp, 'profiles/editorial'), resolve(out));
  }
} catch (err) { console.error(err.message); process.exitCode = 1; }
finally { if (temp) rmSync(temp, { recursive: true, force: true }); if (trapOut) rmSync(trapOut, { recursive: true, force: true }); }
