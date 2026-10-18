#!/usr/bin/env bash
#
# Re-freeze the baseline.
#
#   bash evals/baseline/refresh.sh
#
# This is the `update_command` every entry in `skill-invariants.json` names.
#
# It regenerates the derived artifacts (propose/subdivide/labels/plan/apply/
# audit/merge output) from the committed corpus, and the corpus itself comes
# from `make-corpus.mjs`.
#
# ─────────────────────────────────────────────────────────────────────────────
# THE CORPUS IS INVENTED. NEVER REGENERATE IT FROM A REAL MAILBOX.
#
# Edit only the synthetic generator; never copy a mailbox export into fixtures.
# Keep personal working files outside the checkout.
# ─────────────────────────────────────────────────────────────────────────────
#
# ALWAYS read the diff before committing a refresh. A golden that changed
# because the code changed is a finding; a golden refreshed without looking is
# a test that has stopped testing.
set -euo pipefail

cd "$(dirname "$0")/../.."

# Generate into a temporary directory; validate all unrelated artifacts before copying.
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
node --input-type=module - "$OUT" <<'NODE'
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const out = process.argv[2], base = 'evals/baseline';
const manifest = JSON.parse(readFileSync(join(base, 'MANIFEST.json'), 'utf8'));
execFileSync('node', [join(base, 'make-corpus.mjs')], { stdio: 'inherit' });
execFileSync('bash', ['-lc', manifest.command.replaceAll('$OUT', out)], { stdio: 'inherit' });
const hash = (buf) => createHash('sha256').update(buf).digest('hex');
for (const a of manifest.legacyReceipts) {
  const buf = readFileSync(join(base, a.path));
  if (buf.length !== a.bytes || hash(buf) !== a.sha256) throw new Error('legacy receipt drift: ' + a.path);
}
const artifacts = manifest.artifacts.map((a) => {
  const buf = readFileSync(join(out, a.path));
  return { path: a.path, bytes: buf.length, sha256: hash(buf) };
});
for (const { path } of artifacts) copyFileSync(join(out, path), join(base, path));
writeFileSync(join(base, 'MANIFEST.json'), JSON.stringify({ ...manifest, artifacts }, null, 2) + '\n');
console.log('froze synthetic regression artifacts; legacy-schema fixtures verified');
NODE
