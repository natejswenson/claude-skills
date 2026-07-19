// End-to-end tests of the CLI dispatch layer: spawn the real binary with HOME
// pointed at a temp dir so ~/.claude/skills/devlog/config.json resolves into
// the fixture. This is the layer unit tests miss — exactly the flags SKILL.md
// tells the agent to pass must parse and produce JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, copyFileSync, unlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
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

// Playwright resolves its browser cache from $HOME by default — with HOME overridden to
// a fixture dir below, it would look for the already-installed Chromium in the wrong
// place. PLAYWRIGHT_BROWSERS_PATH pins it back to this (real) machine's actual cache,
// mirroring Playwright's own per-OS default so this works locally (macOS) and in CI
// (ubuntu-latest) alike.
const REAL_PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || (
  process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'ms-playwright')
    : process.platform === 'win32' ? join(homedir(), 'AppData', 'Local', 'ms-playwright')
      : join(homedir(), '.cache', 'ms-playwright')
);

function run(home, ...args) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, PLAYWRIGHT_BROWSERS_PATH: REAL_PLAYWRIGHT_BROWSERS_PATH },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const parse = (out) => JSON.parse(out.stdout);

// #hero-zone is now mandatory (render_cover.mjs's geometry guard) — every render-cover CLI
// fixture below needs one positioned at the exact HERO_ZONE box to reach a real render.
const HERO_ZONE_DIV = '<div id="hero-zone" style="position:absolute; left:150px; top:425px; width:1300px; height:400px;"></div>';

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

  // A leading-dash value is rejected at the arg-parsing layer — as structured
  // bad-flag JSON (exit 2), not an uncaught parseArgs stack trace.
  const badSet = run(home, 'set', 'branch', '-bad');
  assert.equal(badSet.status, 2);
  assert.equal(parse(badSet).error, 'bad-flag');

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

// ─── cover-image commands ──────────────────────────────────────────────────────

function makeCoverHome(t, projects = ['proj-a', 'proj-b']) {
  const home = mkdtempSync(join(tmpdir(), 'devlog-cli-cover-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));

  const configDir = join(home, '.claude', 'skills', 'devlog');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    targetRepo: 'me/daily-dev-log',
    branch: 'main',
    gitAuthor: 'Test',
    githubUser: 'me',
    projects: projects.map((key) => ({ key, path: '/x', remote: `me/${key}` })),
  }));

  // The bundled style guide + font, installed the same way `devlog init` would.
  const imageStyleDest = join(configDir, 'image-style');
  mkdirSync(imageStyleDest, { recursive: true });
  copyFileSync(join(SKILL_ROOT, 'image-style', 'font.ttf'), join(imageStyleDest, 'font.ttf'));
  writeFileSync(join(imageStyleDest, 'style-guide.md'), '# Style guide\n\nUse flat colors.\n');

  // A plain directory standing in for an established `git clone --depth=1` — none of
  // cover-context/backfill-covers list/render-cover perform any git operation themselves.
  const cloneDir = join(home, 'clone');
  mkdirSync(cloneDir);

  return { home, configDir, imageStyleDest, cloneDir };
}

function writeManifest(cloneDir, project, entries) {
  const dir = join(cloneDir, project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ entries }));
}

test('cover-context returns the style guide and an empty references array when no cover exists yet', (t) => {
  const { home, cloneDir } = makeCoverHome(t);
  writeManifest(cloneDir, 'proj-a', [{ date: '2026-07-01', file: 'v0.1.0.md', version: 'v0.1.0' }]);

  const out = run(home, 'cover-context', 'proj-a', 'v0.1.0', '--clone', cloneDir);
  assert.equal(out.status, 0, out.stderr);
  const body = parse(out);
  assert.match(body.styleGuide, /Style guide/);
  assert.deepEqual(body.references, []);
});

