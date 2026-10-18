import { randomUUID } from 'node:crypto';
import { mkdir, lstat, realpath, writeFile, rm } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

export const ATTACHMENT_LIMITS = Object.freeze({
  maxFiles: 5,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  maxRequestBytes: Math.ceil(20 * 1024 * 1024 / 3) * 4 + 200 * 1024,
});
const invalid = (message, status = 400) => Object.assign(new Error(message), { status });
const invalidBase64Character = /[^A-Za-z0-9+/=]/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function imageType(name, buffer) {
  switch (extname(name).toLowerCase()) {
    case '.png': return buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    case '.jpg':
    case '.jpeg': return buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
    case '.gif': return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
    case '.webp': return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    default: return false;
  }
}

export function validateAttachments(value = []) {
  if (!Array.isArray(value)) throw invalid('Attachments must be a list.');
  if (value.length > ATTACHMENT_LIMITS.maxFiles) throw invalid('Attach at most 5 files per message.', 413);
  let total = 0;
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['name', 'data'].includes(key))) {
      throw invalid('Each attachment must contain only a name and base64 data.');
    }
    const { name, data } = item;
    if (typeof name !== 'string' || !name.trim() || name === '.' || name === '..' || /[/\\\x00-\x1f\x7f-\x9f]/.test(name)) {
      throw invalid('Attachment names cannot contain paths or control characters.');
    }
    if (typeof data !== 'string') throw invalid('Attachment data must be raw base64.');
    // Check encoded length before allocating a decoded buffer.
    if (data.length > Math.ceil(ATTACHMENT_LIMITS.maxFileBytes / 3) * 4) throw invalid('Each attachment must be 10 MiB or smaller.', 413);
    if (data.length % 4 || invalidBase64Character.test(data) || (data.includes('=') && !/^={1,2}$/.test(data.slice(data.indexOf('='))))) throw invalid('Attachment data must be valid base64.');
    const size = data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    if (size > ATTACHMENT_LIMITS.maxFileBytes) throw invalid('Each attachment must be 10 MiB or smaller.', 413);
    total += size;
    if (total > ATTACHMENT_LIMITS.maxTotalBytes) throw invalid('Attachments must total 20 MiB or less per message.', 413);
    const buffer = Buffer.from(data, 'base64');
    if (buffer.toString('base64') !== data) throw invalid('Attachment data must be valid base64.');
    return { name, size, buffer, type: imageType(name, buffer) ? 'image' : 'file' };
  });
}

async function privateDirectory(path) {
  await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw invalid('Attachment directory must be a real local directory.', 403);
}

export async function saveAttachments(dataDir, runId, messageId, validatedFiles) {
  if (!uuid.test(runId) || !uuid.test(messageId)) throw invalid('Invalid attachment run or message identifier.');
  if (!validatedFiles.length) return [];
  const root = await realpath(dataDir);
  const inputs = join(root, 'inputs');
  const run = join(inputs, runId);
  const message = join(run, messageId);
  await privateDirectory(inputs);
  await privateDirectory(run);
  // Exclusive ownership prevents a retry from replacing any existing message files.
  await mkdir(message, { mode: 0o700 });
  try {
    const saved = [];
    for (const item of validatedFiles) {
      const id = randomUUID();
      const extension = extname(item.name).toLowerCase();
      const safeExtension = /^\.[a-z0-9]{1,12}$/.test(extension) ? extension : '.bin';
      const path = join(message, `${id}${safeExtension}`);
      await writeFile(path, item.buffer, { flag: 'wx', mode: 0o600 });
      saved.push({ id, name: item.name, size: item.size, type: item.type, file: relative(root, path) });
    }
    return saved;
  } catch (error) {
    await rm(message, { recursive: true, force: true });
    throw error;
  }
}
