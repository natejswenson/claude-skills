import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm, stat, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ATTACHMENT_LIMITS, validateAttachments, saveAttachments } from '../server/attachments.mjs';

const file = (name = 'notes.txt', bytes = Buffer.from('hello')) => ({ name, data: bytes.toString('base64') });
async function temporary(t) {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'studio-inputs-')));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('validates the full batch and rejects malformed payloads and unsafe display names', () => {
  assert.deepEqual(validateAttachments(), []);
  assert.equal(validateAttachments([file('研究 résumé.txt')])[0].name, '研究 résumé.txt');
  assert.equal(validateAttachments([file('empty.txt', Buffer.alloc(0))])[0].size, 0);
  for (const value of [null, {}, 'text', [null], [{ name: 'x' }], [{ data: '' }], [{ ...file(), path: 'x' }]]) {
    assert.throws(() => validateAttachments(value), { status: 400 });
  }
  for (const name of ['', '.', '..', '../private', 'x/y', 'x\\y', 'x\0y', 'x\ny', 'x\u007fy']) {
    assert.throws(() => validateAttachments([file(name)]), { status: 400 });
  }
  for (const data of [null, 123, 'a', 'a===', 'aG VsbG8=', 'aGVsbG8', 'aGVsbG8=\n', 'aGVsbG8_', 'Zh==', 'data:text/plain;base64,aGVsbG8=']) {
    assert.throws(() => validateAttachments([{ name: 'x.txt', data }]), { status: 400 });
  }
});

test('enforces count, per-file and aggregate byte limits before persistence', () => {
  assert.throws(() => validateAttachments(Array.from({ length: ATTACHMENT_LIMITS.maxFiles + 1 }, () => file())), { status: 413 });
  assert.throws(() => validateAttachments([file('large', Buffer.alloc(ATTACHMENT_LIMITS.maxFileBytes + 1))]), { status: 413 });
  const maximum = file('max.txt', Buffer.alloc(ATTACHMENT_LIMITS.maxFileBytes));
  assert.equal(validateAttachments([maximum])[0].size, ATTACHMENT_LIMITS.maxFileBytes);
  assert.throws(() => validateAttachments([maximum, maximum, file()]), { status: 413 });
});

test('recognizes native images only when extension and signature agree', () => {
  const examples = [
    ['photo.png', Buffer.from('89504e470d0a1a0a', 'hex')],
    ['photo.JPG', Buffer.from('ffd8ff', 'hex')],
    ['photo.jpeg', Buffer.from('ffd8ffe0', 'hex')],
    ['photo.gif', Buffer.from('GIF89a')],
    ['photo.webp', Buffer.from('RIFF0000WEBP')],
  ];
  for (const [name, bytes] of examples) assert.equal(validateAttachments([file(name, bytes)])[0].type, 'image');
  for (const [name, bytes] of [['fake.png', Buffer.from('plain text')], ['picture.txt', examples[0][1]], ['vector.svg', Buffer.from('<svg/>')]]) {
    assert.equal(validateAttachments([file(name, bytes)])[0].type, 'file');
  }
});

test('stores exact bytes privately with unique safe paths and immutable message batches', async t => {
  const root = await temporary(t);
  const run = randomUUID();
  const message = randomUUID();
  const bytes = Buffer.from([0, 255, 10, 128]);
  const inputs = validateAttachments([file('研究 résumé.txt', bytes), file('研究 résumé.txt', Buffer.from('second'))]);
  const saved = await saveAttachments(root, run, message, inputs);
  assert.equal(saved.length, 2);
  assert.notEqual(saved[0].id, saved[1].id);
  assert.notEqual(saved[0].file, saved[1].file);
  for (const [index, attachment] of saved.entries()) {
    assert.equal(attachment.name, '研究 résumé.txt');
    assert.match(attachment.file, new RegExp(`^inputs/${run}/${message}/[a-f0-9-]+\\.txt$`));
    const path = resolve(root, attachment.file);
    assert.deepEqual(await readFile(path), inputs[index].buffer);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
  for (const path of ['inputs', `inputs/${run}`, `inputs/${run}/${message}`]) {
    assert.equal((await stat(join(root, path))).mode & 0o777, 0o700);
  }
  await assert.rejects(saveAttachments(root, run, message, inputs));
  assert.deepEqual(await readFile(join(root, saved[0].file)), bytes);
  assert.deepEqual(await readdir(join(root, 'inputs', run)), [message]);
});

test('rejects unsafe path segments and symlink escapes without writing outside inputs', async t => {
  const root = await temporary(t);
  const outside = await temporary(t);
  for (const segment of ['..', '../outside', 'a/b', 'a\\b', '', 'x\0y']) {
    await assert.rejects(saveAttachments(root, segment, randomUUID(), validateAttachments([file()])));
    await assert.rejects(saveAttachments(root, randomUUID(), segment, validateAttachments([file()])));
  }
  await symlink(outside, join(root, 'inputs'));
  await assert.rejects(saveAttachments(root, randomUUID(), randomUUID(), validateAttachments([file()])), { status: 403 });
  assert.deepEqual(await readdir(outside), []);
});


test('a failed batch removes only its own partial files and keeps earlier messages', async t => {
  const root = await temporary(t);
  const run = randomUUID();
  const goodMessage = randomUUID();
  const saved = await saveAttachments(root, run, goodMessage, validateAttachments([file()]));
  const badMessage = randomUUID();
  const badBatch = [...validateAttachments([file()]), { name: 'bad.txt', size: 1, type: 'file', buffer: null }];
  await assert.rejects(saveAttachments(root, run, badMessage, badBatch));
  assert.deepEqual(await readdir(join(root, 'inputs', run)), [goodMessage]);
  assert.equal(await readFile(join(root, saved[0].file), 'utf8'), 'hello');
});

test('rejects an existing run directory symlink before creating message files', async t => {
  const root = await temporary(t);
  const outside = await temporary(t);
  await mkdir(join(root, 'inputs'));
  const run = randomUUID();
  await symlink(outside, join(root, 'inputs', run));
  await assert.rejects(saveAttachments(root, run, randomUUID(), validateAttachments([file()])), { status: 403 });
  assert.deepEqual(await readdir(outside), []);
});
