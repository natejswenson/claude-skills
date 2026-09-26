// Return the actual inspector's status. If its path guard weakens, this exits zero
// and the generated baseline's negative assertion fails.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = mkdtempSync(join(tmpdir(), 'dotfiles-trap-'));
try {
  const repo = join(root, 'repo'), target = join(root, 'target');
  mkdirSync(repo); mkdirSync(target); mkdirSync(join(root, 'escape'));
  writeFileSync(join(root, 'escape/file'), 'not a package');
  writeFileSync(join(repo, 'packages.json'), '["../escape"]');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/dotfiles.js', import.meta.url)), 'inspect', '--repo', repo, '--target', target]);
  if (result.error || result.signal || result.status === null) throw new Error('trap did not execute');
  process.exitCode = result.status;
} finally { rmSync(root, { recursive: true, force: true }); }
