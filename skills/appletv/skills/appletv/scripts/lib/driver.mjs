/**
 * Spawns scripts/driver.py inside the skill's venv and parses its one JSON
 * line. The venv lives at <skill>/.venv (gitignored); `doctor --install`
 * creates it. Nothing else in the node half imports python.
 */
import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = join(HERE, '..', '..');
export const VENV = process.env.APPLETV_VENV || join(SKILL_DIR, '.venv');
export const DRIVER = join(HERE, '..', 'driver.py');

export function venvPython() {
  const p = join(VENV, 'bin', 'python');
  return existsSync(p) ? p : null;
}

export function systemPython() {
  for (const cand of ['python3.13', 'python3.12', 'python3.11', 'python3']) {
    const r = spawnSync(cand, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return { bin: cand, version: (r.stdout || r.stderr).trim().replace('Python ', '') };
  }
  return null;
}

function parseLine(stdout) {
  const line = stdout.split('\n').map((l) => l.trim()).filter(Boolean).pop();
  if (!line) return { ok: false, error: 'driver_silent' };
  try {
    return JSON.parse(line);
  } catch {
    return { ok: false, error: 'driver_garbled', detail: line.slice(0, 200) };
  }
}

/** Run one driver subcommand synchronously. Returns the parsed JSON. */
export function drive(sub, args = [], { timeoutMs = 90_000, debug = false } = {}) {
  const py = venvPython();
  if (!py) return { ok: false, error: 'no_pyatv' };
  const r = spawnSync(py, [DRIVER, sub, ...args], { encoding: 'utf8', timeout: timeoutMs });
  if (debug && r.stderr) process.stderr.write(r.stderr);
  if (r.error) return { ok: false, error: r.error.code === 'ETIMEDOUT' ? 'timeout' : `spawn:${r.error.code}`, detail: r.error.message };
  const parsed = parseLine(r.stdout);
  if (!parsed.ok && parsed.error === 'driver_silent' && r.stderr) parsed.detail = r.stderr.trim().split('\n').pop();
  return parsed;
}

/** Run the driver detached-ish, streaming stderr phases; resolves to the JSON. */
export function driveAsync(sub, args = [], { onPhase = () => {}, debug = false } = {}) {
  const py = venvPython();
  if (!py) return Promise.resolve({ ok: false, error: 'no_pyatv' });
  return new Promise((resolvePromise) => {
    const child = spawn(py, [DRIVER, sub, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => {
      for (const line of String(d).split('\n').filter(Boolean)) {
        try { onPhase(JSON.parse(line)); } catch { if (debug) process.stderr.write(`${line}\n`); }
      }
    });
    child.on('close', () => resolvePromise(parseLine(out)));
    child.on('error', (e) => resolvePromise({ ok: false, error: `spawn:${e.code}`, detail: e.message }));
  });
}
