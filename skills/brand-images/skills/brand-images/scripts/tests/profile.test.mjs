import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const HERE = dirname(fileURLToPath(import.meta.url));
import { execute, parse } from '../brand-images.js';

const STYLE = { anchors: { medium: 'Ink illustration', palette: ['warm paper', 'ink'], signature: 'Flat layered silhouettes' },
  preferences: { texture: 'Paper grain', avoid: ['neon'] } };
// A real decodable one-pixel PNG, used only for deterministic persistence tests.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH3sAAAAASUVORK5CYII=', 'base64');
const CHECKS = Object.fromEntries(['medium','palette','signature','lighting','texture','composition','typography','avoid','subject'].map(k => [k, 'pass']));
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'brand-images-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'store');
  const file = (name, value) => { const path = join(dir, name); writeFileSync(path, JSON.stringify(value)); return path; };
  const from = file('profile.json', { style: STYLE, references: [] });
  const image = join(dir, 'image.png'); writeFileSync(image, PNG);
  const review = file('review.json', { inspected: true, checks: CHECKS, notes: 'Unit test image; not a visual brand evaluation.' });
  const run = (command, args = {}) => execute(command, { home, profile: 'test', ...args });
  const stateFile = join(home, 'profiles', 'test', 'state.json');
  const init = extra => run('profile', { action: 'init', from, source: 'Test setup', ...extra });
  const generated = () => {
    init();
    run('brief', { run: 'first', from: file('request.json', { subject: 'A mountain' }) });
    run('run', { run: 'first', status: 'generated', image, backend: 'offline-test', review });
  };
  const feedback = extra => run('feedback', { run: 'first', event: 'event-one', scope: 'durable', text: 'Always rougher texture', source: 'Explicit test input', expect: 1, confirm: true,
    patch: file('patch.json', { preferences: { texture: 'Rough paper grain' } }), ...extra });
  return { dir, home, file, image, review, run, stateFile, init, generated, feedback };
}
test('draft initialization and approved initialization are explicit, overwrite refused', t => {
  const s = setup(t); assert.equal(s.init().status, 'draft');
  assert.throws(() => s.init(), /already exists/);
  assert.equal(s.run('profile', { action: 'init', profile: 'approved', from: s.file('second.json', { style: STYLE }), source: 'User approved exact style', confirm: true }).status, 'approved');
});
test('brief preserves anchors and keeps one-off adjustments in that run', t => {
  const s = setup(t); s.init();
  const before = readFileSync(s.stateFile, 'utf8');
  const a = s.run('brief', { run: 'one', from: s.file('request.json', { subject: 'A bicycle', oneOff: 'Use more texture in this one' }) });
  const b = s.run('brief', { run: 'two', from: s.file('next.json', { subject: 'A boat' }) });
  assert.match(a.prompt, /more texture/); assert.doesNotMatch(b.prompt, /more texture/);
  assert.equal(a.profileHash, b.profileHash);
  assert.deepEqual(JSON.parse(readFileSync(s.stateFile)).revisions, JSON.parse(before).revisions);
});
test('image approval and candidate feedback do not change the style', t => {
  const s = setup(t); s.generated();
  for (const scope of ['image', 'candidate', 'approval']) s.run('feedback', { run: 'first', scope, text: 'I like it', source: 'Test user feedback', confirm: true });
  const history = s.run('history'); assert.equal(history.current, 1); assert.equal(history.runs[0].status, 'approved');
  assert.equal(history.revisions[0].status, 'draft'); assert.deepEqual(history.revisions[0].references, []);
});
test('durable feedback requires explicit confirmation and current revision', t => {
  const s = setup(t); s.generated(); const before = readFileSync(s.stateFile, 'utf8');
  assert.throws(() => s.feedback({ confirm: false }), /confirmation/);
  assert.throws(() => s.feedback({ expect: 9 }), /stale/);
  assert.equal(readFileSync(s.stateFile, 'utf8'), before);
  assert.equal(s.feedback().revision, 2); assert.equal(s.run('profile').style.preferences.texture, 'Rough paper grain');
  assert.equal(s.run('history').revisions[0].style.preferences.texture, 'Paper grain');
});
test('feedback retries with the same event are idempotent; changed retries fail', t => {
  const s = setup(t); s.generated(); s.feedback();
  assert.equal(s.feedback().alreadyRecorded, true);
  assert.equal(s.run('history').feedback.length, 1);
  assert.throws(() => s.feedback({ text: 'Changed request' }), /different request/);
});
test('subject leakage and implicit anchor changes fail without replacing state', t => {
  const s = setup(t); s.generated();
  assert.throws(() => s.feedback({ patch: s.file('bad.json', { preferences: { subject: 'Mountains forever' } }) }), /unknown fields/);
  const anchor = s.file('anchors.json', { anchors: { palette: ['red', 'blue'] } });
  assert.throws(() => s.feedback({ patch: anchor }), /rebrand/);
  assert.equal(s.feedback({ patch: anchor, rebrand: true }).revision, 2);
});
test('only durable feedback may carry style mutations', t => {
  const s = setup(t); s.generated();
  for (const scope of ['image', 'candidate', 'approval']) assert.throws(() => s.feedback({ scope }), /only confirmed durable/);
});
test('approving a reference requires inspection and user confirmation', t => {
  const s = setup(t); s.generated();
  assert.throws(() => s.feedback({ patch: undefined, approveImage: true, confirm: false }), /confirmation/);
  assert.equal(s.feedback({ patch: undefined, approveImage: true }).references.length, 1);
  const shown = s.run('profile'); assert.equal(shown.status, 'approved');
  assert.ok(shown.referencePaths[0].startsWith(s.home));
  rmSync(s.image); assert.equal(s.run('validate').ok, true);
});
test('uninspected and drifting images cannot establish a brand reference', t => {
  const s = setup(t); s.init();
  s.run('brief', { run: 'first', from: s.file('request.json', { subject: 'A mountain' }) });
  const review = s.file('unverified.json', { inspected: false, checks: Object.fromEntries(Object.keys(CHECKS).map(k => [k, 'unverified'])), notes: 'No viewer available' });
  s.run('run', { run: 'first', status: 'generated', image: s.image, backend: 'test', review });
  assert.throws(() => s.feedback({ patch: undefined, approveImage: true }), /visual checks/);
});
test('false visual claims are rejected before committing a generated run', t => {
  const s = setup(t); s.init();
  s.run('brief', { run: 'first', from: s.file('request.json', { subject: 'A mountain' }) });
  assert.throws(() => s.run('run', { run: 'first', status: 'generated', image: s.image, backend: 'test', review: s.file('lie.json', { inspected: false, checks: CHECKS, notes: 'Not inspected' }) }), /uninspected/);
  assert.equal(s.run('history').runs[0].status, 'planned');
});
test('run transitions preserve failure and reject feedback on nonexistent output', t => {
  const s = setup(t); s.init();
  s.run('brief', { run: 'first', from: s.file('request.json', { subject: 'A mountain' }) });
  s.run('run', { run: 'first', status: 'failed', reason: 'Backend unavailable' });
  assert.throws(() => s.feedback(), /actual generated/);
  assert.throws(() => s.run('run', { run: 'first', status: 'generated', image: s.image, backend: 'test', review: s.review }), /transition/);
});
test('a rejected image cannot become an approved reference or approve style', t => {
  const s = setup(t); s.generated();
  s.run('feedback', { run: 'first', scope: 'rejection', text: 'Wrong look', source: 'Explicit rejection', confirm: true });
  assert.throws(() => s.feedback({ patch: undefined, approveStyle: true }), /rejected/);
  assert.throws(() => s.feedback({ patch: undefined, approveImage: true }), /rejected/);
});
test('rollback appends a revision while preserving feedback and original run', t => {
  const s = setup(t); s.generated(); s.feedback();
  const restored = s.run('rollback', { revision: 1, expect: 2, confirm: true, source: 'Explicit rollback request' });
  assert.equal(restored.revision, 3); assert.equal(restored.restoredFrom, 1);
  assert.equal(s.run('profile').style.preferences.texture, 'Paper grain');
  assert.equal(s.run('history').feedback.length, 1); assert.equal(s.run('history').runs[0].revision, 1);
});
test('cross-profile run lookup and traversal slugs fail', t => {
  const s = setup(t); s.generated(); s.init({ profile: 'other' });
  assert.throws(() => s.feedback({ profile: 'other' }), /run not found/);
  assert.throws(() => s.run('history', { profile: '../test' }), /invalid --profile/);
});
test('missing and changed saved artifacts fail validation', t => {
  const s = setup(t); s.generated(); const h = s.run('history');
  const saved = join(s.home, 'profiles', 'test', h.runs[0].artifact.path);
  writeFileSync(saved, Buffer.concat([PNG, Buffer.from('tamper')]));
  assert.throws(() => s.run('validate'), /changed/);
  rmSync(saved); assert.throws(() => s.run('validate'), /ENOENT/);
});
test('mismatched revision receipt and profile identity fail', t => {
  const s = setup(t); s.generated(); const h = s.run('history'); h.runs[0].profileHash = 'bad';
  writeFileSync(s.stateFile, JSON.stringify(h)); assert.throws(() => s.run('validate'), /revision mismatch/);
  h.profile = 'other'; writeFileSync(s.stateFile, JSON.stringify(h)); assert.throws(() => s.run('validate'), /identity mismatch/);
});
test('corrupt profile revision fails without falling back to defaults', t => {
  const s = setup(t); s.init(); const h = s.run('history'); h.revisions[0].style.anchors.medium = 'Changed by hand';
  writeFileSync(s.stateFile, JSON.stringify(h)); assert.throws(() => s.run('profile'), /checksum/);
});
test('locks prevent overlapping mutation and symlinks prevent redirected stores', t => {
  const s = setup(t); s.init();
  writeFileSync(join(s.home, 'profiles', 'test', '.lock'), 'another writer');
  assert.throws(() => s.run('brief', { from: s.file('request.json', { subject: 'test' }) }), /locked/);
  const link = join(s.dir, 'redirect'); symlinkSync(s.home, link);
  assert.throws(() => execute('history', { home: link, profile: 'test' }), /symlink/);
});
test('initial references require approval and unsupported images fail', t => {
  const s = setup(t); const from = s.file('refs.json', { style: STYLE, references: [s.image] });
  assert.throws(() => s.init({ from }), /explicit approval/);
  assert.equal(s.init({ from, confirm: true }).references.length, 1);
  const bad = join(s.dir, 'not-image.png'); writeFileSync(bad, 'not an image');
  assert.throws(() => s.init({ profile: 'bad-image', from: s.file('bad-refs.json', { style: STYLE, references: [bad] }), confirm: true }), /PNG or JPEG/);
});
test('parser rejects unknown flags, missing values and unexpected arguments', () => {
  assert.equal(parse(['feedback', '--confirm']).confirm, true);
  assert.throws(() => parse(['profile', '--confim']), /unknown/);
  assert.throws(() => parse(['brief', '--from']), /missing value/);
  assert.throws(() => parse(['brief', 'extra']), /unexpected action/);
});

test('the frozen trap reaches revision validation, not argument parsing', () => {
  const result = spawnSync(process.execPath, [join(HERE, '../replay.mjs'), '--trap'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /run profile revision mismatch/);
});
test('CLI resolves bundled files outside the plugin cwd', t => {
  const s = setup(t);
  const result = spawnSync(process.execPath, [join(HERE, '../brand-images.js'), '--version'], { cwd: s.dir, encoding: 'utf8' });
  assert.equal(result.status, 0); assert.equal(result.stdout.trim(), '0.1.0');
});
