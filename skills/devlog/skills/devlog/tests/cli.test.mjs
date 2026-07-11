// End-to-end tests of the CLI dispatch layer: spawn the real binary with HOME
// pointed at a temp dir so ~/.claude/skills/devlog/config.json resolves into
// the fixture. This is the layer unit tests miss — exactly the flags SKILL.md
// tells the agent to pass must parse and produce JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(SKILL_ROOT, 'bin', 'devlog.js');
const FIXTURES = join(SKILL_ROOT, 'evals', 'fixtures');

function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

// Build a fake HOME with a valid config pointing at a real one-tag repo.
function makeHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'devlog-cli-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));

  const repo = join(home, 'proj');
  spawnSync('git', ['init', '-b', 'main', repo], { encoding: 'utf8' });
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'tag.gpgsign', 'false');
  writeFileSync(join(repo, 'a.txt'), 'hello\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'feat: first');
  git(repo, 'tag', 'v0.1.0');

  const configDir = join(home, '.claude', 'skills', 'devlog');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    targetRepo: 'me/daily-dev-log',
    branch: 'main',
    gitAuthor: 'Test',
    githubUser: 'me',
    projects: [{ key: 'proj', path: repo, remote: 'me/proj' }],
  }));
  return { home, repo };
}

function run(home, ...args) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const parse = (out) => JSON.parse(out.stdout);

test('scan --json (as SKILL.md spells it) emits a valid JSON plan', (t) => {
  const { home } = makeHome(t);
  // --no-fetch: fixture repo has no remote; entry-existence check will report
  // "failed" (no gh auth against the fake repo) which must not break the plan.
  const out = run(home, 'scan', '--json', '--no-fetch');
  assert.equal(out.status, 0, out.stderr);
  const plan = parse(out);
  assert.equal(plan.totalNewReleases, 1);
  assert.equal(plan.projects[0].newReleases[0].version, 'v0.1.0');
  assert.equal(plan.deepDive.minSources, 3);
});

test('scan --project with an unknown key exits 1 with availableKeys', (t) => {
  const { home } = makeHome(t);
  const out = run(home, 'scan', '--json', '--no-fetch', '--project', 'nope');
  assert.equal(out.status, 1);
  assert.deepEqual(parse(out).availableKeys, ['proj']);
});

test('scan without a config exits 1 with config-missing JSON', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'devlog-cli-empty-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const out = run(home, 'scan', '--json');
  assert.equal(out.status, 1);
  assert.equal(parse(out).error, 'config-missing');
});

test('lint-post passes the good fixture and fails the bad one with findings', (t) => {
  const { home } = makeHome(t);
  // Drafts are named <version>.md; the fixture must be linted under its real name.
  const named = join(home, 'v1.3.0.md');
  writeFileSync(named, readFileSync(join(FIXTURES, 'good-post.md'), 'utf8'));
  const good = run(home, 'lint-post', named);
  assert.equal(good.status, 0, good.stdout);
  assert.equal(parse(good).ok, true);

  const bad = run(home, 'lint-post', join(FIXTURES, 'bad-post.md'));
  assert.equal(bad.status, 1);
  assert.ok(parse(bad).findings.length >= 3);

  const missing = run(home, 'lint-post', '/nonexistent.md');
  assert.equal(missing.status, 2);
});

test('config --json reports validity and resolved deepDive', (t) => {
  const { home } = makeHome(t);
  const out = run(home, 'config', '--json');
  assert.equal(out.status, 0);
  const cfg = parse(out);
  assert.equal(cfg.valid, true);
  assert.equal(cfg.deepDive.minSources, 3);
});

test('set / add-project --yes / remove-project --yes round-trip through the CLI', (t) => {
  const { home, repo } = makeHome(t);

  const set = run(home, 'set', 'deepDive.minSources', '4');
  assert.equal(set.status, 0, set.stdout);
  assert.equal(parse(set).config.deepDive.minSources, 4);

  const badSet = run(home, 'set', 'branch', '-bad');
  assert.equal(badSet.status, 1);

  // add-project auto-detects the key from the path basename; the fixture repo
  // has no origin, so --remote is required.
  const secondRepo = join(home, 'second');
  spawnSync('git', ['init', '-b', 'main', secondRepo], { encoding: 'utf8' });
  const add = run(home, 'add-project', '--yes', '--path', secondRepo, '--remote', 'me/second');
  assert.equal(add.status, 0, add.stdout);
  assert.deepEqual(parse(add).projects, ['proj', 'second']);

  const dupe = run(home, 'add-project', '--yes', '--path', repo, '--remote', 'me/proj', '--key', 'proj');
  assert.equal(dupe.status, 1);

  const rm = run(home, 'remove-project', 'second', '--yes');
  assert.equal(rm.status, 0, rm.stdout);
  assert.deepEqual(parse(rm).projects, ['proj']);

  const rmGhost = run(home, 'remove-project', 'ghost', '--yes');
  assert.equal(rmGhost.status, 1);
});

test('the CLI dispatches when invoked through a bin symlink (the npm/npx layout)', (t) => {
  // npm/npx expose the binary as node_modules/.bin/devlog → ../.../bin/devlog.js.
  // process.argv[1] is then the SYMLINK, not the resolved file — the isMain
  // guard must realpath both sides or every npx invocation is a silent no-op
  // (the bug that shipped in <=0.5.0).
  const dir = mkdtempSync(join(tmpdir(), 'devlog-symlink-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const link = join(dir, 'devlog');
  symlinkSync(BIN, link);

  const r = spawnSync(process.execPath, [link, '--version'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/, 'expected the version on stdout — silent exit means the isMain guard failed to match through the symlink');
});

test('publish-entry via CLI refuses a second publish of the same version', (t) => {
  const { home } = makeHome(t);
  const clone = join(home, 'clone');
  mkdirSync(clone);
  const draft = join(home, 'v9.9.9.md');
  writeFileSync(draft, '---\ntitle: "T"\ndate: 2026-07-11\nproject: proj\nversion: v9.9.9\ntags: [a, b]\nsummary: "S"\n---\n\n## Shipped\n\nx\n');

  const first = run(home, 'publish-entry', '--clone', clone, '--project', 'proj', '--version', 'v9.9.9', '--entry', draft);
  assert.equal(first.status, 0, first.stdout);
  assert.equal(parse(first).ok, true);

  const second = run(home, 'publish-entry', '--clone', clone, '--project', 'proj', '--version', 'v9.9.9', '--entry', draft);
  assert.equal(second.status, 1);
  assert.match(parse(second).message, /immutable/);
});
