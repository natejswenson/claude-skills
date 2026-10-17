// Reconstruct only topology recorded in the reviewed real inspection, never config content.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSnapshot } from '../scripts/lib/inspect.mjs';
const cli = fileURLToPath(new URL('../scripts/dotfiles.js', import.meta.url));
const input = readSnapshot(fileURLToPath(new URL('inputs/inspection.json', import.meta.url)));
assert.ok(input.files.length >= 14 && input.packages.length >= 7, 'real inspection lost coverage');
assert.equal(input.excluded.length, 0, 'new exclusions need a reviewed replay implementation');
assert.equal(input.policyFiles.length, 0, 'new policy needs a reviewed replay implementation');
assert.ok(input.files.every(x => x.state === 'linked'), 'new observed states need a reviewed replay implementation');
const output = process.argv[2];
if (!output) throw new Error('output directory required');
const scratch = mkdtempSync(join(tmpdir(), 'dotfiles-replay-'));
try {
  const target = join(scratch, 'home'), repo = join(target, 'localrepo/dotfiles');
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'packages.json'), JSON.stringify(input.packages));
  for (const row of input.files) {
    const source = join(repo, row.package, row.path), destination = join(target, row.path);
    mkdirSync(dirname(source), { recursive: true }); writeFileSync(source, 'topology only\n');
    mkdirSync(dirname(destination), { recursive: true }); symlinkSync(source, destination);
  }
  const args = ['--repo', repo, '--target', target, '--json'];
  const inspected = execFileSync(process.execPath, [cli, 'inspect', ...args], { encoding: 'utf8' });
  const verified = execFileSync(process.execPath, [cli, 'verify', ...args], { encoding: 'utf8' });
  assert.equal(inspected, verified);
  assert.deepEqual(JSON.parse(inspected), input, 'classifier changed the real topology');
  mkdirSync(output, { recursive: true });
  const snapshot = join(output, 'inspection.json'); writeFileSync(snapshot, inspected);
  const report = execFileSync(process.execPath, [cli, 'report', '--input', snapshot], { encoding: 'utf8' });
  writeFileSync(join(output, 'inspection.md'), report);
} finally { rmSync(scratch, { recursive: true, force: true }); }
