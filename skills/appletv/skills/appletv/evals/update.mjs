#!/usr/bin/env node
/**
 * Refresh the baseline from a REAL run directory (the --out of scan, state and
 * send against a real Apple TV), redacting what identifies the household:
 * MAC addresses, device identifiers and build numbers never reach the repo,
 * and apps.json is left out entirely — an app list says who lives in a home.
 * The report never printed any of them, so the golden loses nothing.
 *
 *   node evals/update.mjs <run dir>
 *
 * then re-freeze so MANIFEST.json's hashes match:
 *   skillfactory freeze --skill appletv --from evals/baseline --command "$(jq -r .command evals/baseline/MANIFEST.json)" --trap-command "…"
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { verdict, textVerdict } from '../scripts/lib/verify.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..');
const BASELINE = join(HERE, 'baseline');
const from = process.argv[2];
if (!from || !existsSync(from)) {
  console.error('usage: node evals/update.mjs <run dir with scan.json, state.json, send-NN.json>');
  process.exit(2);
}

const REDACT = (obj) => {
  if (Array.isArray(obj)) return obj.map(REDACT);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'mac') out[k] = 'REDACTED';
      else if (k === 'identifier') out[k] = 'REDACTED-ID';
      else if (k === 'all_identifiers') out[k] = ['REDACTED-ID'];
      else if (k === 'build') out[k] = null;
      else out[k] = REDACT(v);
    }
    return out;
  }
  return obj;
};

for (const f of readdirSync(BASELINE)) if (/\.(json|txt)$/.test(f) && f !== 'MANIFEST.json') rmSync(join(BASELINE, f));
const keep = readdirSync(from).filter((f) => f === 'scan.json' || f === 'state.json' || /^send-\d+\.json$/.test(f) || /^type-\d+\.json$/.test(f)).sort();
if (keep.length === 0) { console.error(`${from}: no captures`); process.exit(2); }
const rederived = [];
for (const f of keep) {
  const cap = REDACT(JSON.parse(readFileSync(join(from, f), 'utf8')));
  // A refresh is a reviewed act: the recorded verdict is re-derived from the
  // CURRENT rules, and every change is printed so the reviewer sees what moved.
  if (/^send-/.test(f) && cap.verdict) {
    const now = verdict(cap);
    if (now.verdict !== cap.verdict.verdict || now.why !== cap.verdict.why) rederived.push(`${f}: ${cap.verdict.verdict} → ${now.verdict} (${now.why})`);
    cap.verdict = now;
  }
  if (/^type-/.test(f) && cap.verdict) cap.verdict = textVerdict(cap);
  writeFileSync(join(BASELINE, f), `${JSON.stringify(cap, null, 2)}\n`);
}
if (rederived.length) console.log(`re-derived verdicts (review these):\n  ${rederived.join('\n  ')}`);
const report = execFileSync('node', ['scripts/appletv.js', 'report', '--from', BASELINE], { cwd: SKILL, encoding: 'utf8' });
writeFileSync(join(BASELINE, 'report.txt'), report);
console.log(`baseline refreshed from ${from}: ${keep.join(', ')} + report.txt (identifiers redacted, apps.json omitted)`);
