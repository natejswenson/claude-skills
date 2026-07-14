import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// argv-style invocation; no shell, so user-supplied args cannot inject.
// Returns { status, stdout, stderr } so callers can distinguish failure modes
// (e.g. a 404 from gh vs. a network error) instead of collapsing to a boolean.
export function spawnArgs(cmd, args, opts = {}) {
  try {
    const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });
    return {
      status: r.status ?? 1,
      stdout: (r.stdout || '').trim(),
      stderr: (r.stderr || '').trim(),
    };
  } catch (e) {
    return { status: 1, stdout: '', stderr: String((e && e.message) || e) };
  }
}

export function ghApi(path, args = []) {
  return spawnArgs('gh', ['api', path, ...args]);
}

export function ghApiJson(path, args = []) {
  const r = ghApi(path, args);
  if (r.status !== 0) return { ok: false, status: r.status, stderr: r.stderr };
  try {
    return { ok: true, data: JSON.parse(r.stdout) };
  } catch (e) {
    return { ok: false, status: r.status, stderr: `unparseable JSON: ${e.message}` };
  }
}

export function git(args, opts = {}) {
  return spawnArgs('git', args, opts);
}

export function sha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