test('cover-context surfaces a distinct error field (not a thrown crash) when the style guide is missing', (t) => {
  const { home, imageStyleDest, cloneDir } = makeCoverHome(t);
  unlinkSync(join(imageStyleDest, 'style-guide.md'));
  writeManifest(cloneDir, 'proj-a', []);

  const out = run(home, 'cover-context', 'proj-a', 'v0.1.0', '--clone', cloneDir);
  assert.equal(out.status, 1);
  assert.equal(parse(out).error, 'style-guide-missing');
});

test('cover-context requires --clone', (t) => {
  const { home } = makeCoverHome(t);
  const out = run(home, 'cover-context', 'proj-a', 'v0.1.0');
  assert.equal(out.status, 1);
  assert.equal(parse(out).error, 'missing-flag');
});

test('render-cover writes a real 1600x900 PNG and a contact sheet, project-namespaced', (t) => {
  const { home } = makeCoverHome(t);
  const outDir = join(home, 'staging');
  mkdirSync(outDir, { recursive: true });
  const htmlPath = join(home, 'cover.html');
  writeFileSync(htmlPath, `<!DOCTYPE html><html><body style="margin:0;width:1600px;height:900px;background:#000">${HERO_ZONE_DIV}</body></html>`);

  const out = run(home, 'render-cover', htmlPath, '--project', 'proj-a', '--slug', 'v0.1.0', '--out', outDir);
  assert.equal(out.status, 0, out.stderr);
  const body = parse(out);
  assert.equal(body.ok, true);
  assert.ok(existsSync(join(outDir, 'proj-a', 'v0.1.0.png')));
  assert.ok(existsSync(join(outDir, 'index.html')));
  // The HTML source survives a successful render — it's what makes
  // "tweak the HTML, re-run render-cover" possible.
  assert.equal(existsSync(htmlPath), true);
});

test('render-cover re-renders when the HTML is present, overwriting a stale PNG', (t) => {
  const { home } = makeCoverHome(t);
  const outDir = join(home, 'staging');
  mkdirSync(outDir, { recursive: true });
  const htmlPath = join(home, 'cover.html');
  const doc = (bg) => `<!DOCTYPE html><html><body style="margin:0;width:1600px;height:900px;background:${bg}">${HERO_ZONE_DIV}</body></html>`;

  writeFileSync(htmlPath, doc('#000'));
  const first = run(home, 'render-cover', htmlPath, '--project', 'proj-a', '--slug', 'v0.1.0', '--out', outDir);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(parse(first).rendered, true);
  const pngPath = join(outDir, 'proj-a', 'v0.1.0.png');
  const firstBytes = readFileSync(pngPath);

  // Edit the HTML, re-run: must re-render (the old PNG-exists short-circuit
  // silently kept the stale image and cost real runs a debugging dance).
  writeFileSync(htmlPath, doc('#fff'));
  const second = run(home, 'render-cover', htmlPath, '--project', 'proj-a', '--slug', 'v0.1.0', '--out', outDir);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(parse(second).rendered, true);
  assert.ok(!firstBytes.equals(readFileSync(pngPath)), 'PNG bytes must change after the HTML edit');
});

test('render-cover project-namespaces staged output so two projects sharing a slug never collide', (t) => {
  const { home } = makeCoverHome(t);
  const outDir = join(home, 'staging');
  mkdirSync(outDir, { recursive: true });
  const html = () => `<!DOCTYPE html><html><body style="margin:0;width:1600px;height:900px;background:#111">${HERO_ZONE_DIV}</body></html>`;

  const htmlA = join(home, 'a.html');
  writeFileSync(htmlA, html());
  const outA = run(home, 'render-cover', htmlA, '--project', 'proj-a', '--slug', 'v0.1.0', '--out', outDir);
  assert.equal(outA.status, 0, outA.stderr);

  const htmlB = join(home, 'b.html');
  writeFileSync(htmlB, html());
  const outB = run(home, 'render-cover', htmlB, '--project', 'proj-b', '--slug', 'v0.1.0', '--out', outDir);
  assert.equal(outB.status, 0, outB.stderr);

  assert.ok(existsSync(join(outDir, 'proj-a', 'v0.1.0.png')));
  assert.ok(existsSync(join(outDir, 'proj-b', 'v0.1.0.png')));
});

