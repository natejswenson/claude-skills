import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  validateConfig,
  expandHome,
  VALIDATORS,
} from '../bin/devlog.js';

// A fully valid baseline config. Tests clone + mutate this to isolate one failure
// at a time. Helper `cfg()` returns a deep-ish copy so mutations don't leak.
function baseConfig() {
  return {
    targetRepo: 'natejswenson/daily-dev-log',
    branch: 'main',
    gitAuthor: 'Nate Swenson',
    githubUser: 'natejswenson',
    voicePath: '/Users/natejswenson/.claude/ghostwriter/voice',
    projects: [
      {
        key: 'devlog',
        path: '/Users/natejswenson/localrepo/claude-skills',
        remote: 'natejswenson/claude-skills',
        label: 'Devlog',
        pathFilter: 'skills/devlog',
        tagPrefix: 'devlog-v',
      },
      {
        key: 'plain',
        path: '/Users/natejswenson/localrepo/other',
        remote: 'natejswenson/other',
      },
    ],
  };
}

function cfg(mutate) {
  const c = baseConfig();
  c.projects = c.projects.map((p) => ({ ...p }));
  if (mutate) mutate(c);
  return c;
}

// ─── validateConfig: ACCEPT paths ─────────────────────────────────────────────

test('validateConfig accepts a fully valid config (with voicePath, pathFilter, tagPrefix)', () => {
  const c = baseConfig();
  assert.equal(validateConfig(c), c);
});

test('validateConfig accepts config without optional voicePath', () => {
  assert.doesNotThrow(() => validateConfig(cfg((c) => { delete c.voicePath; })));
});

test('validateConfig accepts config without optional branch', () => {
  assert.doesNotThrow(() => validateConfig(cfg((c) => { delete c.branch; })));
});

test('validateConfig accepts empty projects array', () => {
  assert.doesNotThrow(() => validateConfig(cfg((c) => { c.projects = []; })));
});

test('validateConfig accepts voicePath with leading ~ (expanded before checks)', () => {
  assert.doesNotThrow(() => validateConfig(cfg((c) => { c.voicePath = '~/.claude/ghostwriter/voice'; })));
});

test('validateConfig accepts voicePath of exactly "~"', () => {
  assert.doesNotThrow(() => validateConfig(cfg((c) => { c.voicePath = '~'; })));
});

// ─── validateConfig: REJECT — top-level shape ─────────────────────────────────

test('validateConfig rejects non-object config', () => {
  assert.throws(() => validateConfig(null));
  assert.throws(() => validateConfig(undefined));
  assert.throws(() => validateConfig('string'));
  assert.throws(() => validateConfig(42));
});

test('validateConfig rejects missing each required field', () => {
  for (const field of ['targetRepo', 'gitAuthor', 'githubUser', 'projects']) {
    assert.throws(
      () => validateConfig(cfg((c) => { delete c[field]; })),
      new RegExp(`Missing required field: ${field}`),
      `expected throw for missing ${field}`,
    );
  }
});

// ─── validateConfig: REJECT — targetRepo ──────────────────────────────────────

test('validateConfig rejects malformed targetRepo', () => {
  assert.throws(() => validateConfig(cfg((c) => { c.targetRepo = 'no-slash'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.targetRepo = '/leading'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.targetRepo = 'owner/repo/extra'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.targetRepo = '-bad/repo'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.targetRepo = 'owner/re po'; })));
});

// ─── validateConfig: REJECT — gitAuthor shell injection ───────────────────────

test('validateConfig rejects gitAuthor with shell metacharacters', () => {
  assert.throws(() => validateConfig(cfg((c) => { c.gitAuthor = 'Nate; rm -rf /'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.gitAuthor = 'Nate `whoami`'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.gitAuthor = 'Nate $(touch x)'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.gitAuthor = "Nate 'quote"; })));
  assert.throws(() => validateConfig(cfg((c) => { c.gitAuthor = 'Nate | cat'; })));
});

