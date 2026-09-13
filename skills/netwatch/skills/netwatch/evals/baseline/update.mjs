// Re-render the existing real metadata capture; never collect new private traffic.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const base = resolve(root, 'evals/baseline');
const cli = resolve(root, 'scripts/netwatch.js');
const args = ['--snapshot', resolve(base, 'capture.txt'), '--baseline', resolve(base, 'baseline.json')];
writeFileSync(resolve(base, 'report.txt'), execFileSync(process.execPath, [cli, 'report', ...args]));
execFileSync(process.execPath, [cli, 'render', ...args, '--captured-at', '2026-08-12', '--out', resolve(base, 'report.html')]);
const manifest = JSON.parse(readFileSync(resolve(base, 'MANIFEST.json')));
for (const entry of manifest.artifacts) {
  const data = readFileSync(resolve(base, entry.path));
  entry.bytes = data.length;
  entry.sha256 = createHash('sha256').update(data).digest('hex');
}
writeFileSync(resolve(base, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Refreshed report artifacts from the existing frozen metadata capture. Review the diff.');
