// Eval-only: normalize checked volatile run identities and temporary-root prefixes.
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
export function normalizeReceipts(out) {
  const root = realpathSync(out), temp = realpathSync(tmpdir());
  if (!root.startsWith(temp + sep)) throw new Error('normalization requires an OS temporary root');
  const seen = new Set(), staged = [];
  for (const prefix of ['', 'retro-', 'merge-']) {
    const file = join(root, prefix + 'pending-receipt.json'), output = join(root, prefix === 'merge-' ? 'merge.txt' : prefix + 'apply.txt');
    const raw = readFileSync(file, 'utf8'), r = JSON.parse(raw), text = readFileSync(output, 'utf8');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.runId) || seen.has(r.runId)) throw new Error('invalid or duplicate run UUID');
    seen.add(r.runId);
    const references = [...text.matchAll(/runId=([^\s]+)/g)].map((m) => m[1]);
    if (references.length !== 1 || references[0] !== r.runId) throw new Error('inconsistent run identity reference');
    if (r.snapshot !== null && !resolve(r.snapshot).startsWith(root + sep)) throw new Error('snapshot outside expected temporary root');
    const normalized = raw.replace(r.runId, '00000000-0000-4000-8000-000000000000');
    // Preserve every other byte, including tuples, operation IDs, evidence and status.
    staged.push([file, r.snapshot === null ? normalized : normalized.replace(JSON.stringify(r.snapshot), JSON.stringify('$OUT' + r.snapshot.slice(root.length)))],
      [output, text.replace(r.runId, '00000000-0000-4000-8000-000000000000')]);
  }
  for (const [file, text] of staged) writeFileSync(file, text);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) normalizeReceipts(process.argv[2]);
