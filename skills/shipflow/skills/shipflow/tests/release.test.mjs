// Unit tests for the component release engine (lib/release.mjs).
//
// Everything here is offline and deterministic. The prepare() tests drive a
// REAL git repository created in a temp dir — not a mock — because the thing
// most likely to break in prepare() is the git plumbing (worktree creation,
// explicit-pathspec staging, branching off the right base), and a mocked git
// proves none of it. No test here touches the network: the temp repos have no
// remote, which also exercises the "no origin/<branch>, fall back to the local
// branch" path that a repo mid-clone would hit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  validateComponentName,
  resolveLayout,
  listComponentNames,
  resolveComponent,
  parseSemver,
  cmpSemver,
  bumpSemver,
  readFrontmatterVersion,
  readVersionAt,
  parseCommitSubject,
  suggestBump,
  spliceChangelog,
  releaseBranchName,
  latestVersionTagged,
  commitsSince,
  prepare,
  readStatus,
  tagFor,
  resolveReleaseTarget,
  cut,
} from '../lib/release.mjs';
import { git } from '../lib/gh.mjs';

// ─── component names ─────────────────────────────────────────────────────────

test('component names: the accept/reject table', () => {
  const accepted = ['devlog', 'ghostwriter-x', 'city-report', 'natejswenson.io', '1.00s', 'a_b'];
  const rejected = [
    '../../etc/passwd', // path traversal — the reason this validator exists
    'a..b', // the charset alone would admit this; the explicit `..` check catches it
    '..',
    'Devlog', // uppercase: tag/branch/path casing must be predictable
    '-leading-dash',
    '.leading-dot',
    '',
    'a'.repeat(65),
    'has space',
    'semi;colon',
    'new\nline',
  ];
  for (const n of accepted) assert.equal(validateComponentName(n).ok, true, `expected "${n}" to be accepted`);
  for (const n of rejected) assert.equal(validateComponentName(n).ok, false, `expected ${JSON.stringify(n)} to be REJECTED`);
});

test('component names: resolveComponent refuses a traversing name outright', () => {
  // Two independent doors, and both must be shut. `../../etc` never reaches the
  // `..` check because `/` is not in the charset at all; `a..b` is exactly the
  // case the charset would happily admit, which is why the explicit `..` check
  // exists alongside it.
  assert.throws(
    () => resolveComponent('/tmp/repo', { release: {} }, '../../etc'),
    /must match/,
    'A traversing component name must never reach path substitution.'
  );
  assert.throws(
    () => resolveComponent('/tmp/repo', { release: {} }, 'a..b'),
    /path-traversal/,
    'A name that passes the charset but contains ".." must still be refused.'
  );
});

test('component paths: a hostile componentLayout cannot escape the repo either', () => {
  // The name validator is one door. A hand-written layout field is a second,
  // independent one — it is copied verbatim from config, not tokenised.
  const config = { release: { componentLayout: { changelog: '../../../etc/passwd' } } };
  assert.throws(
    () => resolveComponent('/tmp/repo', config, 'devlog'),
    /outside the repo/,
    'A componentLayout path that escapes the repo root must be refused.'
  );
});

// ─── layout + component listing ──────────────────────────────────────────────

test('layout: a repo with no componentLayout infers a single root component', () => {
  const layout = resolveLayout({ release: {} });
  assert.equal(layout.inferred, true);
  assert.deepEqual(layout.versionFiles, ['package.json']);
  assert.equal(layout.tagPattern, 'v{version}');
  // This is what makes `release-status --repo ~/localrepo/budget` work with
  // zero config in a single-component repo.
  assert.deepEqual(listComponentNames({ release: {} }, '/Users/x/localrepo/budget'), ['budget']);
});

test('layout: declared components accept both bare strings and {name} objects', () => {
  const config = { release: { components: ['devlog', { name: 'press' }, { nope: 1 }] } };
  assert.deepEqual(listComponentNames(config, '/tmp/repo'), ['devlog', 'press']);
});