test('validateConfig rejects empty/non-string gitAuthor', () => {
  assert.throws(() => validateConfig(cfg((c) => { c.gitAuthor = ''; })));
  assert.throws(() => validateConfig(cfg((c) => { c.gitAuthor = 123; })));
});

// ─── validateConfig: REJECT — githubUser ──────────────────────────────────────

test('validateConfig rejects bad githubUser', () => {
  assert.throws(() => validateConfig(cfg((c) => { c.githubUser = '-bad'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.githubUser = 'has space'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.githubUser = 'has/slash'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.githubUser = 'user$()'; })));
});

// ─── validateConfig: REJECT — branch ──────────────────────────────────────────

test('validateConfig rejects bad branch (leading dash, .., metacharacters)', () => {
  assert.throws(() => validateConfig(cfg((c) => { c.branch = '-bad'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.branch = 'foo/../bar'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.branch = 'foo;bar'; })));
});

// ─── validateConfig: REJECT — projects array & entries ────────────────────────

test('validateConfig rejects non-array projects', () => {
  assert.throws(() => validateConfig(cfg((c) => { c.projects = 'nope'; })), /projects must be an array/);
  assert.throws(() => validateConfig(cfg((c) => { c.projects = {}; })), /projects must be an array/);
});

test('validateConfig rejects non-object project entry', () => {
  assert.throws(() => validateConfig(cfg((c) => { c.projects = [null]; })));
  assert.throws(() => validateConfig(cfg((c) => { c.projects = ['str']; })));
});

test('validateConfig rejects duplicate project keys', () => {
  assert.throws(
    () => validateConfig(cfg((c) => {
      c.projects[1].key = 'devlog';
    })),
    /Duplicate project key/,
  );
});

test('validateConfig rejects project missing key/path/remote', () => {
  assert.throws(() => validateConfig(cfg((c) => { delete c.projects[0].key; })));
  assert.throws(() => validateConfig(cfg((c) => { delete c.projects[0].path; })));
  assert.throws(() => validateConfig(cfg((c) => { delete c.projects[0].remote; })));
});

test('validateConfig rejects project key containing ..', () => {
  assert.throws(() => validateConfig(cfg((c) => { c.projects[0].key = 'a..b'; })));
});

test('validateConfig rejects project key with leading dash or metacharacters', () => {
  assert.throws(() => validateConfig(cfg((c) => { c.projects[0].key = '-bad'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.projects[0].key = 'has space'; })));
});

test('validateConfig rejects project path with shell metacharacters', () => {
  assert.throws(() => validateConfig(cfg((c) => { c.projects[0].path = '/tmp/$(touch x)'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.projects[0].path = '/tmp/`whoami`'; })));
});

test('validateConfig rejects bad project remote', () => {
  assert.throws(() => validateConfig(cfg((c) => { c.projects[0].remote = 'no-slash'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.projects[0].remote = '-bad/repo'; })));
});

// ─── validateConfig: REJECT — pathFilter ──────────────────────────────────────

test('validateConfig rejects pathFilter with .. or leading dash or metacharacters', () => {
  assert.throws(() => validateConfig(cfg((c) => { c.projects[0].pathFilter = '../escape'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.projects[0].pathFilter = 'a/../b'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.projects[0].pathFilter = '-rf'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.projects[0].pathFilter = 'foo;bar'; })));
});

// ─── validateConfig: REJECT — tagPrefix injection (hardened path) ─────────────

test('validateConfig rejects tagPrefix injection', () => {
  assert.throws(() => validateConfig(cfg((c) => { c.projects[0].tagPrefix = "v'; rm -rf /"; })));
  assert.throws(() => validateConfig(cfg((c) => { c.projects[0].tagPrefix = 'v`whoami`'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.projects[0].tagPrefix = '-v'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.projects[0].tagPrefix = 'v$()'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.projects[0].tagPrefix = 'a/../b'; })));
});