test('render-cover is idempotent: a second run against an already-valid PNG does not re-render', (t) => {
  const { home } = makeCoverHome(t);
  const outDir = join(home, 'staging');
  mkdirSync(outDir, { recursive: true });
  const htmlPath = () => {
    const p = join(home, 'cover.html');
    writeFileSync(p, `<!DOCTYPE html><html><body style="margin:0;width:1600px;height:900px;">${HERO_ZONE_DIV}</body></html>`);
    return p;
  };

  const first = run(home, 'render-cover', htmlPath(), '--project', 'proj-a', '--slug', 'v0.1.0', '--out', outDir);
  assert.equal(parse(first).rendered, true);

  // With the HTML gone and a valid PNG in place, a re-run is a no-op:
  // rendered false, exit 0 — the resume-after-success case.
  const second = run(home, 'render-cover', join(home, 'nonexistent.html'), '--project', 'proj-a', '--slug', 'v0.1.0', '--out', outDir);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(parse(second).rendered, false);
});

test('render-cover surfaces a render-failed error (not a crash) when the font is missing', (t) => {
  const { home, imageStyleDest } = makeCoverHome(t);
  unlinkSync(join(imageStyleDest, 'font.ttf'));
  const outDir = join(home, 'staging');
  mkdirSync(outDir, { recursive: true });
  const htmlPath = join(home, 'cover.html');
  writeFileSync(htmlPath, '<!DOCTYPE html><html><body></body></html>');

  const out = run(home, 'render-cover', htmlPath, '--project', 'proj-a', '--slug', 'v0.1.0', '--out', outDir);
  assert.equal(out.status, 1);
  assert.equal(parse(out).error, 'render-failed');
  // Left in place on failure, for debugging.
  assert.ok(existsSync(htmlPath));
});

test('backfill-covers list merges across projects, extracts only ## Shipped, and sorts oldest-first with a project/slug tie-break', (t) => {
  const { home, cloneDir } = makeCoverHome(t);
  const mdA = '---\ntitle: "A"\ndate: 2026-07-05\nproject: proj-a\nversion: v0.2.0\ntags: [x]\nsummary: "s"\n---\n\n## Shipped\n\nShipped text A.\n\n## Changelog\n\nSecret commit list.\n';
  const mdB1 = '---\ntitle: "B1"\ndate: 2026-07-05\nproject: proj-b\nversion: v0.1.0\ntags: [x]\nsummary: "s"\n---\n\n## Shipped\n\nShipped text B1.\n';
  const mdA0 = '---\ntitle: "A0"\ndate: 2026-07-01\nproject: proj-a\nversion: v0.1.0\ntags: [x]\nsummary: "s"\n---\n\n## Shipped\n\nShipped text A0.\n';

  writeManifest(cloneDir, 'proj-a', [
    { date: '2026-07-05', file: 'v0.2.0.md', version: 'v0.2.0', title: 'A', tags: ['x'], summary: 's' },
    { date: '2026-07-01', file: 'v0.1.0.md', version: 'v0.1.0', title: 'A0', tags: ['x'], summary: 's' },
  ]);
  writeManifest(cloneDir, 'proj-b', [
    { date: '2026-07-05', file: 'v0.1.0.md', version: 'v0.1.0', title: 'B1', tags: ['x'], summary: 's' },
  ]);
  writeFileSync(join(cloneDir, 'proj-a', 'v0.2.0.md'), mdA);
  writeFileSync(join(cloneDir, 'proj-a', 'v0.1.0.md'), mdA0);
  writeFileSync(join(cloneDir, 'proj-b', 'v0.1.0.md'), mdB1);

  const out = run(home, 'backfill-covers', 'list', '--clone', cloneDir);
  assert.equal(out.status, 0, out.stderr);
  const list = parse(out);

  assert.deepEqual(list.map((c) => `${c.project}/${c.slug}`), ['proj-a/v0.1.0', 'proj-a/v0.2.0', 'proj-b/v0.1.0']);
  const entryA = list.find((c) => c.project === 'proj-a' && c.slug === 'v0.2.0');
  assert.equal(entryA.shipped, 'Shipped text A.');
  assert.doesNotMatch(JSON.stringify(entryA), /Secret commit list/);
});

