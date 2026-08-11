import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'brandreport.js');

const run = (args, opts = {}) => {
  try {
    return { code: 0, out: execFileSync('node', [CLI, ...args], { encoding: 'utf8', ...opts }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

function makeRun() {
  const base = mkdtempSync(join(tmpdir(), 'brandreport-'));
  const dir = join(base, 'run');
  assert.equal(run(['init', '--subject', 'Test Subject', '--out', dir]).code, 0);
  const artifact = join(base, 'profile.md');
  writeFileSync(artifact, '# a fetched profile page\n');
  return { base, dir, artifact };
}

test('init refuses to clobber an existing run', () => {
  const { dir } = makeRun();
  const again = run(['init', '--subject', 'Test Subject', '--out', dir]);
  assert.equal(again.code, 1);
  assert.match(again.out, /already holds a run/);
});

test('add requires corroboration for confirmed and why for unconfirmed', () => {
  const { dir, artifact } = makeRun();
  const bare = run(['add', '--run', dir, '--file', artifact, '--url', 'https://example.com/p', '--kind', 'profile', '--status', 'confirmed']);
  assert.equal(bare.code, 1);
  assert.match(bare.out, /--corroboration is required/);
  const noWhy = run(['add', '--run', dir, '--file', artifact, '--url', 'https://example.com/q', '--kind', 'mention', '--status', 'unconfirmed']);
  assert.equal(noWhy.code, 1);
  assert.match(noWhy.out, /--why is required/);
});

test('a clean run passes the gate and renders every section', () => {
  const { dir, artifact } = makeRun();
  assert.equal(run(['add', '--run', dir, '--file', artifact, '--url', 'https://example.com/me', '--kind', 'profile',
    '--status', 'confirmed', '--corroboration', 'bio links to the anchor site', '--fetched-at', '2026-08-11T00:00:00Z']).code, 0);
  assert.equal(run(['add', '--run', dir, '--file', artifact, '--url', 'https://example.com/other', '--kind', 'mention',
    '--status', 'unconfirmed', '--why', 'different field, no shared handle', '--fetched-at', '2026-08-11T00:00:00Z']).code, 0);
  writeFileSync(join(dir, 'findings.json'), JSON.stringify({
    subject: 'Test Subject',
    claims: [{ id: 'c1', text: 'Maintains a profile.', sources: ['s1'] }],
    read: { themes: [{ name: 'Consistency', text: 'One handle everywhere.', sources: ['s1'] }], gaps: ['No personal site.'], summary: 'Small but coherent.' },
    unconfirmed: [{ note: 'A same-name stranger.', sources: ['s2'] }],
  }, null, 2));
  assert.equal(run(['gate', '--run', dir]).code, 0);
  const report = run(['report', '--run', dir]);
  assert.equal(report.code, 0);
  const html = readFileSync(join(dir, 'report.html'), 'utf8');
  for (const s of ['Where you were found', 'The confirmed presence', 'The read', 'Same name, not you']) {
    assert.ok(html.includes(s), `section "${s}" missing from the report`);
  }
  assert.match(html, /corpus as of 2026-08-11/);
});

test('the gate is two-sided: dangling and unconfirmed citations both fail, and report refuses', () => {
  const { dir, artifact } = makeRun();
  assert.equal(run(['add', '--run', dir, '--file', artifact, '--url', 'https://example.com/other', '--kind', 'mention',
    '--status', 'unconfirmed', '--why', 'no tie']).code, 0);
  // one claim cites a snapshot that does not exist; another attributes the unconfirmed one
  writeFileSync(join(dir, 'findings.json'), JSON.stringify({
    subject: 'Test Subject',
    claims: [
      { id: 'c1', text: 'Cites a ghost.', sources: ['s99'] },
      { id: 'c2', text: 'Attributes a stranger.', sources: ['s1'] },
    ],
    read: { themes: [], gaps: [], summary: '' },
    unconfirmed: [{ note: 'listed', sources: ['s1'] }],
  }, null, 2));
  const gate = run(['gate', '--run', dir]);
  assert.equal(gate.code, 1);
  assert.match(gate.out, /s99, which is not in the corpus/);
  assert.match(gate.out, /unverified content must not be attributed/);
  const report = run(['report', '--run', dir]);
  assert.equal(report.code, 1);
  assert.ok(!existsSync(join(dir, 'report.html')), 'report must not render over a dirty gate');
});

test('sweep emits a probe row per platform per handle and needs no run', () => {
  const one = run(['sweep', '--handle', 'somebody']);
  assert.equal(one.code, 0);
  for (const platform of ['x.com', 'linkedin.com', 'github.com', 'instagram.com']) {
    assert.ok(one.out.includes(platform), `sweep lost its ${platform} row`);
  }
  assert.match(one.out, /x\.com\/somebody/);
  assert.match(one.out, /200 with an empty body proves nothing/);
  const two = run(['sweep', '--handle', 'somebody,somebody-else']);
  assert.match(two.out, /linkedin\.com\/in\/somebody-else/);
  assert.equal(run(['sweep']).code, 1, 'sweep without --handle must refuse');
});

test('an existence-only snapshot is marked in status and in the report', () => {
  const { dir, artifact } = makeRun();
  assert.equal(run(['add', '--run', dir, '--file', artifact, '--url', 'https://example.com/me', '--kind', 'profile',
    '--status', 'confirmed', '--corroboration', 'anchor cross-link', '--existence-only', '--fetched-at', '2026-08-11T00:00:00Z']).code, 0);
  assert.match(run(['status', '--run', dir]).out, /profile \(existence-only\)/);
  writeFileSync(join(dir, 'findings.json'), JSON.stringify({
    subject: 'Test Subject',
    claims: [{ id: 'c1', text: 'The account exists.', sources: ['s1'] }],
    read: { themes: [], gaps: [], summary: '' },
    unconfirmed: [],
  }, null, 2));
  assert.equal(run(['report', '--run', dir]).code, 0);
  assert.match(readFileSync(join(dir, 'report.html'), 'utf8'), /existence-only/);
});

test('add --id refreshes a snapshot in place and never flips its status', () => {
  const { dir, artifact, base } = makeRun();
  assert.equal(run(['add', '--run', dir, '--file', artifact, '--url', 'https://example.com/me', '--kind', 'profile',
    '--status', 'confirmed', '--corroboration', 'original tie']).code, 0);
  const updated = join(base, 'updated.md');
  writeFileSync(updated, '# the profile, re-fetched with new fields\n');
  const refresh = run(['add', '--run', dir, '--id', 's1', '--file', updated, '--url', 'https://example.com/me', '--kind', 'profile',
    '--status', 'confirmed', '--corroboration', 'stronger tie after the profile update']);
  assert.equal(refresh.code, 0);
  const metas = readFileSync(join(dir, 'snapshots', 's1.meta.json'), 'utf8');
  assert.match(metas, /stronger tie/);
  assert.match(readFileSync(join(dir, 'snapshots', 's1.md'), 'utf8'), /re-fetched/);
  const next = run(['add', '--run', dir, '--file', artifact, '--url', 'https://example.com/two', '--kind', 'mention',
    '--status', 'unconfirmed', '--why', 'no tie']);
  assert.equal(next.code, 0);
  assert.match(next.out, /\bs2\b/, 'a refresh must not advance the id counter');
  const flip = run(['add', '--run', dir, '--id', 's2', '--file', artifact, '--url', 'https://example.com/two', '--kind', 'mention',
    '--status', 'confirmed', '--corroboration', 'suddenly sure']);
  assert.equal(flip.code, 1);
  assert.match(flip.out, /refusing to flip status/);
  const ghost = run(['add', '--run', dir, '--id', 's99', '--file', artifact, '--url', 'https://example.com/x', '--kind', 'mention',
    '--status', 'unconfirmed', '--why', 'n/a']);
  assert.equal(ghost.code, 1);
  assert.match(ghost.out, /no such snapshot to refresh/);
});

test('an unconfirmed snapshot missing from the residue section fails the gate', () => {
  const { dir, artifact } = makeRun();
  assert.equal(run(['add', '--run', dir, '--file', artifact, '--url', 'https://example.com/other', '--kind', 'mention',
    '--status', 'unconfirmed', '--why', 'no tie']).code, 0);
  writeFileSync(join(dir, 'findings.json'), JSON.stringify({
    subject: 'Test Subject',
    claims: [],
    read: { themes: [], gaps: [], summary: '' },
    unconfirmed: [],
  }, null, 2));
  const gate = run(['gate', '--run', dir]);
  assert.equal(gate.code, 1);
  assert.match(gate.out, /never silently dropped/);
});