test('layout: {name} is substituted into every path, and only {name}', () => {
  const config = {
    release: {
      componentLayout: {
        versionFiles: ['skills/{name}/skills/{name}/package.json'],
        changelog: 'skills/{name}/CHANGELOG.md',
        tagPattern: '{name}-v{version}',
        paths: ['skills/{name}'],
        workflowFile: '{name}.yml',
      },
    },
  };
  const c = resolveComponent('/tmp/repo', config, 'devlog');
  assert.deepEqual(c.versionFiles, ['skills/devlog/skills/devlog/package.json']);
  assert.equal(c.changelog, 'skills/devlog/CHANGELOG.md');
  assert.equal(c.workflowFile, 'devlog.yml');
  // {version} survives expansion here — one component has many tags.
  assert.equal(c.tagPattern, 'devlog-v{version}');
  assert.equal(tagFor(c, '1.2.3'), 'devlog-v1.2.3');
});

// ─── semver ──────────────────────────────────────────────────────────────────

test('semver: parse, compare and bump', () => {
  assert.equal(parseSemver('not.a.version'), null);
  assert.deepEqual(parseSemver('0.13.0'), { major: 0, minor: 13, patch: 0, prerelease: null });
  assert.equal(cmpSemver('0.13.0', '0.9.0'), 1, '0.13.0 > 0.9.0 — numeric, not lexicographic');
  assert.equal(cmpSemver('1.0.0-rc.1', '1.0.0'), -1, 'a prerelease sorts below its release');
  assert.equal(cmpSemver('2.0.0', '2.0.0'), 0);
  assert.equal(bumpSemver('0.13.0', 'minor'), '0.14.0');
  assert.equal(bumpSemver('0.13.4', 'minor'), '0.14.0', 'a minor bump zeroes the patch');
  assert.equal(bumpSemver('1.2.3', 'major'), '2.0.0');
  assert.equal(bumpSemver('1.2.3', 'patch'), '1.2.4');
});

// ─── version sources ─────────────────────────────────────────────────────────

test('frontmatter: version is read from the YAML block and NOWHERE else', () => {
  assert.equal(readFrontmatterVersion('---\nname: x\nversion: 1.2.3\n---\nbody'), '1.2.3');
  assert.equal(readFrontmatterVersion('---\nversion: "0.4.0"\n---\n'), '0.4.0');
  assert.equal(readFrontmatterVersion('no frontmatter\nversion: 9.9.9\n'), null);
  // The one that matters: SKILL.md bodies are full of YAML samples, and a
  // whole-file grep would happily release 9.9.9 off a documentation snippet.
  assert.equal(
    readFrontmatterVersion('---\nname: x\n---\n\n```yaml\nversion: 9.9.9\n```\n'),
    null,
    'A version: inside the body must never be matched.'
  );
});

test('version sources: TOML and YAML are read, but only at column zero', () => {
  const repo = makeRepo();
  // A real pyproject.toml shape: the project's own version at column zero, a
  // dependency pin indented under a [tool.*] table. Matching the indented one
  // would release the wrong number, silently.
  writeFile(repo, 'pyproject.toml', '[project]\nname = "budget"\nversion = "0.3.0"\n\n[tool.other]\n  version = "9.9.9"\n');
  // A real project.yml shape: same trap, plus a trailing comment.
  writeFile(repo, 'project.yml', 'name: app\nversion: 2.1.0 # marketing version\ntargets:\n  App:\n    version: 8.8.8\n');
  assert.equal(readVersionAt(repo, { versionFiles: ['pyproject.toml'] }, null).version, '0.3.0');
  assert.equal(readVersionAt(repo, { versionFiles: ['project.yml'] }, null).version, '2.1.0');
});

test('version sources: files that disagree are a hard refusal, not a best guess', () => {
  const repo = makeRepo();
  writeFile(repo, 'skills/x/package.json', JSON.stringify({ version: '1.0.0' }));
  writeFile(repo, 'skills/x/plugin.json', JSON.stringify({ version: '1.0.1' }));
  const component = { versionFiles: ['skills/x/package.json', 'skills/x/plugin.json'] };
  const r = readVersionAt(repo, component, null);
  assert.equal(r.ok, false);
  assert.match(r.error, /disagree/);
  // Releasing from a disagreeing set tags one version and ships another.
  assert.equal(r.version, null, 'a disagreement must not resolve to a version at all');
});

test('version sources: a file that is absent at a ref is skipped, not an error', () => {
  const repo = makeRepo();
  writeFile(repo, 'skills/x/package.json', JSON.stringify({ version: '1.0.0' }));
  const component = { versionFiles: ['skills/x/package.json', 'skills/x/never-existed.json'] };
  const r = readVersionAt(repo, component, null);
  assert.equal(r.ok, true);
  assert.equal(r.version, '1.0.0');
});

// ─── conventional commits → bump ─────────────────────────────────────────────

