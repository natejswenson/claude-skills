import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, stat, truncate, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.mjs';
import { validateLocalRequest, resolveArtifact } from '../server/security.mjs';

async function temporary(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'studio-security-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const allowedHosts = ['127.0.0.1:3210', 'localhost:3210', 'localhost:5173', '127.0.0.1:5173'];
const request = headers => ({ headers });

test('accepts same-origin local requests and configured Vite origins', () => {
  for (const host of allowedHosts) {
    assert.doesNotThrow(() => validateLocalRequest(request({ host }), allowedHosts));
    assert.doesNotThrow(() => validateLocalRequest(request({ host: '127.0.0.1:3210', origin: `http://${host}`, 'sec-fetch-site': 'same-site' }), allowedHosts));
  }
});

test('rejects unrecognized Host, Origin and browser cross-site requests', () => {
  const cases = [
    {}, { host: 'attacker.example' }, { host: 'localhost:3210.attacker.example' },
    { host: 'localhost:3210', origin: 'https://localhost:3210' },
    { host: 'localhost:3210', origin: 'http://localhost:3210.attacker.example' },
    { host: 'localhost:3210', origin: 'null' },
    { host: 'localhost:3210', origin: 'http://localhost:3210/' },
    { host: 'localhost:3210', 'sec-fetch-site': 'cross-site' },
  ];
  for (const headers of cases) {
    assert.throws(() => validateLocalRequest(request(headers), allowedHosts), { status: 403 });
  }
});

test('resolves real files within artifact root', async t => {
  const directory = await temporary(t);
  const root = join(directory, 'artifacts');
  await mkdir(root);
  await writeFile(join(root, 'report.md'), 'hello');
  assert.deepEqual(await resolveArtifact(root, 'report.md'), { path: join(root, 'report.md'), size: 5 });
  assert.deepEqual(await resolveArtifact(root, join(root, 'report.md')), { path: join(root, 'report.md'), size: 5 });
});

test('rejects traversal, sibling prefixes and symlinks outside artifact root', async t => {
  const directory = await temporary(t);
  const root = join(directory, 'artifacts');
  await mkdir(root);
  await mkdir(join(directory, 'artifacts-other'));
  await writeFile(join(directory, 'secret'), 'private');
  await writeFile(join(directory, 'artifacts-other', 'secret'), 'private');
  await symlink(join(directory, 'secret'), join(root, 'shortcut'));
  for (const path of ['../secret', '../artifacts-other/secret', join(directory, 'secret'), 'shortcut']) {
    await assert.rejects(resolveArtifact(root, path), { status: 403 });
  }
});

test('rejects directories, missing files and artifacts exceeding the preview limit', async t => {
  const directory = await temporary(t);
  await assert.rejects(resolveArtifact(directory, '.'), { status: 404 });
  await assert.rejects(resolveArtifact(directory, 'missing'), { status: 404 });
  const large = join(directory, 'large');
  await writeFile(large, '');
  await truncate(large, 10 * 1024 * 1024 + 1);
  await assert.rejects(resolveArtifact(directory, 'large'), { status: 413 });
});

test('persists full runs, replaces updates atomically and lists most recently updated first', async t => {
  const directory = await temporary(t);
  const path = join(directory, 'private', 'runs.sqlite');
  const first = new Store(path);
  first.save({ id: 'older', updatedAt: '2026-10-17T00:00:00Z', status: 'completed', messages: [{ text: 'Saved output' }] });
  first.save({ id: 'newer', updatedAt: '2026-10-17T02:00:00Z', status: 'completed', pending: [] });
  first.save({ id: 'older', updatedAt: '2026-10-17T01:00:00Z', status: 'completed', messages: [{ text: 'Revised output' }] });
  first.close();
  const reopened = new Store(path);
  t.after(() => reopened.close());
  assert.deepEqual(reopened.list().map(run => run.id), ['newer', 'older']);
  assert.equal(reopened.get('older').messages[0].text, 'Revised output');
  assert.equal(reopened.get('absent'), undefined);
  assert.equal((await stat(join(directory, 'private'))).mode & 0o777, 0o700);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('restart marks unfinished runs interrupted and removes stale approval requests', async t => {
  const directory = await temporary(t);
  const path = join(directory, 'runs.sqlite');
  const first = new Store(path);
  for (const status of ['working', 'approval_needed', 'awaiting_input', 'completed', 'failed', 'stopped']) {
    first.save({ id: status, status, updatedAt: '2026-10-16T00:00:00Z', threadId: `thread-${status}`, pending: [{ id: 17 }] });
  }
  first.close();
  const reopened = new Store(path);
  t.after(() => reopened.close());
  for (const status of ['working', 'approval_needed', 'awaiting_input']) {
    const run = reopened.get(status);
    assert.equal(run.status, 'interrupted');
    assert.deepEqual(run.pending, []);
    assert.match(run.error, /Backend restarted/);
    assert.equal(run.threadId, `thread-${status}`);
  }
  for (const status of ['completed', 'failed', 'stopped']) assert.equal(reopened.get(status).status, status);
});
