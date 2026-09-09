import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { publishEntry, addCoverToExistingEntry, tombstoneEntry } from '../lib/publish_entry.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const bin = join(root, 'bin/devlog.js');
const article = join(root, 'tests/fixtures/guide/import-safe-cli.md');
const brand = join(root, 'tests/fixtures/guide/press-tokens.json');
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'devlog-draft-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function command(executable, args, cwd) {
  const r = spawnSync(executable, args, { cwd, encoding: 'utf8', timeout: 60000 });
  assert.ifError(r.error);
  assert.equal(r.signal, null);
  return r;
}
function cli(args, cwd, entry = bin) {
  const r = command(process.execPath, [entry, ...args], cwd);
  return { status: r.status, json: JSON.parse(r.stdout), stderr: r.stderr };
}

test('draft CLI validates flags and preserves detailed lint findings', t => {
  const dir = scratch(t);
  for (const name of ['lint-guide', 'prepare-guide', 'compose-art-cover', 'publish-guide']) {
    const invalid = cli([name, '--unknown'], dir);
    assert.equal(invalid.status, 2);
    assert.equal(invalid.json.error, 'bad-flag');
    assert.notEqual(cli([name], dir).status, 0);
  }
  assert.equal(cli(['lint-guide', article, '--voice'], dir).json.ok, true);
  const bad = join(dir, 'v0.5.1.md');
  writeFileSync(bad, readFileSync(article, 'utf8').replace('<!-- agent-handoff:start -->', ''));
  const legacy = cli(['lint-post', bad], dir);
  assert.equal(legacy.json.ok, true, 'legacy lint must not start requiring a guide handoff');
  const rejected = cli(['prepare-guide', '--article', bad, '--brand', brand, '--out', join(dir, 'bad-output')], dir);
  assert.equal(rejected.status, 1);
  assert.equal(rejected.json.error, 'GUIDE_LINT');
  assert.ok(rejected.json.findings.some(f => f.rule === 'guide-handoff-markers'));
  assert.equal(existsSync(join(dir, 'bad-output')), false);
});

test('packed package includes references and helpers operate from an unrelated cwd', t => {
  const dir = scratch(t);
  const packed = command('npm', ['pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', dir, '--cache', join(dir, 'cache')], root);
  assert.equal(packed.status, 0, packed.stderr);
  const filename = JSON.parse(packed.stdout)[0].filename;
  const extracted = join(dir, 'extracted'); mkdirSync(extracted);
  const unpack = command('tar', ['-xzf', join(dir, filename), '-C', extracted], dir);
  assert.equal(unpack.status, 0, unpack.stderr);
  const packageRoot = join(extracted, 'package');
  for (const resource of ['concept-guides.md', 'codex-cover-art.md', 'cover-spec.md', 'guide-publishing.md']) {
    assert.ok(readFileSync(join(packageRoot, 'references', resource), 'utf8').length > 100);
  }
  // Reuse the already installed dependencies; this test never fetches packages.
  symlinkSync(join(root, 'node_modules'), join(packageRoot, 'node_modules'), 'dir');
  const foreign = join(dir, 'foreign'); mkdirSync(foreign);
  const output = join(dir, 'preview');
  const result = cli(['prepare-guide', '--article', article, '--brand', brand, '--out', output], foreign, join(packageRoot, 'bin/devlog.js'));
  assert.equal(result.status, 0, JSON.stringify(result.json));
  assert.equal(result.json.status, 'local-draft');
  assert.equal(existsSync(join(foreign, 'config.json')), false);
  assert.ok(readFileSync(join(output, 'agent-prompt.txt'), 'utf8').includes('<reference-guide>'));
  const again = cli(['prepare-guide', '--article', article, '--brand', brand, '--out', output], foreign, join(packageRoot, 'bin/devlog.js'));
  assert.equal(again.status, 1); assert.equal(again.json.error, 'EEXIST');
});

test('new art CLI output works with unchanged publication and explicit replacement contracts', async t => {
  const dir = scratch(t);
  await sharp({ create: { width: 240, height: 160, channels: 3, background: 'white' } }).png().toFile(join(dir, 'source.png'));
  writeFileSync(join(dir, 'spec.json'), JSON.stringify({ schema: 1, source: 'source.png', brand, title: 'Preserve the public contract' }));
  const out = join(dir, 'cover-attempt');
  const composed = cli(['compose-art-cover', '--spec', join(dir, 'spec.json'), '--out', out], dir);
  assert.equal(composed.status, 0, JSON.stringify(composed.json));
  assert.equal(composed.json.visualReview, 'pending');
  const png = readFileSync(join(out, 'cover.png'));
  const clone = join(dir, 'content'); mkdirSync(clone);
  publishEntry({ cloneDir: clone, project: 'devlog', version: 'v0.5.1', entryPath: article, coverImageBuffer: png });
  const manifestPath = join(clone, 'devlog/manifest.json');
  const before = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(before.entries[0].cover.bytes, png.length);
  assert.deepEqual(readFileSync(join(clone, 'devlog/v0.5.1.png')), png);
  assert.throws(() => publishEntry({ cloneDir: clone, project: 'devlog', version: 'v0.5.1', entryPath: article, coverImageBuffer: png }), /immutable/);
  const replacement = await sharp(png).flop().png().toBuffer();
  addCoverToExistingEntry({ cloneDir: clone, project: 'devlog', slug: 'v0.5.1', coverImageBuffer: replacement, force: true });
  const after = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const withoutCover = entry => { const { cover, ...rest } = entry; return rest; };
  assert.deepEqual(after.entries.map(withoutCover), before.entries.map(withoutCover));
  assert.deepEqual(readFileSync(join(clone, 'devlog/v0.5.1.md')), readFileSync(article));
  tombstoneEntry({ cloneDir: clone, project: 'devlog', version: 'v0.5.2', reason: 'already retired' });
  assert.throws(() => publishEntry({ cloneDir: clone, project: 'devlog', version: 'v0.5.2', entryPath: article, coverImageBuffer: png }), /tombstoned/);
});