test('commits: conventional subjects parse; non-conventional ones survive intact', () => {
  assert.deepEqual(parseCommitSubject('feat(devlog): add a thing'), {
    conventional: true, type: 'feat', scope: 'devlog', subject: 'add a thing', breaking: false,
  });
  assert.equal(parseCommitSubject('feat!: drop the old API').breaking, true);
  assert.equal(parseCommitSubject('fix: x', 'body\n\nBREAKING CHANGE: gone').breaking, true);
  const plain = parseCommitSubject('just some words');
  assert.equal(plain.conventional, false);
  assert.equal(plain.subject, 'just some words', 'a non-conventional subject is kept, not dropped');
});

test('bump: feat is minor, everything else is patch, breaking is major', () => {
  const c = (s) => parseCommitSubject(s);
  assert.equal(suggestBump([c('fix: a'), c('chore: b')], '1.2.3').bump, 'patch');
  assert.equal(suggestBump([c('fix: a'), c('feat: b')], '1.2.3').bump, 'minor');
  assert.equal(suggestBump([c('feat!: b')], '1.2.3').bump, 'major');
  assert.equal(suggestBump([], '1.2.3').bump, null, 'no commits means nothing to release');
});

test('bump: a breaking change in 0.x is capped at minor, and says so', () => {
  // Going to 1.0.0 is a release decision. No commit message is entitled to
  // make it, and silently making it would be the worst kind of helpful.
  const r = suggestBump([parseCommitSubject('feat!: rewrite')], '0.3.3');
  assert.equal(r.bump, 'minor');
  assert.equal(r.capped, true);
  assert.match(r.reason, /0\.x/);
});

// ─── CHANGELOG splicing ──────────────────────────────────────────────────────

