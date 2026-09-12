/** Atomic completion envelopes bind a delivery to its immutable dispatch inputs.
 * Host completion must still be observed by the parent; envelopes are not an OS
 * boundary against a worker with permission to rewrite controller state.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const quote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
const fileHash = (path) => {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error(`not a regular attempt output: ${path}`);
  return digest(readFileSync(path));
};

export function createAttempt(root, run, brief, outputs) {
  const id = randomUUID();
  const path = join(root, 'attempts', id);
  mkdirSync(path, { recursive: true });
  const completion = join(path, 'completed.json');
  const manifest = join(path, 'request.json');
  const command = fileURLToPath(new URL('../complete-worker.mjs', import.meta.url));
  const instruction = `\n## Atomic delivery\n\nAttempt: ${id}. After closing all declared output files, run:\n\n\`\`\`sh\nnode ${quote(command)} ${quote(manifest)}\n\`\`\`\n\nThen finish your native worker turn. Do not modify outputs after publishing completion. The parent must observe native completion before releasing your slot.\n`;
  writeFileSync(brief, readFileSync(brief, 'utf8') + instruction);
  const request = { schema: 1, id, generation: run.execution?.generation ?? run.createdAt, contractHash: run.harness.contractHash, brief, briefHash: fileHash(brief), outputs, completion };
  writeFileSync(manifest, JSON.stringify(request), { flag: 'wx' });
  return { ...request, manifest, manifestHash: fileHash(manifest), state: 'dispatched' };
}

export function completeAttempt(manifest) {
  const request = JSON.parse(readFileSync(manifest, 'utf8'));
  if (request.schema !== 1 || !Array.isArray(request.outputs) || !request.outputs.length || fileHash(request.brief) !== request.briefHash) throw new Error('stale or malformed attempt request; do not publish completion');
  const outputs = request.outputs.map((path) => ({ path, hash: fileHash(path) }));
  const envelope = { schema: 1, id: request.id, generation: request.generation, manifestHash: fileHash(manifest), outputs, status: 'completed' };
  if (existsSync(request.completion)) {
    if (readFileSync(request.completion, 'utf8') === JSON.stringify(envelope)) return envelope;
    throw new Error('attempt completion is immutable; request a fresh attempt');
  }
  const archive = join(dirname(manifest), 'outputs');
  mkdirSync(archive, { recursive: true });
  outputs.forEach((output, index) => {
    const bytes = readFileSync(output.path);
    if (digest(bytes) !== output.hash) throw new Error('output changed before attempt archival');
    const target = join(archive, `${index}-${output.hash}`);
    if (!existsSync(target)) writeFileSync(target, bytes, { flag: 'wx' });
  });
  const pending = request.completion + `.${randomUUID()}.pending`;
  writeFileSync(pending, JSON.stringify(envelope), { flag: 'wx' });
  // Check again before publication so partial writes cannot pass a quiet-period heuristic.
  if (outputs.some((o) => fileHash(o.path) !== o.hash)) throw new Error('attempt output changed while publishing');
  linkSync(pending, request.completion); // Atomic publish, refuses a racing replacement.
  unlinkSync(pending);
  return envelope;
}

export function attemptDelivered(attempt) {
  try {
    if (attempt?.native && attempt.native.status !== 'completed') return false;
    if (!attempt || attempt.state !== 'dispatched' || !existsSync(attempt.completion) || fileHash(attempt.manifest) !== attempt.manifestHash || fileHash(attempt.brief) !== attempt.briefHash) return false;
    const result = JSON.parse(readFileSync(attempt.completion, 'utf8'));
    return result.schema === 1 && result.id === attempt.id && result.generation === attempt.generation && result.manifestHash === attempt.manifestHash && result.status === 'completed' && result.outputs.length === attempt.outputs.length && attempt.outputs.every((path) => result.outputs.some((o) => o.path === path && o.hash === fileHash(path)));
  } catch { return false; }
}