test('backfill-covers list --project filters to one project', (t) => {
  const { home, cloneDir } = makeCoverHome(t);
  writeManifest(cloneDir, 'proj-a', [{ date: '2026-07-01', file: 'v0.1.0.md', version: 'v0.1.0', title: 'A', tags: [], summary: 's' }]);
  writeManifest(cloneDir, 'proj-b', [{ date: '2026-07-01', file: 'v0.1.0.md', version: 'v0.1.0', title: 'B', tags: [], summary: 's' }]);
  writeFileSync(join(cloneDir, 'proj-a', 'v0.1.0.md'), '---\ntitle: "A"\ndate: 2026-07-01\n---\n\n## Shipped\n\nx\n');
  writeFileSync(join(cloneDir, 'proj-b', 'v0.1.0.md'), '---\ntitle: "B"\ndate: 2026-07-01\n---\n\n## Shipped\n\nx\n');

  const out = run(home, 'backfill-covers', 'list', '--clone', cloneDir, '--project', 'proj-a');
  assert.deepEqual(parse(out).map((c) => c.project), ['proj-a']);
});

test('backfill-covers list --all lists every entry regardless of cover status; no flag stays missing-cover-only (COVER-Q-10)', (t) => {
  const { home, cloneDir } = makeCoverHome(t);
  writeManifest(cloneDir, 'proj-a', [
    { date: '2026-07-01', file: 'v0.1.0.md', version: 'v0.1.0', title: 'A', tags: [], summary: 's', cover: { file: 'v0.1.0.png', bytes: 3 } },
    { date: '2026-07-02', file: 'v0.2.0.md', version: 'v0.2.0', title: 'A2', tags: [], summary: 's', cover: false },
    { date: '2026-07-03', file: 'v0.3.0.md', version: 'v0.3.0', title: 'A3', tags: [], summary: 's' }, // cover field absent entirely
  ]);
  writeFileSync(join(cloneDir, 'proj-a', 'v0.1.0.md'), '---\ntitle: "A"\ndate: 2026-07-01\n---\n\n## Shipped\n\nx\n');
  writeFileSync(join(cloneDir, 'proj-a', 'v0.2.0.md'), '---\ntitle: "A2"\ndate: 2026-07-02\n---\n\n## Shipped\n\nx\n');
  writeFileSync(join(cloneDir, 'proj-a', 'v0.3.0.md'), '---\ntitle: "A3"\ndate: 2026-07-03\n---\n\n## Shipped\n\nx\n');

  const noFlag = run(home, 'backfill-covers', 'list', '--clone', cloneDir);
  assert.deepEqual(parse(noFlag).map((c) => c.slug), ['v0.2.0', 'v0.3.0']);

  const withAll = run(home, 'backfill-covers', 'list', '--clone', cloneDir, '--all');
  assert.deepEqual(parse(withAll).map((c) => c.slug), ['v0.1.0', 'v0.2.0', 'v0.3.0']);
});

