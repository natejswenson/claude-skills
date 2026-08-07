import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { readCatalog, readInstalled, readMarketplaces, findShadows } from '../lib/state.mjs';
import { classify, changeable, errored, renderCheck } from '../lib/report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..', '..');
const REPO = resolve(SKILL, '..', '..', '..', '..');
const FIXTURES = join(SKILL, 'evals', 'fixtures');

const installedFrom = (list) => readInstalled(list);
const mkt = (name = 'm') => ({ name, kind: 'directory', spec: './m', installLocation: '' });

// ---------------------------------------------------------------------------
// The corpus check. Deliberately a FLOOR, not a byte comparison: this runs
// against the live repo, and asserting exact versions here would turn every
// unrelated skill release into a red pluginsync build.
// ---------------------------------------------------------------------------
test('every plugin in this repo\'s real marketplace resolves to a version', () => {
  const catalog = readCatalog({ name: 'claude-skills', installLocation: REPO });
  assert.ok(catalog.ok, catalog.error ?? 'catalogue unreadable');

  // Anti-vacuity floor. A resolver that matches nothing would otherwise report
  // a clean, empty table — the exact failure mode this floor exists to catch.
  assert.ok(
    catalog.plugins.length >= 11,
    `only ${catalog.plugins.length} plugins resolved from the real marketplace — a resolver matching nothing must go red, not green`,
  );

  const manifest = JSON.parse(readFileSync(join(REPO, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.equal(catalog.plugins.length, manifest.plugins.length, 'resolver dropped a marketplace entry');

  for (const p of catalog.plugins) {
    assert.equal(p.error, null, `${p.name}: ${p.error}`);
    assert.match(p.available ?? '', /^\d+\.\d+\.\d+/, `${p.name} resolved to a non-version: ${p.available}`);
  }
});

// ---------------------------------------------------------------------------
// The `claude plugin list --json` shape guard. Both shapes are real, and an
// unrecognised one must throw — "nothing installed" and "I could not parse it"
// render identically, and the first tells you to reinstall everything.
// ---------------------------------------------------------------------------
test('both real plugin-list shapes parse, and a third throws', () => {
  const entry = { id: 'a@m', version: '1.0.0', scope: 'user', enabled: true };
  assert.equal(readInstalled([entry]).size, 1, 'bare array (plain --json) not handled');
  assert.equal(readInstalled({ installed: [entry] }).size, 1, '{installed} (--available --json) not handled');
  assert.throws(() => readInstalled({ plugins: [entry] }), /unrecognised/, 'an unknown shape read as empty instead of throwing');
  assert.throws(() => readInstalled(null), /unrecognised/);
});

test('an entry with no marketplace suffix is skipped, not half-parsed', () => {
  const m = readInstalled([{ id: 'no-marketplace', version: '1.0.0' }]);
  assert.equal(m.size, 0);
});

// ---------------------------------------------------------------------------
// Classification. The baseline golden only exercises `ok` and `install`,
// because that is what a real run of this machine produced; these cover the
// branches a real run happened not to contain.
// ---------------------------------------------------------------------------
test('classify covers every action', () => {
  const catalog = {
    plugins: [
      { name: 'same', available: '1.0.0', error: null },
      { name: 'drifted', available: '2.0.0', error: null },
      { name: 'missing', available: '1.0.0', error: null },
      { name: 'off', available: '1.0.0', error: null },
      { name: 'unreadable', available: null, error: 'no plugin.json under ./x' },
    ],
  };
  const installed = installedFrom([
    { id: 'same@m', version: '1.0.0', enabled: true },
    { id: 'drifted@m', version: '1.0.0', enabled: true },
    { id: 'off@m', version: '1.0.0', enabled: false },
    { id: 'gone@m', version: '0.1.0', enabled: true },
    { id: 'elsewhere@other', version: '9.9.9', enabled: true },
  ]);
  const rows = classify({ marketplace: mkt(), catalog, installed });
  const by = Object.fromEntries(rows.map((r) => [r.plugin, r.action]));

  assert.equal(by.same, 'ok');
  assert.equal(by.drifted, 'update');
  assert.equal(by.missing, 'install');
  assert.equal(by.off, 'disabled');
  assert.equal(by.unreadable, 'error');
  assert.equal(by.gone, 'orphan', 'an installed plugin no longer in the marketplace must surface, not vanish');
  assert.ok(!('elsewhere' in by), 'a plugin from another marketplace leaked into this report');
});

test('drift outranks disabled — an out-of-date disabled plugin still needs updating', () => {
  const rows = classify({
    marketplace: mkt(),
    catalog: { plugins: [{ name: 'x', available: '2.0.0', error: null }] },
    installed: installedFrom([{ id: 'x@m', version: '1.0.0', enabled: false }]),
  });
  assert.equal(rows[0].action, 'update');
});

// ---------------------------------------------------------------------------
// The one rule, as an assertion about the report itself.
// ---------------------------------------------------------------------------
test('the footer never says done without saying restart', () => {
  const text = renderCheck({
    marketplace: mkt('claude-skills'),
    rows: classify({
      marketplace: mkt('claude-skills'),
      catalog: { plugins: [{ name: 'x', available: '2.0.0', error: null }] },
      installed: installedFrom([{ id: 'x@claude-skills', version: '1.0.0', enabled: true }]),
    }),
    shadows: [],
  });
  assert.match(text, /restart Claude Code/, 'a report with pending changes must name the restart');
});

test('an unreadable source is never summarised as "everything matches"', () => {
  const rows = classify({
    marketplace: mkt(),
    catalog: { plugins: [{ name: 'ok-one', available: '1.0.0', error: null }, { name: 'bad', available: null, error: 'no plugin.json under ./bad' }] },
    installed: installedFrom([{ id: 'ok-one@m', version: '1.0.0', enabled: true }]),
  });
  const text = renderCheck({ marketplace: mkt(), rows, shadows: [] });
  assert.equal(errored(rows).length, 1);
  assert.equal(changeable(rows).length, 0);
  assert.doesNotMatch(text, /plugins match the marketplace/, 'an error row was summarised as a clean table');
  assert.match(text, /1 unreadable/);
});

// ---------------------------------------------------------------------------
// Shadowing: a stale ~/.claude/skills/<name>/SKILL.md wins over the plugin and
// no version number anywhere reveals it.
// ---------------------------------------------------------------------------
test('a shadowing personal skill is detected by its SKILL.md, not its directory', () => {
  // The fixture home has no skills/ dir at all, so nothing should be reported.
  assert.deepEqual(findShadows(join(FIXTURES, 'home'), ['eval', 'press']), []);
  // The skill's own tree does have scripts/, proving the probe looks for
  // SKILL.md specifically rather than for any directory of that name.
  assert.deepEqual(findShadows(SKILL, ['scripts']), []);
});

// ---------------------------------------------------------------------------
// No output may carry a machine-specific absolute path. Both artifacts are
// byte-compared in CI, and a resolved installLocation differs on every machine
// — this shipped once in report.json and was caught only by the runner.
// ---------------------------------------------------------------------------
test('neither artifact embeds a resolved absolute path', () => {
  const cli = join(SKILL, 'scripts', 'pluginsync.js');
  const args = ['check', '--no-fetch', '--home', join(FIXTURES, 'home'),
    '--installed-json', join(FIXTURES, 'installed.json')];

  const text = execFileSync('node', [cli, ...args], { encoding: 'utf8' });
  const json = execFileSync('node', [cli, ...args, '--json'], { encoding: 'utf8' });

  for (const [label, out] of [['text', text], ['json', json]]) {
    assert.doesNotMatch(out, new RegExp(SKILL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `${label} output embeds this checkout's absolute path — it cannot be byte-compared on another machine`);
    assert.doesNotMatch(out, /"installLocation"/, `${label} output exposes the resolved install location`);
  }
  // ...but the source spec, which IS machine-independent, must survive.
  assert.match(text, /→ \.\/marketplace \(directory\)/);
  assert.equal(JSON.parse(json).marketplace.spec, './marketplace');
});

// ---------------------------------------------------------------------------
// --home redirects reads only; apply always writes through the real CLI.
// ---------------------------------------------------------------------------
test('apply refuses a fixture home rather than writing to the real install', () => {
  const cli = join(SKILL, 'scripts', 'pluginsync.js');
  let caught = null;
  try {
    execFileSync('node', [cli, 'apply', '--no-fetch', '--home', join(FIXTURES, 'home'),
      '--installed-json', join(FIXTURES, 'installed.json')], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'apply accepted --home — it would have written to the real install');
  assert.match(String(caught.stderr), /apply refuses --home/);
});

// ---------------------------------------------------------------------------
// Fixture-home wiring: relative install locations must resolve against the home
// dir, or the frozen fixtures only work in one checkout.
// ---------------------------------------------------------------------------
test('a relative installLocation resolves against the home dir', () => {
  const [m] = readMarketplaces(join(FIXTURES, 'home'));
  assert.equal(m.name, 'claude-skills');
  assert.equal(m.spec, './marketplace', 'the printed source must stay verbatim, or the golden is machine-specific');
  assert.ok(m.installLocation.startsWith(FIXTURES), 'relative installLocation did not resolve against home');
  assert.ok(readCatalog(m).plugins.length >= 11);
});
