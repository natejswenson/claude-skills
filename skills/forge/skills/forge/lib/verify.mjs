/**
 * The verification ladder.
 *
 * The differentiator, and the reason this skill exists. Every AI workflow
 * generator surveyed generates and hopes; none lints, none pins, none resolves,
 * and none says it didn't. The whole ladder below costs about a second.
 *
 * Rung ordering is not cosmetic:
 *   0  refs      — `gh api`; the ONLY rung that catches a hallucinated action
 *   1  actionlint — syntax, expressions, known-action inputs, shellcheck
 *   2  zizmor     — template injection, permissions, pinning, credential leaks
 *
 * actionlint runs **before** zizmor on purpose: one unparseable file makes
 * zizmor print "fatal: no audit was performed" and skip every other file, so a
 * syntax error would silently cost the entire security pass.
 *
 * Every rung degrades rather than fails when its tool is absent — actionlint was
 * not preinstalled on the machine this was built on, and a skill that only works
 * on a fully-provisioned laptop is a skill that mostly does not work.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectUses } from './resolve.mjs';

const exec = promisify(execFile);

/** Every `uses:` in a workflow, with its `with:` keys and line number. */
export function collectUses(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)-?\s*uses:\s*(['"]?)([^'"#\s]+)\2\s*(?:#\s*(\S+))?/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    // The trailing `# v7` on a SHA pin is the only place the human-readable
    // version survives. Without reading it, a correctly SHA-pinned action can
    // never be reported as stale — and SHA-pinned-but-two-majors-behind is the
    // single most common real state of a mature workflow.
    const comment = m[4] ?? null;
    const withKeys = [];
    // `with:` belongs to this step when it is more indented than the `uses:`
    // line's own key, and the scan stops at the next key at or above that level.
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === '' || line.trim().startsWith('#')) continue;
      const ind = line.length - line.trimStart().length;
      if (ind <= indent) break;
      if (/^\s*with:\s*$/.test(line)) {
        for (let k = j + 1; k < lines.length; k += 1) {
          const w = lines[k];
          if (w.trim() === '' || w.trim().startsWith('#')) continue;
          const wi = w.length - w.trimStart().length;
          if (wi <= ind) break;
          const key = /^\s*([A-Za-z0-9_-]+):/.exec(w);
          if (key && wi === (lines[k].length - lines[k].trimStart().length)) withKeys.push(key[1]);
        }
        break;
      }
    }
    out.push({ uses: m[3], line: i + 1, withKeys, comment });
  }
  return out;
}

/**
 * Rung 0. Resolved in parallel and memoized per (action, ref, with-shape),
 * because a workflow references the same action from several jobs and each miss
 * is a network round trip.
 */
export async function verifyRefs(text, cache = new Map()) {
  const found = collectUses(text);
  const results = await Promise.all(found.map(async (u) => {
    const key = `${u.uses} ${u.withKeys.join(',')} ${u.comment ?? ''}`;
    if (!cache.has(key)) {
      cache.set(key, inspectUses(u.uses, u.withKeys.length ? u.withKeys : null, u.comment));
    }
    try {
      return { ...u, ...(await cache.get(key)) };
    } catch (err) {
      return { ...u, status: 'error', detail: err.message };
    }
  }));
  return results;
}

