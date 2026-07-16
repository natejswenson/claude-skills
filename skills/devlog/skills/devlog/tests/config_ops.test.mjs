import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addProject, removeProject, setField, SETTABLE_FIELDS } from '../lib/config_ops.mjs';
import { resolveDeepDive, validateConfig } from '../lib/core.mjs';

function baseConfig() {
  return {
    targetRepo: 'me/daily-dev-log',
    branch: 'main',
    gitAuthor: 'Test User',
    githubUser: 'me',
    projects: [
      { key: 'existing', path: '/tmp', remote: 'me/existing' },
    ],
  };
}

// ─── addProject ───────────────────────────────────────────────────────────────

test('addProject appends a validated project and returns a new config', () => {
  const config = baseConfig();
  const next = addProject(config, { key: 'proj', path: '/tmp', remote: 'me/proj', label: 'Proj', tagPrefix: 'proj-v', pathFilter: 'skills/proj' });
  assert.equal(config.projects.length, 1); // original untouched
  assert.deepEqual(next.projects.at(-1), {
    key: 'proj', path: '/tmp', remote: 'me/proj', label: 'Proj', tagPrefix: 'proj-v', pathFilter: 'skills/proj',
  });
});

test('addProject expands ~ in the path and drops the default tagPrefix', () => {
  const next = addProject(baseConfig(), { key: 'proj', path: '~/code', remote: 'me/proj', tagPrefix: 'v' });
  assert.ok(!next.projects.at(-1).path.startsWith('~'));
  assert.equal('tagPrefix' in next.projects.at(-1), false);
  assert.equal('label' in next.projects.at(-1), false);
});

test('addProject rejects duplicate keys and invalid fields', () => {
  assert.throws(() => addProject(baseConfig(), { key: 'existing', path: '/tmp', remote: 'me/x' }), /already registered/);
  assert.throws(() => addProject(baseConfig(), { key: 'proj', path: '/tmp', remote: 'not-owner-repo' }), /remote/);
  assert.throws(() => addProject(baseConfig(), { key: 'proj', path: '/tmp/$(x)', remote: 'me/proj' }), /path/);
});

// ─── private projects ─────────────────────────────────────────────────────────

test('addProject allows a private project with no remote at all', () => {
  const next = addProject(baseConfig(), { key: 'personal', path: '/tmp', private: true });
  const p = next.projects.at(-1);
  assert.equal(p.private, true);
  assert.equal('remote' in p, false);
});

test('addProject still validates remote shape for a private project that supplies one', () => {
  assert.throws(
    () => addProject(baseConfig(), { key: 'personal', path: '/tmp', private: true, remote: 'not-owner-repo' }),
    /remote/,
  );
  const next = addProject(baseConfig(), { key: 'personal', path: '/tmp', private: true, remote: 'me/personal' });
  assert.equal(next.projects.at(-1).remote, 'me/personal');
});

test('validateConfig rejects a non-boolean private field (e.g. a hand-edited config.json)', () => {
  const config = { ...baseConfig(), projects: [{ key: 'personal', path: '/tmp', private: 'yes' }] };
  assert.throws(() => validateConfig(config), /project.private must be a boolean/);
});

test('a non-private project still requires a valid remote', () => {
  assert.throws(() => addProject(baseConfig(), { key: 'proj', path: '/tmp' }), /remote/);
});

// ─── removeProject ────────────────────────────────────────────────────────────

test('removeProject removes by key and rejects unknown keys', () => {
  const next = removeProject(baseConfig(), 'existing');
  assert.deepEqual(next.projects, []);
  assert.throws(() => removeProject(baseConfig(), 'ghost'), /No project with key "ghost".*existing/);
});

// ─── setField ─────────────────────────────────────────────────────────────────

test('setField updates each settable scalar through validation', () => {
  let c = baseConfig();
  c = setField(c, 'targetRepo', 'me/other-log');
  c = setField(c, 'branch', 'trunk');
  c = setField(c, 'gitAuthor', 'New Name');
  c = setField(c, 'githubUser', 'newuser');
  c = setField(c, 'voicePath', '/tmp');
  assert.equal(c.targetRepo, 'me/other-log');
  assert.equal(c.branch, 'trunk');
  assert.equal(c.gitAuthor, 'New Name');
  assert.equal(c.githubUser, 'newuser');
  assert.equal(c.voicePath, '/tmp');
});

test('setField voicePath with empty string clears the field', () => {
  const withVoice = { ...baseConfig(), voicePath: '/tmp' };
  const next = setField(withVoice, 'voicePath', '');
  assert.equal('voicePath' in next, false);
});

test('setField handles deepDive.minSources with integer validation', () => {
  const next = setField(baseConfig(), 'deepDive.minSources', '5');
  assert.equal(next.deepDive.minSources, 5);
  assert.throws(() => setField(baseConfig(), 'deepDive.minSources', 'lots'), /minSources/);
  assert.throws(() => setField(baseConfig(), 'deepDive.minSources', '0'), /minSources/);
  assert.throws(() => setField(baseConfig(), 'deepDive.minSources', '2.5'), /minSources/);
});

test('setField parses deepDive.topicDomains as a comma list', () => {
  const next = setField(baseConfig(), 'deepDive.topicDomains', 'security, platform engineering');
  assert.deepEqual(next.deepDive.topicDomains, ['security', 'platform engineering']);
  assert.throws(() => setField(baseConfig(), 'deepDive.topicDomains', ' , '), /topicDomains/);
});

test('setField preserves sibling deepDive values', () => {
  const withDD = { ...baseConfig(), deepDive: { topicDomains: ['security'] } };
  const next = setField(withDD, 'deepDive.minSources', '4');
  assert.deepEqual(next.deepDive, { topicDomains: ['security'], minSources: 4 });
});

test('setField rejects unknown fields and invalid values', () => {
  assert.throws(() => setField(baseConfig(), 'projects', '[]'), /Unknown field/);
  assert.throws(() => setField(baseConfig(), 'branch', '-bad'), /branch/);
  assert.throws(() => setField(baseConfig(), 'targetRepo', 'noslash'), /targetRepo/);
});

test('SETTABLE_FIELDS enumerates exactly the supported fields', () => {
  assert.deepEqual(SETTABLE_FIELDS.sort(), [
    'branch', 'deepDive.minSources', 'deepDive.topicDomains', 'gitAuthor', 'githubUser', 'targetRepo', 'voicePath',
  ].sort());
});

// ─── resolveDeepDive ──────────────────────────────────────────────────────────

test('resolveDeepDive applies defaults and overrides', () => {
  assert.deepEqual(resolveDeepDive({}), { topicDomains: ['AI', 'DevOps/SRE', 'software engineering'], minSources: 3 });
  assert.deepEqual(
    resolveDeepDive({ deepDive: { minSources: 2, topicDomains: ['x'] } }),
    { topicDomains: ['x'], minSources: 2 },
  );
});
