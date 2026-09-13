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
# It used to be a redacted copy of one, and redaction was the wrong tool: with
# every sender pseudonymised, a public repo still showed the SHAPE of a
# person's life — which bank, which health system, which school district, which
# employer they had applied to. The thing worth hiding was never the addresses.
#
# So there is no longer a redactor to point at a mailbox. To change what the
# corpus contains, edit `make-corpus.mjs`; `scripts/tests/no-real-data.test.mjs`
# fails the build if a domain outside the reserved TLDs ever appears.
#
# Working against your own mail is still fine — keep those files outside the
# repo (`~/.gmailtriage/` is gitignored by living outside it) and never copy
# them in.
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
const changed = new Set(['pending-receipt.json', 'retro-pending-receipt.json', 'merge-pending-receipt.json', 'apply.txt', 'retro-apply.txt', 'merge.txt']);
execFileSync('bash', ['-lc', manifest.command.replaceAll('$OUT', out)], { stdio: 'inherit' });
const hash = (buf) => createHash('sha256').update(buf).digest('hex');
for (const a of manifest.legacyReceipts) {
  const buf = readFileSync(join(base, a.path));
  if (buf.length !== a.bytes || hash(buf) !== a.sha256) throw new Error('legacy receipt drift: ' + a.path);
}
const artifacts = manifest.artifacts.map((a) => {
  const buf = readFileSync(join(out, a.path));
  if (!changed.has(a.path)) {
    if (!buf.equals(readFileSync(join(base, a.path))) || buf.length !== a.bytes || hash(buf) !== a.sha256) throw new Error('unrelated golden drift: ' + a.path);
    return a;
  }
  return { path: a.path, bytes: buf.length, sha256: hash(buf) };
});
for (const path of changed) copyFileSync(join(out, path), join(base, path));
writeFileSync(join(base, 'MANIFEST.json'), JSON.stringify({ ...manifest, artifacts }, null, 2) + '\n');
console.log('froze six lifecycle artifacts; unrelated artifacts and legacy receipts preserved');
NODE
