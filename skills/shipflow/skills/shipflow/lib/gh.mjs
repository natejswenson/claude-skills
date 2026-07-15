import { spawnSync } from 'node:child_process';
import { statSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Every file shipflow reads under a target repo (.github/shipflow.json,
// candidate settings-as-code artifacts, workflow YAML, the rendered
// template on disk) is repo-write-controlled, not admin-only — a
// maliciously huge or pathologically nested file could exhaust memory on
// an unbounded readFileSync/JSON.parse. 1 MB is generous for any
// legitimate config/workflow/IaC file shipflow actually needs to read.
const MAX_READ_BYTES = 1_000_000;

export function readFileCapped(path, encoding = 'utf8') {
  const size = statSync(path).size;
  if (size > MAX_READ_BYTES) {
    throw new Error(`refusing to read ${path}: ${size} bytes exceeds the ${MAX_READ_BYTES}-byte safety cap`);
  }
  return readFileSync(path, encoding);
}

// Every gh/git call crosses a network or filesystem-lock boundary shipflow
// doesn't control (GitHub rate-limiting, a network partition, a stuck git
// index lock) — with no timeout, a single stuck call hangs the whole
// process indefinitely with no recovery. 30s is generous for any real gh
// API call or local git operation this codebase makes. Found via a Siege
// security audit (2026-07-15, SIEGE-2026-07-15-004).
const DEFAULT_SUBPROCESS_TIMEOUT_MS = 30_000;

// argv-style invocation; no shell, so user-supplied args cannot inject.
// Returns { status, stdout, stderr } so callers can distinguish failure modes
// (e.g. a 404 from gh vs. a network error) instead of collapsing to a boolean.
export function spawnArgs(cmd, args, opts = {}) {
  try {
    const r = spawnSync(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: DEFAULT_SUBPROCESS_TIMEOUT_MS,
      ...opts,
    });
    const stderr = (r.stderr || '').trim();
    // spawnSync does not throw on timeout — it kills the child and sets
    // r.error (code 'ETIMEDOUT') with r.status left null, so this must be
    // surfaced explicitly rather than silently collapsing to a bare "1".
    return {
      status: r.status ?? 1,
      stdout: (r.stdout || '').trim(),
      stderr: r.error ? [stderr, r.error.message].filter(Boolean).join(': ') : stderr,
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
