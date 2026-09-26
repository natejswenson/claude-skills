// Manual integration evidence using real GNU Stow; no home override or live links.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, lstatSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspect, verify } from '../scripts/lib/inspect.mjs';
for (const p of ['.stowrc', '.stow-global-ignore']) {
  if (existsSync(join(homedir(), p))) throw new Error(`Manual policy reconciliation required before lifecycle dogfood: ${p}`);
}
execFileSync('stow', ['--version']);
const root = mkdtempSync(join(tmpdir(), 'dotfiles-lifecycle-'));
const put = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
try {
  const target = join(root, 'home'), repo = join(target, 'localrepo/dotfiles');
  mkdirSync(repo, { recursive: true });
  put(join(repo, 'packages.json'), '["shell"]');
  put(join(repo, 'shell/.zshrc'), '# portable\n');
  put(join(target, '.zshrc.local'), '# private override\n');
  put(join(target, '.config/unrelated'), 'keep');
  const stow = (simulate, mode, name) => execFileSync('stow', [`--dir=${repo}`, `--target=${target}`, '--no-folding', '--verbose', ...(simulate ? ['--simulate'] : []), mode, name], { cwd: repo, stdio: 'pipe' });
  assert.equal(inspect({ repo, target }).counts.missing, 1);
  stow(true, '--restow', 'shell'); assert.equal(existsSync(join(target, '.zshrc')), false);
  stow(false, '--restow', 'shell'); assert.equal(verify(inspect({ repo, target })), true);
  put(join(repo, 'shell/.zshrc'), '# edited shared config\n');
  assert.equal(readFileSync(join(target, '.zshrc'), 'utf8'), '# edited shared config\n');
  put(join(repo, 'editor/.config/editor/settings file'), '{}\n');
  put(join(repo, 'packages.json'), '["shell", "editor"]');
  stow(true, '--restow', 'editor'); stow(false, '--restow', 'editor');
  stow(true, '--restow', 'shell'); stow(false, '--restow', 'shell');
  assert.equal(verify(inspect({ repo, target })), true);
  assert.equal(lstatSync(join(target, '.config/editor')).isSymbolicLink(), false);
  stow(true, '--delete', 'shell'); stow(false, '--delete', 'shell');
  put(join(target, '.zshrc'), '# original conflict\n');
  assert.equal(inspect({ repo, target, packages: ['shell'] }).counts.conflict, 1);
  assert.throws(() => stow(true, '--restow', 'shell'));
  const backup = join(root, 'backup'); mkdirSync(backup);
  renameSync(join(target, '.zshrc'), join(backup, '.zshrc'));
  stow(true, '--restow', 'shell'); stow(false, '--restow', 'shell');
  assert.equal(verify(inspect({ repo, target })), true);
  stow(true, '--delete', 'shell'); stow(false, '--delete', 'shell');
  assert.equal(existsSync(join(target, '.zshrc')), false);
  renameSync(join(backup, '.zshrc'), join(target, '.zshrc'));
  assert.equal(readFileSync(join(target, '.zshrc'), 'utf8'), '# original conflict\n');
  assert.equal(readFileSync(join(target, '.zshrc.local'), 'utf8'), '# private override\n');
  assert.equal(readFileSync(join(target, '.config/unrelated'), 'utf8'), 'keep');
  assert.equal(verify(inspect({ repo, target, packages: ['editor'] })), true);
  assert.equal(existsSync(join(repo, 'shell/.zshrc')), true);
  console.log('PASS: inspect, edit, add package, simulate, link, repeat, unlink, conflict backup/recovery, unrelated-file preservation');
} finally { rmSync(root, { recursive: true, force: true }); }
