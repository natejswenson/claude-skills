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

# The corpus first: everything below is derived from it.
node evals/baseline/make-corpus.mjs
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

# `--at` is pinned: apply stamps the receipt with the current time otherwise,
# and a golden that embeds "now" fails on every run but the one that wrote it.
CMD='node scripts/gmailtriage.js propose --threads evals/baseline/threads.json --labels evals/baseline/labels.json --min-count 2 --show-withheld 20 --out $OUT/candidates.json > $OUT/propose.txt && node scripts/gmailtriage.js labels --rules evals/baseline/rules.json --labels evals/baseline/labels.json > $OUT/labels.txt && node scripts/gmailtriage.js plan --threads evals/baseline/threads.json --rules evals/baseline/rules.json --preview 8 --out $OUT/plan.json > $OUT/plan.txt && node scripts/gmailtriage.js apply --plan $OUT/plan.json --receipt $OUT/receipt.json --at 2026-08-05T12:00:00Z > $OUT/apply.txt && node scripts/gmailtriage.js subdivide --threads evals/baseline/filed.json --labels evals/baseline/filed-labels.json --parent Recruiting --out $OUT/subdivide-candidates.json > $OUT/subdivide.txt && node scripts/gmailtriage.js labels --rules evals/baseline/rules-recruiting.json --labels evals/baseline/filed-labels.json > $OUT/retro-labels.txt && node scripts/gmailtriage.js plan --threads evals/baseline/filed.json --labels evals/baseline/filed-labels.json --rules evals/baseline/rules-recruiting.json --scope "label:Recruiting" --preview 13 --out $OUT/retro-plan.json > $OUT/retro-plan.txt && node scripts/gmailtriage.js apply --plan $OUT/retro-plan.json --receipt $OUT/retro-receipt.json --at 2026-08-07T12:00:00Z > $OUT/retro-apply.txt && node scripts/gmailtriage.js plan --threads evals/baseline/filed-after.json --labels evals/baseline/filed-labels.json --rules evals/baseline/rules-recruiting.json --scope "label:Recruiting" > $OUT/retro-converged.txt && node scripts/gmailtriage.js audit --labels evals/baseline/mailbox-before-labels.json --rules evals/baseline/mailbox-before-rules.json --threads evals/baseline/mailbox-before.json > $OUT/audit-before.txt || true && node scripts/gmailtriage.js audit --labels evals/baseline/mailbox-after-labels.json --rules evals/baseline/mailbox-after-rules.json --threads evals/baseline/mailbox-after.json > $OUT/audit-after.txt && node scripts/gmailtriage.js merge --from Reciepts --to Receipts --threads evals/baseline/mailbox-before.json --labels evals/baseline/mailbox-before-labels.json --receipt $OUT/merge-receipt.json --at 2026-08-07T12:00:00Z > $OUT/merge.txt'

eval "${CMD//\$OUT/$OUT}"

node - "$OUT" "$CMD" <<'NODE'
const { readFileSync, writeFileSync, readdirSync, copyFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const [, , out, command] = process.argv;
const artifacts = readdirSync(out).sort().map((path) => {
  const buf = readFileSync(join(out, path));
  copyFileSync(join(out, path), join('evals', 'baseline', path));
  return { path, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
});
writeFileSync('evals/baseline/MANIFEST.json', JSON.stringify({
  $comment: 'Frozen from a REAL run of this skill, not a synthetic fixture. `command` reproduces it: the baseline test re-runs it into a temp directory and byte-compares against these artifacts.',
  label: 'the-real-run',
  command,
  artifacts,
}, null, 2) + '\n');
console.log(`froze ${artifacts.length} artifacts`);
NODE
