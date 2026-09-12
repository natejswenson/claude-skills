/** Installed-tarball smoke; no registry, credentials, host installation or model calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

test('offline packed install includes strict harness and starts both host profiles outside source', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-package-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const plugin = join(dir, 'plugin'); const skill = join(plugin, 'skills/issueflow');
  cpSync(source, skill, { recursive: true, filter: (p) => !p.split('/').includes('node_modules') });
  for (const name of ['README.md', 'CHANGELOG.md', 'LICENSE']) cpSync(resolve(source, '../..', name), join(plugin, name));
  const invoke = (cmd, args, cwd = dir) => {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 30000, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
    assert.equal(r.status, 0, `${cmd} ${args.join(' ')}\n${r.stderr}\n${r.stdout}`);
    return r.stdout;
  };
  // Explicitly run the real pre/post-pack scripts only in this throwaway copy.
  invoke('npm', ['pack', '--offline', '--cache', join(dir, 'cache'), '--pack-destination', dir], skill);
  const pkg = JSON.parse(readFileSync(join(skill, 'package.json')));
  const tarball = join(dir, `natjswenson-issueflow-${pkg.version}.tgz`);
  const installed = join(dir, 'installed'); mkdirSync(installed);
  invoke('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(dir, 'cache'), '--prefix', installed, tarball]);
  const loaded = join(installed, 'node_modules/@natjswenson/issueflow');
  for (const p of ['SKILL.md', 'references/harness.md', 'references/dispatch.md', 'scripts/lib/evolution.mjs', 'scripts/lib/remote-review.mjs', 'scripts/complete-worker.mjs']) assert.ok(existsSync(join(loaded, p)), p);
  const cli = join(loaded, 'scripts/issueflow.js');
  assert.match(invoke(process.execPath, [cli, '--help']), /migrate-run/);
  const repo = join(dir, 'repo'); mkdirSync(repo);
  invoke('git', ['init', '-qb', 'main'], repo); writeFileSync(join(repo, 'README.md'), '# package fixture\n');
  invoke('git', ['add', 'README.md'], repo);
  invoke('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base'], repo);
  const meta = join(dir, 'repo.json'); const issue = join(dir, 'issue.json');
  writeFileSync(meta, JSON.stringify({ owner: 'fixture', name: 'package', defaultBranch: 'main' }));
  writeFileSync(issue, JSON.stringify({ number: 1, title: 'Correct documentation', body: 'Documentation-only packaging fixture.', comments: [], labels: [] }));
  for (const host of ['claude', 'codex']) {
    const run = join(dir, host);
    invoke(process.execPath, [cli, 'start', '--repo', repo, '--repo-json', meta, '--issue-json', issue, '--issue', '1', '--runtime', host, '--run-dir', run]);
    const state = JSON.parse(readFileSync(join(run, 'run.json')));
    assert.equal(state.schema, 4); assert.equal(state.runtime, host); assert.equal(state.offline, true);
    assert.match(invoke(process.execPath, [cli, 'doctor', '--run-dir', run]), /controller receipts required/);
  }
});
