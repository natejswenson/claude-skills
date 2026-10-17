import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspect, verify, render, validateSnapshot } from '../lib/inspect.mjs';
const cli = fileURLToPath(new URL('../dotfiles.js', import.meta.url));
function fixture(t, names = ['shell', 'editor'], nested = false) {
  const root = mkdtempSync(join(tmpdir(), 'dotfiles-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, 'home'), repo = nested ? join(target, 'localrepo', 'dotfiles') : join(root, 'source with spaces');
  mkdirSync(target, { recursive: true }); mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'packages.json'), JSON.stringify(names));
  return { root, repo, target, put(p, content = 'fixture\n') { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content); } };
}
test('inspects nested checkout, selected packages and valid shared parents without reading file contents', t => {
  const f = fixture(t, undefined, true);
  f.put(join(f.repo, 'shell/.config/shell/rc'));
  f.put(join(f.repo, 'editor/.config/editor/settings file'));
  f.put(join(f.target, '.config/unrelated'), 'keep');
  let s = inspect(f);
  assert.equal(s.counts.missing, 2); assert.equal(verify(s), false);
  mkdirSync(join(f.target, '.config/shell'));
  symlinkSync(join(f.repo, 'shell/.config/shell/rc'), join(f.target, '.config/shell/rc'));
  s = inspect({ ...f, packages: ['shell'] });
  assert.equal(verify(s), true); assert.equal(s.files.length, 1);
  assert.equal(readFileSync(join(f.target, '.config/unrelated'), 'utf8'), 'keep');
  assert.equal(JSON.stringify(s).includes(f.root), false);
});
test('classifies conflicts, wrong/broken links and both parent blockers', t => {
  const f = fixture(t, ['p']);
  for (const n of ['conflict', 'wrong', 'broken', 'linked', 'missing', 'dir/file', 'parent/file']) f.put(join(f.repo, 'p', n));
  f.put(join(f.target, 'conflict')); f.put(join(f.target, 'other'));
  symlinkSync(join(f.target, 'other'), join(f.target, 'wrong'));
  symlinkSync(join(f.target, 'absent'), join(f.target, 'broken'));
  symlinkSync(join(f.repo, 'p/linked'), join(f.target, 'linked'));
  symlinkSync(join(f.repo, 'p/dir'), join(f.target, 'dir'));
  f.put(join(f.target, 'parent'));
  const s = inspect(f);
  for (const state of Object.keys(s.counts)) assert.equal(s.counts[state], 1, state);
  assert.equal(verify(s), false);
  const p = spawnSync(process.execPath, [cli, 'verify', '--repo', f.repo, '--target', f.target]);
  assert.equal(p.status, 1);
});
test('rejects invalid manifests, empty and protected-only packages', t => {
  const f = fixture(t, ['p']);
  for (const value of [[], {}, ['../escape'], ['/absolute'], ['-flag'], ['p', 'p'], ['scripts'], ['.']]) {
    f.put(join(f.repo, 'packages.json'), JSON.stringify(value));
    assert.throws(() => inspect(f));
  }
  f.put(join(f.repo, 'packages.json'), '["p"]');
  assert.throws(() => inspect(f), /real directory/);
  mkdirSync(join(f.repo, 'p'));
  assert.throws(() => inspect(f), /no eligible/);
  f.put(join(f.repo, 'p/.codex/auth.json'));
  assert.throws(() => inspect(f), /no eligible/);
});
test('rejects source symlinks and special files without traversing them', t => {
  const f = fixture(t, ['p']);
  f.put(join(f.root, 'outside/file'));
  symlinkSync(join(f.root, 'outside'), join(f.repo, 'p'));
  assert.throws(() => inspect(f), /real directory/);
  unlinkSync(join(f.repo, 'p')); mkdirSync(join(f.repo, 'p'));
  symlinkSync(join(f.root, 'outside'), join(f.repo, 'p/folder'));
  assert.throws(() => inspect(f), /Source symlinks/);
  unlinkSync(join(f.repo, 'p/folder'));
  symlinkSync(join(f.root, 'outside/file'), join(f.repo, 'p/file'));
  assert.throws(() => inspect(f), /Source symlinks/);
  unlinkSync(join(f.repo, 'p/file'));
  execFileSync('mkfifo', [join(f.repo, 'p/pipe')]);
  assert.throws(() => inspect(f), /Special source/);
});
test('rejects collisions against unselected packages, including ancestor files', t => {
  const f = fixture(t, ['a', 'b']);
  f.put(join(f.repo, 'a/.config/tool'));
  f.put(join(f.repo, 'b/.config/tool/settings'));
  assert.throws(() => inspect({ ...f, packages: ['a'] }), /Ancestor destination/);
  rmSync(join(f.repo, 'b/.config/tool'), { recursive: true });
  f.put(join(f.repo, 'b/.config/tool'));
  assert.throws(() => inspect(f), /Overlapping/);
});
test('rejects destination entering source and targets at/inside source', t => {
  const f = fixture(t, ['p'], true);
  f.put(join(f.repo, 'p/localrepo/dotfiles/file'));
  assert.throws(() => inspect(f), /overlaps checkout/);
  assert.throws(() => inspect({ ...f, target: f.repo }), /inside the checkout/);
  assert.throws(() => inspect({ ...f, target: join(f.repo, 'p') }), /inside the checkout/);
});
test('protected paths and custom policy files remain explicit review requirements', t => {
  const f = fixture(t, ['p']);
  f.put(join(f.repo, 'p/.zshrc'));
  for (const p of ['.zshrc.local', '.config/gh/hosts.yml', '.codex/config.toml', '.claude/CLAUDE.md', '.env', '.ssh/key']) f.put(join(f.repo, 'p', p));
  f.put(join(f.repo, 'p/.stow-local-ignore'), '^.zshrc$');
  f.put(join(f.target, '.stowrc'), '--adopt');
  f.put(join(f.target, '.stow-global-ignore'));
  const s = inspect(f);
  assert.equal(s.files.length, 1); assert.equal(s.files[0].path, '.zshrc');
  assert.equal(s.excluded.length, 6); assert.equal(s.policyFiles.length, 3);
  assert.equal(s.linkPolicy, 'review-required');
  assert.match(render(s), /does not model Stow ignore rules/);
  assert.match(render(s), /stow-local-ignore/);
});
test('snapshot validation catches corrupted counts, traversal, empty rows and forged states', t => {
  const f = fixture(t, ['p']); f.put(join(f.repo, 'p/file'));
  const s = inspect(f);
  for (const mutate of [s => s.counts.linked++, s => s.files[0].path = '../escape', s => s.files = [], s => s.files[0].state = 'safe', s => s.packages.push('empty'), s => s.files[0].contents = 'private', s => s.repo = '/private/home']) {
    const broken = structuredClone(s); mutate(broken); assert.throws(() => validateSnapshot(broken));
  }
});
test('CLI rejects unknown, missing and duplicate options; report works offline', t => {
  const f = fixture(t, ['p']); f.put(join(f.repo, 'p/file'));
  for (const args of [['apply'], ['inspect'], ['report'], ['inspect', '--oops'], ['inspect', '--repo', f.repo, '--repo', f.repo]]) {
    assert.equal(spawnSync(process.execPath, [cli, ...args]).status, 1);
  }
  const s = inspect(f), input = join(f.root, 'snapshot.json'); f.put(input, JSON.stringify(s));
  assert.equal(execFileSync(process.execPath, [cli, 'report', '--input', input], { encoding: 'utf8' }), render(s));
  assert.throws(() => inspect({ ...f, packages: ['unknown'] }), /Unknown package/);
  assert.throws(() => inspect({ ...f, packages: ['p', 'p'] }), /duplicate/);
});
