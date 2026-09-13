import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const readmeUrl = new URL('../../../README.md', import.meta.url);
const skillUrl = new URL('../SKILL.md', import.meta.url);
const identity = {
  key: 'issueflow', label: 'Issue Flow', remote: 'natejswenson/claude-skills',
  pathFilter: 'skills/issueflow', tagPrefix: 'issueflow-v',
};

function section(document, heading) {
  const start = document.indexOf(heading + '\n');
  assert.notEqual(start, -1, `missing section: ${heading}`);
  const level = heading.match(/^#+/)[0].length;
  const rest = document.slice(start + heading.length + 1);
  const next = new RegExp(`^#{1,${level}} `, 'm').exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

function assertGuide(document) {
  const guide = section(document, '## Producer and website onboarding');
  const examples = [...guide.matchAll(/\x60{3}json\n([\s\S]*?)\n\x60{3}/g)]
    .map((match) => JSON.parse(match[1]));
  const project = examples.find((example) => example.key === 'issueflow');
  assert.ok(project, 'guide needs a structured Issue Flow registration example');
  for (const [field, expected] of Object.entries(identity)) assert.equal(project[field], expected, field);
  assert.match(project.path, /^\//, 'example repository path must be absolute');
  assert.match(guide, /user's absolute monorepo checkout path/);
  assert.match(guide, /~\/\.claude\/skills\/devlog\/config\.json/);
  assert.match(guide, /\/devlog.*Claude Code/);
  assert.match(guide, /\$devlog.*Codex/);
  const website = section(guide, '### Register the website and its manifest together');
  for (const term of ['PROJECTS', 'src/data/site.js', 'content/devlog/issueflow/manifest.json']) {
    assert.ok(website.includes(term), `missing website obligation: ${term}`);
  }
  assert.match(website, /PROJECTS row and a valid manifest in the same change/);
  assert.match(website, /Preserve an\s+existing registry row and populated manifest; never replace published entries/);
  assert.ok(examples.some((example) => Array.isArray(example.entries) && example.entries.length === 0),
    'guide needs a parseable empty-manifest example');
  return guide;
}

function assertGuideLink(text) {
  const links = [...text.matchAll(/\[[^\]]+\]\(([^)]+#producer-and-website-onboarding)\)/g)];
  assert.ok(links.length > 0, 'workflow must link to paired onboarding guide');
  for (const [, href] of links) {
    const target = new URL(href, skillUrl);
    target.hash = '';
    assert.equal(target.href, readmeUrl.href);
    assertGuide(readFileSync(target, 'utf8'));
  }
}

test('onboarding guidance pairs concrete producer registration with website manifest setup', () => {
  assertGuide(readFileSync(readmeUrl, 'utf8'));
});

test('onboarding guidance configures idempotently and links both entry points to the guide', () => {
  const skill = readFileSync(skillUrl, 'utf8');
  const configure = section(skill, '## Configure mode');
  assert.match(configure, /inspect validated config first with \x60config --json\x60/);
  assert.match(configure, /Preserve a matching existing row unchanged and skip the\s+add/);
  assert.match(configure, /Run add-project only when the key is absent/);
  assert.match(configure, /Report a mismatch instead of\s+removing\/recreating/);
  for (const field of ['key', 'label', 'path', 'remote', 'pathFilter', 'tagPrefix']) {
    assert.ok(configure.includes(field));
  }
  assertGuideLink(configure);
  assertGuideLink(section(skill, '### Step 5b: Register a project the site has never rendered before'));
});

test('onboarding guidance assertions reject a missing manifest obligation and wrong release namespace', () => {
  const readme = readFileSync(readmeUrl, 'utf8');
  assertGuide(readme);
  const missingManifest = readme.replace('content/devlog/issueflow/manifest.json', 'content/devlog/issueflow/');
  assert.notEqual(missingManifest, readme);
  assert.throws(() => assertGuide(missingManifest), { code: 'ERR_ASSERTION' });
  const wrongPrefix = readme.replace('"tagPrefix": "issueflow-v"', '"tagPrefix": "devlog-v"');
  assert.notEqual(wrongPrefix, readme);
  assert.throws(() => assertGuide(wrongPrefix), { code: 'ERR_ASSERTION' });
});

// Runtime imports/fixtures stay inside these callbacks: the unchanged-base
// documentation regression runs using only Node built-ins and real documents.
test('issueflow registration survives repeated validated inspection and rejects direct duplicates', async () => {
  const { validateConfig } = await import('../lib/core.mjs');
  const { addProject } = await import('../lib/config_ops.mjs');
  const project = { ...identity, path: tmpdir() };
  const config = {
    targetRepo: 'example/devlog', branch: 'main', gitAuthor: 'Test', githubUser: 'example',
    projects: [project, { key: 'other', path: tmpdir(), remote: 'example/other' }],
  };
  const before = JSON.stringify(config);
  for (let attempt = 0; attempt < 2; attempt++) {
    const validated = validateConfig(config);
    const rows = validated.projects.filter((row) => row.key === project.key);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], project);
    assert.equal(JSON.stringify(config), before);
  }
  assert.throws(() => addProject(config, project), /already registered/);
  assert.equal(JSON.stringify(config), before);
});

test('issueflow scan combines tag namespace with commit and diff path isolation', async (t) => {
  const { scanProject } = await import('../lib/scan.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'issueflow-onboarding-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  function git(...args) {
    const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  function commit(file, message) {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, message + '\n');
    git('add', file);
    git('commit', '-m', message);
  }
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  commit('skills/issueflow/first.txt', 'feat: issueflow first');
  git('tag', 'issueflow-v0.1.0');
  commit('skills/devlog/other.txt', 'feat: unrelated devlog');
  git('tag', 'devlog-v9.9.9');
  git('tag', 'v8.0.0');
  commit('skills/issueflow/second.txt', 'fix: issueflow second');
  git('tag', 'issueflow-v0.2.0');
  commit('skills/devlog/last.txt', 'fix: unrelated last');
  git('tag', 'issueflow-v0.3.0');
  const scan = scanProject({ ...identity, path: dir }, { fetch: false });
  assert.equal(scan.error, null);
  assert.deepEqual(scan.newReleases.map((release) => release.tag), ['issueflow-v0.2.0', 'issueflow-v0.1.0']);
  const [second, first] = scan.newReleases;
  assert.equal(second.prevTag, 'issueflow-v0.1.0');
  assert.deepEqual(second.commits.map((commit) => commit.subject), ['fix: issueflow second']);
  assert.deepEqual(first.commits.map((commit) => commit.subject), ['feat: issueflow first']);
  assert.match(second.diffstat, /skills\/issueflow\/second\.txt/);
  assert.doesNotMatch(second.diffstat, /devlog|other\.txt|last\.txt/);
  assert.ok(scan.skippedTags.some((tag) => tag.tag === 'issueflow-v0.3.0' && tag.reason === 'empty-range'));
});