test('changelog: a new entry lands above the newest existing release', () => {
  const existing = '# Changelog\n\nAll notable changes.\n\n## [0.3.3] - 2026-07-20\n\n- old thing\n';
  const r = spliceChangelog(existing, '0.4.0', '### Added\n\n- new thing', '2026-08-02');
  assert.equal(r.ok, true);
  assert.match(r.content, /## \[0\.4\.0\] - 2026-08-02/);
  assert.ok(
    r.content.indexOf('0.4.0') < r.content.indexOf('0.3.3'),
    'the new entry must be above the old one'
  );
  assert.ok(r.content.startsWith('# Changelog'), 'the preamble must survive');
  assert.match(r.content, /- old thing/, 'existing entries must survive');
});

test('changelog: a duplicate version heading is refused', () => {
  const existing = '# Changelog\n\n## [0.4.0] - 2026-08-01\n\n- already here\n';
  const r = spliceChangelog(existing, '0.4.0', '- again', '2026-08-02');
  assert.equal(r.ok, false);
  assert.match(r.error, /already has a heading/);
});

test('changelog: a version full of regex metacharacters is data, not a pattern', () => {
  // spliceChangelog used to build `new RegExp` from `version`, escaping only
  // dots — so `\`, `*`, `+`, `(` and `[` all reached the regex engine live.
  // `prepare` rejects a non-semver version before it gets here, but this
  // function is exported and independently callable, so it must be safe alone.
  // Found by CodeQL (js/incomplete-sanitization, high) on PR #158.
  const hostile = '1.0.0[)\\*+(';
  const existing = '# Changelog\n\n## [0.1.0] - 2026-01-01\n\n- old\n';
  const r = spliceChangelog(existing, hostile, '- notes', '2026-08-02');
  assert.equal(r.ok, true, 'a metacharacter-laden version must not throw or be misread');
  assert.ok(r.content.includes(`## [${hostile}] - 2026-08-02`));

  // And the duplicate check must still fire on the literal string, not on
  // whatever pattern those characters would have compiled to.
  const again = spliceChangelog(r.content, hostile, '- notes', '2026-08-03');
  assert.equal(again.ok, false);
  assert.match(again.error, /already has a heading/);

  // A version that is a strict substring of an existing heading must not be
  // mistaken for it — `## [1.0.0]` does not mean 1.0.0[)\*+( is present.
  assert.equal(spliceChangelog('# c\n\n## [1.0.0] - 2026-01-01\n', hostile, '- n', '2026-08-02').ok, true);
});

test('changelog: _release.yml’s extractor can find what we spliced', () => {
  // _release.yml pulls notes with awk: lines under the first `## ` heading
  // containing the version, up to the next `## `. If the splice format and
  // that extractor ever disagree, every release ships with empty notes and
  // nothing fails — so assert the contract directly.
  const r = spliceChangelog('# Changelog\n\n## [0.3.3] - 2026-07-20\n\n- old\n', '0.4.0', '- brand new', '2026-08-02');
  const lines = r.content.split('\n');
  const start = lines.findIndex((l) => /^## /.test(l) && l.includes('0.4.0'));
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  const notes = (end === -1 ? rest : rest.slice(0, end)).join('\n');
  assert.match(notes, /- brand new/);
  assert.doesNotMatch(notes, /- old/, 'the extractor must not bleed into the previous release');
});

// ─── prepare(), against a real git repo ──────────────────────────────────────

test('prepare: bumps every present version file, splices the CHANGELOG, commits', () => {
  const { repo, config, name } = makeSkillRepo('alpha');
  const r = prepare(repo, config, name, '0.2.0', '### Added\n\n- a real thing');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.branch, releaseBranchName(name, '0.2.0'));

  const at = (p) => git(['show', `${r.branch}:${p}`], { cwd: repo }).stdout;
  assert.match(at(`skills/${name}/skills/${name}/package.json`), /"version": "0\.2\.0"/);
  assert.match(at(`skills/${name}/.claude-plugin/plugin.json`), /"version": "0\.2\.0"/);
  assert.match(at(`skills/${name}/CHANGELOG.md`), /## \[0\.2\.0\]/);
  assert.match(at(`skills/${name}/CHANGELOG.md`), /- a real thing/);

  // The commit must contain the release and NOTHING else. This is the whole
  // reason prepare() works in an isolated worktree.
  const files = git(['show', '--name-only', '--format=', r.branch], { cwd: repo }).stdout.split('\n').filter(Boolean);
  assert.deepEqual(files.sort(), [
    `skills/${name}/.claude-plugin/plugin.json`,
    `skills/${name}/CHANGELOG.md`,
    `skills/${name}/skills/${name}/package.json`,
  ].sort());
  cleanupWorktree(repo, r.worktree);
});

test('prepare: unrelated dirty work in the main tree is never swept into the release commit', () => {
  // The failure this guards against is not hypothetical — this monorepo's tree
  // had an entire untracked skill and four modified files in it while this was
  // being written, and `git add -A` anywhere in this path would have shipped them.
  const { repo, config, name } = makeSkillRepo('beta');
  writeFile(repo, 'UNRELATED.md', 'someone else was mid-thought here');
  writeFile(repo, `skills/${name}/../STRAY.txt`, 'stray');

  const r = prepare(repo, config, name, '0.2.0', '- notes');
  assert.equal(r.ok, true, r.error);
  const files = git(['show', '--name-only', '--format=', r.branch], { cwd: repo }).stdout;
  assert.doesNotMatch(files, /UNRELATED\.md/, 'unrelated dirt reached the release commit');
  assert.doesNotMatch(files, /STRAY\.txt/, 'unrelated dirt reached the release commit');
  // And it must still be sitting there afterwards, untouched.
  assert.equal(readFileSync(join(repo, 'UNRELATED.md'), 'utf8'), 'someone else was mid-thought here');
  cleanupWorktree(repo, r.worktree);
});

test('prepare: refuses a version that is not an increase', () => {
  const { repo, config, name } = makeSkillRepo('gamma');
  for (const bad of ['0.1.0', '0.0.9']) {
    const r = prepare(repo, config, name, bad, '- notes');
    assert.equal(r.ok, false, `${bad} should have been refused`);
    assert.match(r.error, /not higher than/);
  }
});

test('prepare: refuses an already-tagged version and an invalid semver', () => {
  const { repo, config, name } = makeSkillRepo('delta');
  git(['tag', `${name}-v0.5.0`], { cwd: repo });
  const tagged = prepare(repo, config, name, '0.5.0', '- notes');
  assert.equal(tagged.ok, false);
  assert.match(tagged.error, /already exists/);

  const junk = prepare(repo, config, name, 'v0.6', '- notes');
  assert.equal(junk.ok, false);
  assert.match(junk.error, /not a valid semver/);
});

test('prepare: refuses to reuse a CHANGELOG version already written', () => {
  const { repo, config, name } = makeSkillRepo('epsilon');
  const r = prepare(repo, config, name, '0.2.0', '- first');
  assert.equal(r.ok, true, r.error);
  cleanupWorktree(repo, r.worktree);
  // Second attempt at the same version: the branch is recreated off dev, where
  // the CHANGELOG heading does not exist yet, so the guard that must fire is
  // the tag/version check, not the heading check.
  const again = prepare(repo, config, name, '0.2.0', '- second');
  assert.equal(again.ok, true, 'off a clean dev this is a legitimate retry');
  cleanupWorktree(repo, again.worktree);
});

test('status: a shallow clone is a blocker, because its commit ranges lie', () => {
  // `git log <tag>..<ref>` needs full ancestry to exclude what the tag already
  // covers. A grafted history under-applies that exclusion and returns commits
  // that shipped long ago — without erroring. Found for real: a depth-1
  // checkout of this repo's main reported 1 unreleased commit for a component
  // a full clone reported as 0.
  const { repo, config, name } = makeSkillRepo('theta');
  git(['tag', `${name}-v0.1.0`], { cwd: repo });
  const full = readStatus(repo, config, name);
  assert.equal(full.blockers.some((b) => b.id === 'shallow-clone'), false, 'a full clone must not be flagged shallow');

  const shallow = mkdtempSync(join(tmpdir(), 'shipflow-shallow-'));
  repos.push(shallow);
  rmSync(shallow, { recursive: true, force: true });
  const cloned = git(['clone', '--depth', '1', '--branch', 'dev', `file://${repo}`, shallow]);
  assert.equal(cloned.status, 0, `clone failed: ${cloned.stderr}`);
  assert.equal(git(['rev-parse', '--is-shallow-repository'], { cwd: shallow }).stdout.trim(), 'true');

  const status = readStatus(shallow, config, name);
  const blocker = status.blockers.find((b) => b.id === 'shallow-clone');
  assert.ok(blocker, `a shallow clone must be blocked; got: ${status.blockers.map((b) => b.id).join(', ') || 'no blockers'}`);
  assert.match(blocker.detail, /--unshallow/, 'the blocker must say how to fix it');
});

// ─── tags and commit ranges, against a real git repo ─────────────────────────

test('tags: only this component’s tags are seen, sorted by semver not by string', () => {
  const { repo, config, name } = makeSkillRepo('zeta');
  const component = resolveComponent(repo, config, name);
  for (const v of ['0.2.0', '0.9.0', '0.10.0']) git(['tag', `${name}-v${v}`], { cwd: repo });
  git(['tag', 'other-v99.0.0'], { cwd: repo });
  git(['tag', 'v1.2.3'], { cwd: repo });
  assert.equal(
    latestVersionTagged(repo, component),
    '0.10.0',
    '0.10.0 > 0.9.0 numerically; a string sort would pick 0.9.0'
  );
});

test('commits: only commits touching this component’s paths are counted', () => {
  const { repo, config, name } = makeSkillRepo('eta');
  const component = resolveComponent(repo, config, name);
  git(['tag', `${name}-v0.1.0`], { cwd: repo });

  writeFile(repo, 'somewhere/else.txt', 'x');
  git(['add', '--', 'somewhere/else.txt'], { cwd: repo });
  git(['commit', '-m', 'feat(other): not mine'], { cwd: repo });

  writeFile(repo, `skills/${name}/README.md`, 'mine');
  git(['add', '--', `skills/${name}/README.md`], { cwd: repo });
  git(['commit', '-m', 'fix(eta): mine'], { cwd: repo });

  const r = commitsSince(repo, component, `${name}-v0.1.0`, 'dev');
  assert.equal(r.ok, true);
  assert.equal(r.commits.length, 1, 'a commit outside this component’s paths must not be counted');
  assert.equal(r.commits[0].subject, 'mine');
  assert.equal(suggestBump(r.commits, '0.1.0').bump, 'patch');
});

// ─── #173: the ambiguous fast path is refused, not guessed ──────────────────
// `readStatus` used to collapse two independently-true facts — "main has an
// untagged bump" and "dev already carries something higher" — into one
// mutually-exclusive `state` string, and `cut()`'s fast path acted on that
// string alone. Hit for real during `/release eval` on 2026-08-03: `main` was
// 0.2.1 (untagged), `dev` was 0.3.0 (the work actually being released), and
// the fast path would have tagged `eval-v0.2.1` — the OLDER version — while
// reporting success. Every test below is offline: no `gh` call is ever
// reachable from any of them, because the refusal happens in
// `resolveReleaseTarget`, before `cut()` ever touches the network.

test('status: the reporter’s exact three-way state — tag < main < dev — surfaces devAhead and a blocker', () => {
  const { repo, config, name } = makeThreeWayRepo('kappa');
  const status = readStatus(repo, config, name);
  assert.equal(status.state, 'untagged-bump-on-main');
  assert.equal(status.versionOnMain, '0.2.1');
  assert.equal(status.versionOnDev, '0.3.0');
  assert.equal(status.lastTag, `${name}-v0.2.0`);
  assert.deepEqual(status.devAhead, { version: '0.3.0', aheadOfMain: true });
  const blocker = status.blockers.find((b) => b.id === 'dev-ahead-of-main');
  assert.ok(blocker, `expected a dev-ahead-of-main blocker; got: ${status.blockers.map((b) => b.id).join(', ') || 'none'}`);
  assert.match(blocker.detail, /0\.2\.1/);
  assert.match(blocker.detail, /0\.3\.0/);
});

test('cut: refuses the three-way ambiguous state before any dispatch, naming both versions', () => {
  const { repo, config, name } = makeThreeWayRepo('lambda');
  const result = cut(repo, config, name, { skipHashCheck: true, ownerRepo: 'x/y' });
  assert.equal(result.ok, false, 'an ambiguous three-way state must never be silently resolved');
  assert.match(result.error, /0\.2\.1/, 'the refusal must name the version on main');
  assert.match(result.error, /0\.3\.0/, 'the refusal must name the version on dev');
  // Asserted on the message text, not merely ok:false — in a remote-less temp
  // repo a bare ok:false could also be satisfied by a `gh` call simply
  // failing, which would be a false pass for this exact defect.
  assert.equal(result.tag, undefined, 'a refusal must happen before any tag is derived — no fast path was ever entered');
  assert.equal(result.log, undefined, 'a refusal must happen before cut() begins its stage log at all');
});

test('status + cut: the never-released branch (D2) is covered too — no tag anywhere, not just the c > 0 branch', () => {
  // A fix that only patched the `cmpSemver(onMain.version, lastVersion) > 0`
  // branch would leave a component's very first release exposed to the
  // identical failure, because `devAhead` is what has to be computed
  // independently of `lastVersion` being null.
  const { repo, config, name } = makeSkillRepo('mu'); // 0.1.0 on dev, no tags at all
  git(['branch', 'main'], { cwd: repo }); // main == dev == 0.1.0, still untagged
  bumpOnBranch(repo, name, 'dev', '0.2.0'); // dev ahead; main never released
  git(['checkout', 'dev'], { cwd: repo });

  const status = readStatus(repo, config, name);
  assert.equal(status.lastTag, null);
  assert.equal(status.state, 'untagged-bump-on-main', 'never-released main is still the first-release shape of this state');
  assert.deepEqual(status.devAhead, { version: '0.2.0', aheadOfMain: true });
  assert.ok(status.blockers.some((b) => b.id === 'dev-ahead-of-main'));

  const result = cut(repo, config, name, { skipHashCheck: true, ownerRepo: 'x/y' });
  assert.equal(result.ok, false);
  assert.match(result.error, /0\.1\.0/);
  assert.match(result.error, /0\.2\.0/);
});

test('resolveReleaseTarget: --version is a confirmation, not a bypass', () => {
  const { repo, config, name } = makeThreeWayRepo('nu');
  const status = readStatus(repo, config, name);

  // Asking for the version already on dev is refused — a dispatch on main can
  // never cut it, no matter how it's asked for.
  const askedForDev = resolveReleaseTarget(status, status.versionOnDev);
  assert.equal(askedForDev.ok, false);
  assert.match(askedForDev.error, /dev/i);
  assert.match(askedForDev.error, /main/i);

  // Naming exactly what's on main is accepted — a deliberate, confirmed
  // choice to release main's version and leave dev's for later.
  assert.deepEqual(resolveReleaseTarget(status, status.versionOnMain), {
    ok: true, version: status.versionOnMain, via: 'dispatch-on-main', confirmed: true,
  });

  // Nothing else unlocks it: a version that is on neither branch, garbage
  // input, and no answer at all are every one a refusal.
  assert.equal(resolveReleaseTarget(status, '9.9.9').ok, false);
  assert.equal(resolveReleaseTarget(status, 'not-a-version').ok, false);
  assert.equal(resolveReleaseTarget(status, null).ok, false, 'omitting --version entirely must not default to picking one side');
});

test('cut: the version it acts on is the SAME one resolveReleaseTarget resolved — one derivation, not two', () => {
  // Before this fix, cut() derived the target version twice, ten lines apart
  // — once preferring dev (used to compute the branch/tag), once preferring
  // main (used only inside the fast path). This proves there is now exactly
  // one derivation: the branch name in cut()'s own (offline, network-free)
  // "does not exist" refusal must name the SAME version resolveReleaseTarget
  // independently resolves for this status.
  const { repo, config, name } = makeUnpromotedRepo('xi');
  const status = readStatus(repo, config, name);
  assert.equal(status.state, 'bump-on-dev-unpromoted');
  const target = resolveReleaseTarget(status, null);
  assert.equal(target.ok, true);
  assert.equal(target.version, '0.2.0');

  const result = cut(repo, config, name, { skipHashCheck: true, ownerRepo: 'x/y' });
  assert.equal(result.ok, false);
  assert.match(result.error, new RegExp(releaseBranchName(name, target.version).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('devAhead / the dev-ahead-of-main blocker: two-sided — absent everywhere nothing can be mis-tagged', () => {
  // clean: main == dev == lastTag. No fact to report, nothing ambiguous.
  const { repo: cleanRepo, config: cleanConfig, name: cleanName } = makeSkillRepo('omicron');
  git(['tag', `${cleanName}-v0.1.0`], { cwd: cleanRepo });
  git(['branch', 'main'], { cwd: cleanRepo });
  const cleanStatus = readStatus(cleanRepo, cleanConfig, cleanName);
  assert.equal(cleanStatus.state, 'clean');
  assert.equal(cleanStatus.devAhead, null);
  assert.equal(cleanStatus.blockers.some((b) => b.id === 'dev-ahead-of-main'), false);
  assert.deepEqual(resolveReleaseTarget(cleanStatus, null), { ok: true, version: '0.1.0', via: 'prepared-branch' });

  // bump-on-dev-unpromoted: devAhead IS set (that is this state's normal,
  // expected shape — no fast path is reachable here, nothing can be
  // mis-tagged) but the blocker must NOT fire. A blocker that is always on
  // for this state stops being read.
  const { repo: upRepo, config: upConfig, name: upName } = makeUnpromotedRepo('pi');
  const upStatus = readStatus(upRepo, upConfig, upName);
  assert.equal(upStatus.state, 'bump-on-dev-unpromoted');
  assert.deepEqual(upStatus.devAhead, { version: '0.2.0', aheadOfMain: true });
  assert.equal(upStatus.blockers.some((b) => b.id === 'dev-ahead-of-main'), false, 'devAhead is this state’s normal shape, not a blocker');

  // plain untagged-bump-on-main: dev == main, so devAhead never even sets.
  const { repo: plainRepo, config: plainConfig, name: plainName } = makeSkillRepo('rho');
  git(['tag', `${plainName}-v0.1.0`], { cwd: plainRepo });
  git(['branch', 'main'], { cwd: plainRepo });
  bumpOnBranch(plainRepo, plainName, 'main', '0.2.0');
  bumpOnBranch(plainRepo, plainName, 'dev', '0.2.0'); // dev matches main exactly
  git(['checkout', 'dev'], { cwd: plainRepo });
  const plainStatus = readStatus(plainRepo, plainConfig, plainName);
  assert.equal(plainStatus.state, 'untagged-bump-on-main');
  assert.equal(plainStatus.devAhead, null);
  assert.equal(plainStatus.blockers.some((b) => b.id === 'dev-ahead-of-main'), false);
  assert.deepEqual(resolveReleaseTarget(plainStatus, null), { ok: true, version: '0.2.0', via: 'dispatch-on-main' });
});

test('devAhead adds a fact, never renames a state — the three-way case is still plain untagged-bump-on-main', () => {
  // `state` is a public field of a published npm package's JSON output,
  // consumed by two SKILL.md decision tables and possibly unseen consumers
  // elsewhere. The fix adds `devAhead`; it must never rename or add a state.
  const { repo, config, name } = makeThreeWayRepo('sigma');
  const status = readStatus(repo, config, name);
  assert.equal(status.state, 'untagged-bump-on-main');
});

// ─── helpers ─────────────────────────────────────────────────────────────────

const repos = [];

function writeFile(repo, relPath, content) {
  const abs = join(repo, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'shipflow-release-test-'));
  repos.push(dir);
  git(['init', '-b', 'dev'], { cwd: dir });
  git(['config', 'user.email', 'test@example.com'], { cwd: dir });
  git(['config', 'user.name', 'test'], { cwd: dir });
  return dir;
}

// A miniature of this monorepo's layout: nested skill dir, three version
// files, a CHANGELOG, and a caller workflow.
function makeSkillRepo(name) {
  const repo = makeRepo();
  writeFile(repo, `skills/${name}/skills/${name}/package.json`, `{\n  "name": "${name}",\n  "version": "0.1.0"\n}\n`);
  writeFile(repo, `skills/${name}/.claude-plugin/plugin.json`, `{\n  "name": "${name}",\n  "version": "0.1.0"\n}\n`);
  writeFile(repo, `skills/${name}/CHANGELOG.md`, `# Changelog\n\n## [0.1.0] - 2026-01-01\n\n- first\n`);
  writeFile(repo, `.github/workflows/${name}.yml`, 'name: x\n');
  git(['add', '--', 'skills', '.github'], { cwd: repo });
  git(['commit', '-m', 'chore: init'], { cwd: repo });
  const config = {
    branches: { main: 'main', dev: 'dev' },
    featureBranchPrefix: 'feature/',
    release: {
      componentLayout: {
        versionFiles: [
          'skills/{name}/skills/{name}/package.json',
          'skills/{name}/skills/{name}/SKILL.md',
          'skills/{name}/.claude-plugin/plugin.json',
        ],
        changelog: 'skills/{name}/CHANGELOG.md',
        tagPattern: '{name}-v{version}',
        paths: ['skills/{name}'],
        workflowFile: '{name}.yml',
      },
      components: [name],
    },
  };
  return { repo, config, name };
}

// Bumps only the two version files makeSkillRepo commits eagerly (package.json
// and plugin.json — SKILL.md is deliberately absent from these fixtures, and
// readVersionAt already tolerates a version file that doesn't exist). Commits
// directly on `branch`, so the caller is responsible for returning to whatever
// branch it wants checked out afterward.
function bumpOnBranch(repo, name, branch, version) {
  git(['checkout', branch], { cwd: repo });
  writeFile(repo, `skills/${name}/skills/${name}/package.json`, `{\n  "name": "${name}",\n  "version": "${version}"\n}\n`);
  writeFile(repo, `skills/${name}/.claude-plugin/plugin.json`, `{\n  "name": "${name}",\n  "version": "${version}"\n}\n`);
  git(['add', '--', `skills/${name}`], { cwd: repo });
  git(['commit', '-m', `chore(${name}): release v${version}`], { cwd: repo });
}

// #173's exact reported shape: `lastTag < main < dev`. Tagged 0.2.0, main
// untagged-bumped to 0.2.1, dev independently bumped past both to 0.3.0.
function makeThreeWayRepo(name) {
  const { repo, config } = makeSkillRepo(name); // 0.1.0 on dev
  git(['branch', 'main'], { cwd: repo }); // main starts equal to dev's initial commit
  bumpOnBranch(repo, name, 'main', '0.2.0');
  git(['tag', `${name}-v0.2.0`], { cwd: repo });
  bumpOnBranch(repo, name, 'main', '0.2.1'); // untagged bump on main
  bumpOnBranch(repo, name, 'dev', '0.3.0'); // dev ahead of both
  git(['checkout', 'dev'], { cwd: repo });
  return { repo, config, name };
}

// The neighbouring, unambiguous state: main == lastTag, dev carries a
// prepared-but-unpromoted bump. devAhead is set here too (dev IS higher than
// main) but it is this state's ordinary shape, not #173's ambiguity — no fast
// path is reachable from it, so nothing can be mis-tagged.
function makeUnpromotedRepo(name) {
  const { repo, config } = makeSkillRepo(name); // 0.1.0 on dev
  git(['tag', `${name}-v0.1.0`], { cwd: repo }); // lastTag == main == 0.1.0
  git(['branch', 'main'], { cwd: repo });
  bumpOnBranch(repo, name, 'dev', '0.2.0'); // prepared on dev, not yet promoted
  git(['checkout', 'dev'], { cwd: repo });
  return { repo, config, name };
}

function cleanupWorktree(repo, dir) {
  if (!dir) return;
  rmSync(dir, { recursive: true, force: true });
  git(['worktree', 'prune'], { cwd: repo });
}

test.after(() => {
  for (const dir of repos) rmSync(dir, { recursive: true, force: true });
});
