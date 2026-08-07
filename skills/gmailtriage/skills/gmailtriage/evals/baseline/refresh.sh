#!/usr/bin/env bash
#
# Re-freeze the baseline from the frozen corpus.
#
#   bash evals/baseline/refresh.sh
#
# This is the `update_command` every entry in `skill-invariants.json` names, and
# it exists because that field pointed at a file that was never written — so the
# one-command refresh the house rules require was a dead string from 0.1.0 until
# 0.2.0. If you are here because an assertion printed this path, you are in the
# right place.
#
# It regenerates ONLY the derived artifacts (propose/labels/plan/apply output,
# and the subdivide/retroactive pair) from the committed corpus. It does not
# touch `threads.json`, `labels.json`, `rules.json`, `filed*.json` or
# `rules-recruiting.json` — those come from a real mailbox, and refreshing them
# means running the skill against one and passing the result through
# `redact.mjs`:
#
#   node evals/baseline/redact.mjs           <real-threads.json>    threads.json
#   node evals/baseline/redact.mjs --labels  <real-list_labels.json> labels.json
#
#   # the sub-label corpus — `--labels-from` is REQUIRED here, or each thread
#   # keeps real label ids the redacted label list has renamed, and the corpus
#   # describes a mailbox where nothing resolves while still looking complete
#   node evals/baseline/redact.mjs --labels-from <real-list_labels.json> \
#     <recruiting-threads.json>       filed.json         # before the run
#   node evals/baseline/redact.mjs --labels-from <real-list_labels.json> \
#     <recruiting-threads-after.json> filed-after.json   # after it
#   node evals/baseline/redact.mjs --labels <real-list_labels.json> filed-labels.json
#
#   # the hygiene corpus — the mailbox BEFORE the label cleanup and AFTER it.
#   # `--rules-in/--rules-out` MUST run in the same invocation as the threads:
#   # the rule set names the same senders and folders, and redacting it in a
#   # separate process gives it different pseudonyms, so no rule matches
#   # anything and the audit reports zero coverage as if it were a real finding.
#   node evals/baseline/redact.mjs --labels-from <real-list_labels.json> \
#     --rules-in <rules-before.json> --rules-out mailbox-before-rules.json \
#     <threads-before.json> mailbox-before.json
#   node evals/baseline/redact.mjs --labels <real-list_labels.json> mailbox-before-labels.json
#   (and the same three for the -after side)
#
# NOTHING in this corpus may name an organisation the mailbox owner deals with.
# `redact.mjs` pseudonymises sender domains and applicant-tracking subject lines
# for that reason; what the code reasons about is that seven threads share a
# domain, never which domain.
#
# ALWAYS read the diff before committing a refresh. A golden that changed
# because the code changed is a finding; a golden refreshed without looking is
# a test that has stopped testing.
set -euo pipefail

cd "$(dirname "$0")/../.."
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
