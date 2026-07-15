import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  deriveVersionLabel,
  isFinalRelease,
  isSafeTagName,
  selectReleases,
  scanProject,
  scanAll,
} from '../lib/scan.mjs';
import { remoteUrlMatches } from '../lib/core.mjs';

// ─── fixture helper: throwaway git repos ──────────────────────────────────────

function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function makeRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'devlog-scan-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  spawnSync('git', ['init', '-b', 'main', dir], { encoding: 'utf8' });
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'tag.gpgsign', 'false');
  return dir;
}

function commit(dir, file, message) {
  const path = join(dir, file);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${message}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

// Simulate a published GitHub remote without any network: point origin at a
// github-style URL and mark the current HEAD as origin/<branch>.
function fakePublish(dir, ownerRepo, branch = 'main') {
  git(dir, 'remote', 'add', 'origin', `git@github.com:${ownerRepo}.git`);
  git(dir, 'update-ref', `refs/remotes/origin/${branch}`, 'HEAD');
}

const project = (dir, extra = {}) => ({ key: 'proj', path: dir, remote: 'me/proj', ...extra });

// ─── pure helpers ─────────────────────────────────────────────────────────────

test('deriveVersionLabel finds the first v-followed-by-digit', () => {
  assert.equal(deriveVersionLabel('v1.4.0'), 'v1.4.0');
  assert.equal(deriveVersionLabel('devlog-v0.2.0'), 'v0.2.0');
  assert.equal(deriveVersionLabel('version-bump'), null); // no v<digit> sequence
  assert.equal(deriveVersionLabel('vendor-import'), null);
  assert.equal(deriveVersionLabel('rel-v2'), 'v2');
});

test('isFinalRelease accepts only v + digits/dots', () => {
  assert.equal(isFinalRelease('v1.0.0'), true);
  assert.equal(isFinalRelease('v2'), true);
  assert.equal(isFinalRelease('v1.0.0-rc.1'), false);
  assert.equal(isFinalRelease('v1.0.0+build'), false);
  assert.equal(isFinalRelease('v1.0.'), false);
  assert.equal(isFinalRelease('1.0.0'), false);
});

test('isSafeTagName rejects shell-quote-break chars and leading dash', () => {
  assert.equal(isSafeTagName('v1.0.0'), true);
  assert.equal(isSafeTagName('devlog-v1.0.0'), true);
  assert.equal(isSafeTagName("v1.0.0';x"), false);
  assert.equal(isSafeTagName('v1.0.0$(x)'), false);
  assert.equal(isSafeTagName('-v1.0.0'), false);
  assert.equal(isSafeTagName(''), false);
});

test('selectReleases partitions and preserves descending order', () => {
  const { releases, skipped } = selectReleases([
    'v0.3.0', 'version-bump', 'v1.0.0-rc.1', "v0.2.5';x", 'v0.2.0+build', 'v0.2.0',
  ]);
  assert.deepEqual(releases, [
    { tag: 'v0.3.0', version: 'v0.3.0' },
    { tag: 'v0.2.0', version: 'v0.2.0' },
  ]);
  assert.deepEqual(skipped.map((s) => s.reason), ['non-release', 'prerelease', 'unsafe-name', 'build-metadata']);
});

test('remoteUrlMatches handles https, ssh, and case', () => {
  assert.equal(remoteUrlMatches('https://github.com/me/proj.git', 'me/proj'), true);
  assert.equal(remoteUrlMatches('git@github.com:me/proj.git', 'me/proj'), true);
  assert.equal(remoteUrlMatches('ssh://git@github.com/me/proj', 'ME/Proj'), true);
  assert.equal(remoteUrlMatches('git@github.com:me/other.git', 'me/proj'), false);
  assert.equal(remoteUrlMatches(null, 'me/proj'), false);
});

// ─── scanProject against real repos ───────────────────────────────────────────

test('scanProject finds releases newest-first with prevTag links and commits', (t) => {
  const dir = makeRepo(t);
  commit(dir, 'a.txt', 'feat: first');
  git(dir, 'tag', 'v0.1.0');
  commit(dir, 'b.txt', 'feat: second');
  commit(dir, 'c.txt', 'fix: second follow-up');
  git(dir, 'tag', 'v0.2.0');

  const out = scanProject(project(dir), { fetch: false });
  assert.equal(out.error, null);
  assert.equal(out.tagFetch, 'skipped');
  assert.equal(out.newReleases.length, 2);

  const [r2, r1] = out.newReleases;
  assert.equal(r2.version, 'v0.2.0');
  assert.equal(r2.prevTag, 'v0.1.0');
  assert.deepEqual(r2.commits.map((c) => c.subject), ['fix: second follow-up', 'feat: second']);
  assert.match(r2.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(r2.diffstat.includes('b.txt'));

  assert.equal(r1.version, 'v0.1.0');
  assert.equal(r1.prevTag, null); // earliest release: everything reachable
  assert.deepEqual(r1.commits.map((c) => c.subject), ['feat: first']);
  assert.equal(r1.diffstat, undefined); // no range base → no diffstat
});

test('scanProject skips existing entries but still uses them as range base', (t) => {
  const dir = makeRepo(t);
  commit(dir, 'a.txt', 'feat: first');
  git(dir, 'tag', 'v0.1.0');
  commit(dir, 'b.txt', 'feat: second');
  git(dir, 'tag', 'v0.2.0');

  const out = scanProject(project(dir), { fetch: false, existingFiles: new Set(['v0.1.0.md']) });
  assert.equal(out.newReleases.length, 1);
  assert.equal(out.newReleases[0].version, 'v0.2.0');
  // v0.1.0 is skipped as an entry but MUST remain the range base.
  assert.equal(out.newReleases[0].prevTag, 'v0.1.0');
  assert.deepEqual(out.newReleases[0].commits.map((c) => c.subject), ['feat: second']);
  assert.ok(out.skippedTags.some((s) => s.tag === 'v0.1.0' && s.reason === 'entry-exists'));
});

test('scanProject: prevTag skips prerelease and non-release tags', (t) => {
  const dir = makeRepo(t);
  commit(dir, 'a.txt', 'feat: first');
  git(dir, 'tag', 'v0.2.0');
  commit(dir, 'b.txt', 'chore: bump');
  git(dir, 'tag', 'version-bump'); // matched by prefix 'v', not a release
  commit(dir, 'c.txt', 'feat: rc work');
  git(dir, 'tag', 'v0.3.0-rc.1');
  commit(dir, 'd.txt', 'feat: final');
  git(dir, 'tag', 'v0.3.0');

  const out = scanProject(project(dir), { fetch: false, existingFiles: new Set(['v0.2.0.md']) });
  const rel = out.newReleases.find((r) => r.version === 'v0.3.0');
  assert.equal(rel.prevTag, 'v0.2.0'); // NOT version-bump or the rc
  // Range spans back to v0.2.0, so the rc-era commits are included.
  assert.deepEqual(rel.commits.map((c) => c.subject), ['feat: final', 'feat: rc work', 'chore: bump']);
  assert.ok(out.skippedTags.some((s) => s.tag === 'v0.3.0-rc.1' && s.reason === 'prerelease'));
  assert.ok(out.skippedTags.some((s) => s.tag === 'version-bump' && s.reason === 'non-release'));
});

test('scanProject respects tagPrefix in a monorepo', (t) => {
  const dir = makeRepo(t);
  commit(dir, 'a.txt', 'feat: proj work');
  git(dir, 'tag', 'proj-v1.0.0');
  git(dir, 'tag', 'other-v9.9.9');

  const out = scanProject(project(dir, { tagPrefix: 'proj-v' }), { fetch: false });
  assert.equal(out.newReleases.length, 1);
  assert.equal(out.newReleases[0].tag, 'proj-v1.0.0');
  assert.equal(out.newReleases[0].version, 'v1.0.0');
});

test('scanProject scopes commits by pathFilter and skips empty ranges', (t) => {
  const dir = makeRepo(t);
  commit(dir, 'skills/proj/a.txt', 'feat: in scope');
  git(dir, 'tag', 'v0.1.0');
  commit(dir, 'skills/other/b.txt', 'feat: out of scope');
  git(dir, 'tag', 'v0.2.0');

  const out = scanProject(project(dir, { pathFilter: 'skills/proj' }), { fetch: false });
  assert.equal(out.newReleases.length, 1);
  assert.equal(out.newReleases[0].version, 'v0.1.0');
  assert.ok(out.skippedTags.some((s) => s.tag === 'v0.2.0' && s.reason === 'empty-range'));
});

test('scanProject skips unsafe tag names outright', (t) => {
  const dir = makeRepo(t);
  commit(dir, 'a.txt', 'feat: first');
  git(dir, 'tag', "v8.8.8';x"); // legal git tag name, hostile shell content
  git(dir, 'tag', 'v0.1.0');

  const out = scanProject(project(dir), { fetch: false });
  assert.equal(out.newReleases.length, 1);
  assert.equal(out.newReleases[0].version, 'v0.1.0');
  assert.ok(out.skippedTags.some((s) => s.tag === "v8.8.8';x" && s.reason === 'unsafe-name'));
});

test('scanProject marks commits public only when origin matches and branch contains them', (t) => {
  const dir = makeRepo(t);
  commit(dir, 'a.txt', 'feat: published');
  git(dir, 'tag', 'v0.1.0');
  fakePublish(dir, 'me/proj'); // origin/main now points at HEAD
  commit(dir, 'b.txt', 'feat: local only'); // after the published ref
  git(dir, 'tag', 'v0.2.0');

  const out = scanProject(project(dir), { fetch: false });
  const byVersion = Object.fromEntries(out.newReleases.map((r) => [r.version, r]));
  assert.deepEqual(byVersion['v0.1.0'].commits.map((c) => c.public), [true]);
  assert.deepEqual(byVersion['v0.2.0'].commits.map((c) => c.public), [false]);
});

test('scanProject marks nothing public when origin is a different repo', (t) => {
  const dir = makeRepo(t);
  commit(dir, 'a.txt', 'feat: work');
  git(dir, 'tag', 'v0.1.0');
  fakePublish(dir, 'someone-else/fork');

  const out = scanProject(project(dir), { fetch: false });
  assert.deepEqual(out.newReleases[0].commits.map((c) => c.public), [false]);
});

test('scanProject marks nothing public for a private project even when remote and branch match', (t) => {
  const dir = makeRepo(t);
  commit(dir, 'a.txt', 'feat: private work');
  git(dir, 'tag', 'v0.1.0');
  fakePublish(dir, 'me/proj'); // origin/main matches project.remote and contains the tag

  const out = scanProject(project(dir, { private: true }), { fetch: false });
  assert.equal(out.private, true);
  assert.deepEqual(out.newReleases[0].commits.map((c) => c.public), [false]);
});

test('scanProject reports a missing path as an error', () => {
  const out = scanProject(project('/nonexistent/path/xyz'), { fetch: false });
  assert.equal(out.error, 'path-missing');
  assert.deepEqual(out.newReleases, []);
});

// ─── scanAll ──────────────────────────────────────────────────────────────────

function baseConfig(dir) {
  return {
    targetRepo: 'me/daily-dev-log',
    branch: 'main',
    gitAuthor: 'Test',
    githubUser: 'me',
    projects: [project(dir)],
  };
}

test('scanAll aggregates projects with injected existence lookup', (t) => {
  const dir = makeRepo(t);
  commit(dir, 'a.txt', 'feat: first');
  git(dir, 'tag', 'v0.1.0');

  const calls = [];
  const out = scanAll(baseConfig(dir), {
    fetch: false,
    getExisting: (repo, branch, key) => {
      calls.push([repo, branch, key]);
      return { files: new Set(), status: 'ok' };
    },
  });

  assert.deepEqual(calls, [['me/daily-dev-log', 'main', 'proj']]); // ONE lookup per project
  assert.equal(out.totalNewReleases, 1);
  assert.equal(out.projects[0].existenceCheck, 'ok');
  assert.equal(out.deepDive.minSources, 3); // shipped default
  assert.deepEqual(out.deepDive.topicDomains, ['AI', 'DevOps/SRE', 'software engineering']);
});

test('scanAll surfaces a failed existence check without dropping the project', (t) => {
  const dir = makeRepo(t);
  commit(dir, 'a.txt', 'feat: first');
  git(dir, 'tag', 'v0.1.0');

  const out = scanAll(baseConfig(dir), {
    fetch: false,
    getExisting: () => ({ files: new Set(), status: 'failed' }),
  });
  assert.equal(out.projects[0].existenceCheck, 'failed');
  assert.equal(out.totalNewReleases, 1); // still planned; publish-entry is the backstop
});

test('scanAll rejects an unknown project key with available keys', (t) => {
  const dir = makeRepo(t);
  const out = scanAll(baseConfig(dir), { projectKey: 'nope', fetch: false, getExisting: () => ({ files: new Set(), status: 'ok' }) });
  assert.match(out.error, /unknown-project/);
  assert.deepEqual(out.availableKeys, ['proj']);
});

test('scanAll honors config deepDive overrides', (t) => {
  const dir = makeRepo(t);
  const config = { ...baseConfig(dir), deepDive: { minSources: 5, topicDomains: ['security'] } };
  const out = scanAll(config, { fetch: false, getExisting: () => ({ files: new Set(), status: 'ok' }) });
  assert.equal(out.deepDive.minSources, 5);
  assert.deepEqual(out.deepDive.topicDomains, ['security']);
});