async function have(bin, args = ['--version']) {
  try {
    await exec(bin, args);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rung 1. actionlint takes FILES, never a directory — passing one exits 3 with
 * "is a directory", which reads like a lint failure and is not one.
 */
export async function runActionlint(files) {
  if (!(await have('actionlint'))) {
    return { ran: false, reason: 'actionlint not installed (brew install actionlint)' };
  }
  try {
    await exec('actionlint', ['-no-color', ...files]);
    return { ran: true, findings: [] };
  } catch (err) {
    if (typeof err.stdout !== 'string' || err.stdout === '') {
      return { ran: false, reason: (err.stderr || err.message).trim().split('\n')[0] };
    }
    return { ran: true, findings: parseActionlint(err.stdout) };
  }
}

function parseActionlint(stdout) {
  const out = [];
  for (const line of stdout.split('\n')) {
    const m = /^(.+?):(\d+):(\d+): (.*?) \[([a-z-]+)\]$/.exec(line);
    if (m) out.push({ file: m[1], line: Number(m[2]), col: Number(m[3]), message: m[4], rule: m[5] });
  }
  return out;
}

/**
 * Rung 2. zizmor exits **14** when it has findings — that is "findings", not a
 * crash, and treating it as one would turn a working audit into a broken tool.
 * `uvx` is preferred because it needs no install and self-caches in ~2s once.
 */
export async function runZizmor(files) {
  const viaUvx = !(await have('zizmor')) && (await have('uvx'));
  if (!viaUvx && !(await have('zizmor'))) {
    return { ran: false, reason: 'zizmor not available (needs uv, or: brew install zizmor)' };
  }
  const [bin, lead] = viaUvx ? ['uvx', ['zizmor@latest']] : ['zizmor', []];
  const args = [...lead, '--offline', '--format', 'json', ...files];
  try {
    const { stdout } = await exec(bin, args, { maxBuffer: 1 << 24 });
    return { ran: true, findings: parseZizmor(stdout) };
  } catch (err) {
    if (err.code === 14 && typeof err.stdout === 'string') {
      return { ran: true, findings: parseZizmor(err.stdout) };
    }
    return { ran: false, reason: (err.stderr || err.message).trim().split('\n')[0] };
  }
}

function parseZizmor(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed) ? parsed : (parsed.findings ?? []);
  return rows.map((f) => {
    const loc = f.locations?.[0]?.concrete ?? {};
    return {
      rule: f.ident ?? f.rule ?? 'unknown',
      severity: f.determinations?.severity ?? f.severity ?? 'unknown',
      confidence: f.determinations?.confidence ?? 'unknown',
      message: f.desc ?? f.description ?? '',
      file: loc.location?.path ?? f.path ?? '',
      line: loc.location?.start_point?.row ?? null,
    };
  });
}

/** Severity a finding must reach to block. zizmor's Low-confidence notes do not. */
const BLOCKING = new Set(['High', 'Medium']);

/**
 * The whole ladder over one or more files. Returns a structured verdict; the
 * caller decides how to present it. `ok` is deliberately strict about rung 0
 * (a nonexistent action is never acceptable) and lenient about zizmor's
 * low-confidence notes, which are advisory by that tool's own model.
 */
export async function verify(files, texts) {
  const cache = new Map();
  const refs = [];
  for (const text of texts) refs.push(...(await verifyRefs(text, cache)));

  const lint = await runActionlint(files);
  // Only audit once the files parse: an unparseable file aborts zizmor entirely.
  const parseFailed = lint.ran && lint.findings.some((f) => f.rule === 'syntax-check');
  const audit = parseFailed
    ? { ran: false, reason: 'skipped — fix the syntax errors first, zizmor aborts on an unparseable file' }
    : await runZizmor(files);

  const badRefs = refs.filter((r) => ['no-such-action', 'bad-ref', 'bad-inputs', 'error'].includes(r.status));
  const blocking = (audit.findings ?? []).filter((f) => BLOCKING.has(f.severity));

  return {
    refs,
    badRefs,
    lint,
    audit,
    blocking,
    ok: badRefs.length === 0 && (lint.findings ?? []).length === 0 && blocking.length === 0,
    rung: rungReached(lint, audit),
  };
}

/**
 * How far the ladder actually got — reported verbatim to the user, because
 * "lint-clean and its commands run locally" is not "verified working" and the
 * difference is the entire honesty of this skill.
 */
function rungReached(lint, audit) {
  if (!lint.ran) return 'refs only — actionlint unavailable';
  if (!audit.ran) return 'refs + actionlint — zizmor unavailable';
  return 'refs + actionlint + zizmor';
}