test('backfill-covers list --out excludes an already-validly-staged candidate', (t) => {
  const { home, cloneDir } = makeCoverHome(t);
  writeManifest(cloneDir, 'proj-a', [{ date: '2026-07-01', file: 'v0.1.0.md', version: 'v0.1.0', title: 'A', tags: [], summary: 's' }]);
  writeFileSync(join(cloneDir, 'proj-a', 'v0.1.0.md'), '---\ntitle: "A"\ndate: 2026-07-01\n---\n\n## Shipped\n\nx\n');

  const stagingDir = join(home, 'staging');
  mkdirSync(join(stagingDir, 'proj-a'), { recursive: true });
  writeFileSync(join(stagingDir, 'proj-a', 'v0.1.0.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const out = run(home, 'backfill-covers', 'list', '--clone', cloneDir, '--out', stagingDir);
  assert.deepEqual(parse(out), []);
});

test('backfill-covers list throws a named error when a project directory exists but has no manifest.json', (t) => {
  const { home, cloneDir } = makeCoverHome(t);
  mkdirSync(join(cloneDir, 'proj-a'), { recursive: true });
  const out = run(home, 'backfill-covers', 'list', '--clone', cloneDir);
  assert.equal(out.status, 1);
  assert.match(parse(out).message, /manifest\.json missing for project "proj-a"/);
});

// ─── commit-covers (real local git clone/commit/push, no real GitHub involved) ────
//
// commit-covers deliberately has NO --clone flag — it always builds
// `https://github.com/<targetRepo>.git` itself. To exercise its real git clone/commit/push
// path without touching the network or the real daily-dev-log repo, a fixture `~/.gitconfig`
// rewrites that exact URL to a local bare repo via `url.<base>.insteadOf` — a pure
// environment-level test technique, no production code path changed or bypassed.

function makeBareDailyDevLog(t) {
  const bareDir = mkdtempSync(join(tmpdir(), 'devlog-bare-'));
  t.after(() => rmSync(bareDir, { recursive: true, force: true }));
  const init = spawnSync('git', ['init', '--bare', '-b', 'main', bareDir], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  return bareDir;
}

function seedDailyDevLog(t, bareDir, projectManifests) {
  const work = mkdtempSync(join(tmpdir(), 'devlog-seed-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const init = spawnSync('git', ['init', '-b', 'main', work], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  git(work, 'config', 'user.email', 't@example.com');
  git(work, 'config', 'user.name', 'T');
  git(work, 'config', 'commit.gpgsign', 'false');
  for (const [project, manifest] of Object.entries(projectManifests)) {
    mkdirSync(join(work, project), { recursive: true });
    writeFileSync(join(work, project, 'manifest.json'), JSON.stringify(manifest));
  }
  git(work, 'add', '.');
  git(work, 'commit', '-m', 'seed');
  git(work, 'remote', 'add', 'origin', bareDir);
  git(work, 'push', 'origin', 'main');
}

function makeCommitCoversHome(t, projectManifests) {
  const { home } = { home: mkdtempSync(join(tmpdir(), 'devlog-cli-commit-')) };
  t.after(() => rmSync(home, { recursive: true, force: true }));

  const bareDir = makeBareDailyDevLog(t);
  seedDailyDevLog(t, bareDir, projectManifests);

  const configDir = join(home, '.claude', 'skills', 'devlog');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    targetRepo: 'me/daily-dev-log',
    branch: 'main',
    gitAuthor: 'Test',
    githubUser: 'me',
    projects: Object.keys(projectManifests).map((key) => ({ key, path: '/x', remote: `me/${key}` })),
  }));

  writeFileSync(join(home, '.gitconfig'),
    `[url "file://${bareDir}"]\n\tinsteadOf = https://github.com/me/daily-dev-log.git\n` +
    `[user]\n\tname = Test\n\temail = t@example.com\n[commit]\n\tgpgsign = false\n`);

  return { home, bareDir };
}

function readBareManifest(bareDir, project) {
  const r = spawnSync('git', ['-C', bareDir, 'show', `main:${project}/manifest.json`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const fakePng = (label) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(label)]);

test('commit-covers writes a staged cover, pushes it, and the manifest cover field lands in the real remote', (t) => {
  const { home, bareDir } = makeCommitCoversHome(t, {
    'proj-a': { entries: [{ date: '2026-07-01', file: 'v0.1.0.md', version: 'v0.1.0', title: 'A', summary: 's', tags: [] }] },
  });
  const stagingDir = join(home, 'staging');
  mkdirSync(join(stagingDir, 'proj-a'), { recursive: true });
  writeFileSync(join(stagingDir, 'proj-a', 'v0.1.0.png'), fakePng('one'));

  const out = run(home, 'commit-covers', stagingDir);
  assert.equal(out.status, 0, out.stderr);
  const body = parse(out);
  assert.equal(body.ok, true);
  assert.deepEqual(body.written, ['proj-a/v0.1.0']);

  const manifest = readBareManifest(bareDir, 'proj-a');
  assert.deepEqual(manifest.entries[0].cover, { file: 'v0.1.0.png', bytes: fakePng('one').length });
});

test('commit-covers pre-filter skips an already-covered entry without --force', (t) => {
  const { home } = makeCommitCoversHome(t, {
    'proj-a': { entries: [{ date: '2026-07-01', file: 'v0.1.0.md', version: 'v0.1.0', title: 'A', summary: 's', tags: [], cover: { file: 'v0.1.0.png', bytes: 3 } }] },
  });
  const stagingDir = join(home, 'staging');
  mkdirSync(join(stagingDir, 'proj-a'), { recursive: true });
  writeFileSync(join(stagingDir, 'proj-a', 'v0.1.0.png'), fakePng('new'));

  const out = run(home, 'commit-covers', stagingDir);
  const body = parse(out);
  assert.deepEqual(body.skipped, ['proj-a/v0.1.0']);
  assert.deepEqual(body.written, []);
});

test('commit-covers --force <project>/<slug> overwrites only the named entry', (t) => {
  const { home, bareDir } = makeCommitCoversHome(t, {
    'proj-a': { entries: [{ date: '2026-07-01', file: 'v0.1.0.md', version: 'v0.1.0', title: 'A', summary: 's', tags: [], cover: { file: 'v0.1.0.png', bytes: 3 } }] },
  });
  const stagingDir = join(home, 'staging');
  mkdirSync(join(stagingDir, 'proj-a'), { recursive: true });
  writeFileSync(join(stagingDir, 'proj-a', 'v0.1.0.png'), fakePng('forced-new'));

  const out = run(home, 'commit-covers', stagingDir, '--force', 'proj-a/v0.1.0');
  const body = parse(out);
  assert.deepEqual(body.written, ['proj-a/v0.1.0']);
  const manifest = readBareManifest(bareDir, 'proj-a');
  assert.equal(manifest.entries[0].cover.bytes, fakePng('forced-new').length);
});

test('commit-covers reports a missing-manifest-row entry without aborting the rest of the run', (t) => {
  const { home, bareDir } = makeCommitCoversHome(t, {
    'proj-a': { entries: [{ date: '2026-07-01', file: 'v0.1.0.md', version: 'v0.1.0', title: 'A', summary: 's', tags: [] }] },
  });
  const stagingDir = join(home, 'staging');
  mkdirSync(join(stagingDir, 'proj-a'), { recursive: true });
  // v9.9.9 has no matching manifest row at all.
  writeFileSync(join(stagingDir, 'proj-a', 'v0.1.0.png'), fakePng('real'));
  writeFileSync(join(stagingDir, 'proj-a', 'v9.9.9.png'), fakePng('orphan'));

  const out = run(home, 'commit-covers', stagingDir);
  const body = parse(out);
  assert.deepEqual(body.written, ['proj-a/v0.1.0']);
  assert.deepEqual(body.missingManifest, ['proj-a/v9.9.9']);

  const manifest = readBareManifest(bareDir, 'proj-a');
  assert.equal(manifest.entries.length, 1); // the orphan never became a manifest row
});

test('commit-covers requires a staging-dir argument and rejects a nonexistent one', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'devlog-cli-commit-empty-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const missingArg = run(home, 'commit-covers');
  assert.equal(missingArg.status, 2);

  const configDir = join(home, '.claude', 'skills', 'devlog');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    targetRepo: 'me/daily-dev-log', branch: 'main', gitAuthor: 'T', githubUser: 'me', projects: [],
  }));
  const nonexistent = run(home, 'commit-covers', join(home, 'nope'));
  assert.equal(nonexistent.status, 1);
  assert.equal(parse(nonexistent).error, 'staging-dir-missing');
});