// ─── validateConfig: REJECT — voicePath injection (hardened path) ─────────────

test('validateConfig rejects voicePath with shell metacharacters', () => {
  assert.throws(() => validateConfig(cfg((c) => { c.voicePath = '/tmp/$(touch x)'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.voicePath = '/tmp/`whoami`'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.voicePath = '/tmp/a;b'; })));
});

test('validateConfig rejects voicePath with leading dash', () => {
  assert.throws(() => validateConfig(cfg((c) => { c.voicePath = '-rf'; })));
  assert.throws(() => validateConfig(cfg((c) => { c.voicePath = '   -leading'; })));
});

test('validateConfig rejects non-string voicePath', () => {
  assert.throws(() => validateConfig(cfg((c) => { c.voicePath = 42; })));
});

// ─── expandHome ───────────────────────────────────────────────────────────────

test('expandHome expands "~" to home dir', () => {
  assert.equal(expandHome('~'), homedir());
});

test('expandHome expands "~/foo" to home/foo', () => {
  assert.equal(expandHome('~/foo'), join(homedir(), 'foo'));
  assert.equal(expandHome('~/foo/bar'), join(homedir(), 'foo/bar'));
});

test('expandHome leaves absolute path unchanged', () => {
  assert.equal(expandHome('/abs/path'), '/abs/path');
});

test('expandHome does not expand a "~" that is not a home prefix', () => {
  // "~foo" (no slash) is NOT a home reference and must be left as-is.
  assert.equal(expandHome('~foo'), '~foo');
});

test('expandHome handles empty / undefined / null', () => {
  assert.equal(expandHome(''), '');
  assert.equal(expandHome(undefined), undefined);
  assert.equal(expandHome(null), null);
});

// ─── VALIDATORS direct checks ─────────────────────────────────────────────────

test('VALIDATORS.gitAuthor returns true on valid, string on invalid', () => {
  assert.equal(VALIDATORS.gitAuthor('Nate Swenson'), true);
  assert.equal(typeof VALIDATORS.gitAuthor(''), 'string');
  assert.equal(typeof VALIDATORS.gitAuthor('Nate; rm -rf /'), 'string');
  assert.equal(typeof VALIDATORS.gitAuthor('Nate `x`'), 'string');
});

test('VALIDATORS.tagPrefix returns true on valid, string on invalid', () => {
  assert.equal(VALIDATORS.tagPrefix('v'), true);
  assert.equal(VALIDATORS.tagPrefix('devlog-v'), true);
  assert.equal(VALIDATORS.tagPrefix(''), true); // blank = default
  assert.equal(typeof VALIDATORS.tagPrefix('-v'), 'string');
  assert.equal(typeof VALIDATORS.tagPrefix("v'; rm -rf /"), 'string');
  assert.equal(typeof VALIDATORS.tagPrefix('a/../b'), 'string');
});

test('VALIDATORS.voicePath returns true on blank, string on injection/leading dash', () => {
  assert.equal(VALIDATORS.voicePath(''), true);
  assert.equal(VALIDATORS.voicePath('   '), true);
  assert.equal(typeof VALIDATORS.voicePath('/tmp/$(touch x)'), 'string');
  assert.equal(typeof VALIDATORS.voicePath('-rf'), 'string');
});

test('VALIDATORS.githubUser / ownerRepo / projectKey behave correctly', () => {
  assert.equal(VALIDATORS.githubUser('natejswenson'), true);
  assert.equal(typeof VALIDATORS.githubUser('-bad'), 'string');

  assert.equal(VALIDATORS.ownerRepo('owner/repo'), true);
  assert.equal(typeof VALIDATORS.ownerRepo('noslash'), 'string');

  assert.equal(VALIDATORS.projectKey('my-key'), true);
  assert.equal(typeof VALIDATORS.projectKey('a..b'), 'string');
  assert.equal(typeof VALIDATORS.projectKey('-bad'), 'string');
});
