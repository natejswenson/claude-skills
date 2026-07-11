// Shared config validation, IO, and process helpers for the devlog CLI.
// Single source of truth: bin/devlog.js re-exports the validators from here so
// external importers (tests, SKILL.md guidance) keep one canonical definition.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// SHELL_QUOTE_BREAK matches characters that can break out of a single-quoted
// shell string OR are dangerous if quoting is omitted. The skill instructs the
// LLM to single-quote every interpolated value; rejecting these chars upstream
// guarantees that single-quoting is sufficient. Whitespace, dots, hyphens,
// equals, and similar are NOT rejected — they're literal inside '...' and are
// legitimate in human-readable fields like names and paths.
//
// For strict-token fields (project keys, repo names, branch names), separate
// allowlist regexes apply additional structural constraints.
export const SHELL_QUOTE_BREAK = /[;&|`$()<>{}[\]*?!#~"'\\\n\r]/;
export const RE_GH_USER = /^[a-z0-9][a-z0-9-]*$/i;
export const RE_REPO_NAME = /^[a-z0-9][a-z0-9._-]*$/i;
export const RE_OWNER_REPO = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i;
export const RE_PROJECT_KEY = /^[a-z0-9][a-z0-9._-]*$/i;
export const RE_BRANCH = /^[a-z0-9][a-z0-9._/-]*$/i;
// Repo-relative subdir used to scope `git log` to one skill in a monorepo.
// Same shape as a branch: no leading dash/slash, no shell metacharacters.
export const RE_PATH_FILTER = /^[a-z0-9][a-z0-9._/-]*$/i;
// Git tag prefix that marks a project's releases (e.g. `v` or `devlog-v`).
// Interpolated into `git tag --list '<tagPrefix>*'`; same safety as a path filter.
export const RE_TAG_PREFIX = /^[a-z0-9][a-z0-9._/-]*$/i;
export const FORBIDDEN_BRANCH_PARTS = /(^|\/)\.\.($|\/)/; // reject `..` as a path component

// A final-release version label: `v` + digits and dots only. Prereleases
// (v1.0.0-rc.1) and build metadata (v1.0.0+build) are excluded by design —
// they must never get an entry or serve as a range base.
export const RE_FINAL_RELEASE = /^v[0-9]+(\.[0-9]+)*$/;

export const CONFIG_DIR = join(homedir(), '.claude', 'skills', 'devlog');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export const DEEP_DIVE_DEFAULTS = Object.freeze({
  topicDomains: Object.freeze(['AI', 'DevOps/SRE', 'software engineering']),
  minSources: 3,
});

export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

// argv-style invocation; no shell, so user-supplied args cannot inject.
// Returns trimmed stdout on exit 0, null otherwise.
export function execArgs(cmd, args, opts = {}) {
  const r = spawnArgs(cmd, args, opts);
  return r.status === 0 ? r.stdout : null;
}

// Like execArgs but returns { status, stdout, stderr } for callers that need
// to distinguish failure modes (e.g. a gh 404 vs a network error).
export function spawnArgs(cmd, args, opts = {}) {
  try {
    const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });
    return {
      status: r.status ?? 1,
      stdout: (r.stdout || '').trim(),
      stderr: (r.stderr || '').trim(),
    };
  } catch (e) {
    return { status: 1, stdout: '', stderr: String(e && e.message || e) };
  }
}

// Atomic write: write to sibling tmp file then rename.
// Prevents readers from seeing a half-written config if process is killed mid-write.
// Uses `wx` (exclusive create) flag to prevent symlink-attack on shared filesystems
// — if an attacker pre-creates the tmp file, our write fails rather than following
// the symlink to a sensitive target.
export function atomicWriteJSON(path, data) {
  const tmp = path + '.tmp.' + process.pid + '.' + Date.now();
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  try {
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch {}
    throw e;
  }
}

export function readConfig(path = CONFIG_PATH) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Validate a config object before writing. Throws with a user-facing message on failure.
export function validateConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Config must be an object');
  const required = ['targetRepo', 'gitAuthor', 'githubUser', 'projects'];
  for (const k of required) {
    if (!(k in config)) throw new Error(`Missing required field: ${k}`);
  }
  if (!RE_OWNER_REPO.test(config.targetRepo)) {
    throw new Error(`targetRepo must match <owner>/<repo>: got ${JSON.stringify(config.targetRepo)}`);
  }
  if (typeof config.gitAuthor !== 'string' || config.gitAuthor.length === 0 || SHELL_QUOTE_BREAK.test(config.gitAuthor)) {
    throw new Error(`gitAuthor must be non-empty and contain no shell metacharacters: got ${JSON.stringify(config.gitAuthor)}`);
  }
  if (!RE_GH_USER.test(config.githubUser)) {
    throw new Error(`githubUser must match GitHub username pattern: got ${JSON.stringify(config.githubUser)}`);
  }
  if ('branch' in config) {
    if (!RE_BRANCH.test(config.branch) || FORBIDDEN_BRANCH_PARTS.test(config.branch)) {
      throw new Error(`branch must be a valid git branch name (no leading dash, no '..'): got ${JSON.stringify(config.branch)}`);
    }
  }
  if ('voicePath' in config) {
    // Optional: directory holding the voice profile used to write entries. Read by
    // the skill with the Read tool only — never shell-interpolated — so the only
    // hard requirement is no shell metacharacters and no leading dash. A leading `~`
    // is allowed (the skill expands it); we test the expanded form so an absolute
    // path has no `~` left to trip the shell-quote-break check. Existence is checked
    // at prompt time (and at runtime, with a fallback chain), not here.
    const expanded = typeof config.voicePath === 'string' ? expandHome(config.voicePath) : config.voicePath;
    if (typeof config.voicePath !== 'string' || SHELL_QUOTE_BREAK.test(expanded) || expanded.trim().startsWith('-')) {
      throw new Error(`voicePath must be a path with no shell metacharacters and no leading dash: got ${JSON.stringify(config.voicePath)}`);
    }
  }
  if ('deepDive' in config) {
    const d = config.deepDive;
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('deepDive must be an object');
    if ('minSources' in d) {
      if (!Number.isInteger(d.minSources) || d.minSources < 1 || d.minSources > 10) {
        throw new Error(`deepDive.minSources must be an integer 1-10: got ${JSON.stringify(d.minSources)}`);
      }
    }
    if ('topicDomains' in d) {
      if (!Array.isArray(d.topicDomains) || d.topicDomains.length === 0
        || d.topicDomains.some((t) => typeof t !== 'string' || t.length === 0 || t.length > 100 || /[\x00-\x1f]/.test(t))) {
        throw new Error('deepDive.topicDomains must be a non-empty array of short strings');
      }
    }
  }
  if (!Array.isArray(config.projects)) {
    throw new Error('projects must be an array');
  }
  const seenKeys = new Set();
  for (const p of config.projects) {
    if (!p || typeof p !== 'object') throw new Error('Each project must be an object');
    if (!RE_PROJECT_KEY.test(p.key) || p.key.includes('..')) {
      throw new Error(`project.key invalid: ${JSON.stringify(p.key)}`);
    }
    if (seenKeys.has(p.key)) throw new Error(`Duplicate project key: ${JSON.stringify(p.key)}`);
    seenKeys.add(p.key);
    if (typeof p.path !== 'string' || SHELL_QUOTE_BREAK.test(p.path)) {
      throw new Error(`project.path invalid (must contain no shell metacharacters): ${JSON.stringify(p.path)}`);
    }
    if (!RE_OWNER_REPO.test(p.remote)) {
      throw new Error(`project.remote must match <owner>/<repo>: ${JSON.stringify(p.remote)}`);
    }
    if ('pathFilter' in p) {
      // Optional: scope this project's commits to a repo subdirectory (e.g. a
      // single skill in a monorepo). Interpolated into `git log -- <pathFilter>`,
      // so enforce the same no-metacharacter / no-`..` safety as branch names.
      if (typeof p.pathFilter !== 'string' || !RE_PATH_FILTER.test(p.pathFilter) || FORBIDDEN_BRANCH_PARTS.test(p.pathFilter)) {
        throw new Error(`project.pathFilter must be a repo-relative subdir (no leading dash/slash, no '..', no shell metacharacters): ${JSON.stringify(p.pathFilter)}`);
      }
    }
    if ('tagPrefix' in p) {
      // Optional: the prefix of the git tags that mark this project's releases
      // (e.g. `devlog-v`). Interpolated into `git tag --list '<tagPrefix>*'`, so
      // enforce the same no-metacharacter / no-`..` safety as path filters.
      if (typeof p.tagPrefix !== 'string' || !RE_TAG_PREFIX.test(p.tagPrefix) || FORBIDDEN_BRANCH_PARTS.test(p.tagPrefix)) {
        throw new Error(`project.tagPrefix must be a tag prefix (no leading dash/slash, no '..', no shell metacharacters): ${JSON.stringify(p.tagPrefix)}`);
      }
    }
    if ('label' in p) {
      // Label is rendered as React text content only — never shell-interpolated,
      // never used in URLs, never used as a filesystem path. React escapes all
      // text content. Therefore: any string is safe. Apostrophes (e.g.
      // "Mom I'm Bored") and unicode are legitimate label content.
      // INVARIANT: if a future change makes label flow into shell or innerHTML,
      // tighten this validation to SHELL_QUOTE_BREAK at the same time.
      if (typeof p.label !== 'string') throw new Error(`project.label must be a string if present`);
      if (p.label.length > 200) throw new Error(`project.label too long (max 200 chars)`);
      if (/[\x00-\x1f]/.test(p.label)) throw new Error(`project.label contains control characters`);
    }
  }
  return config;
}

// Resolve the effective deepDive settings (user values over defaults).
export function resolveDeepDive(config) {
  const d = (config && config.deepDive) || {};
  return {
    topicDomains: Array.isArray(d.topicDomains) && d.topicDomains.length ? d.topicDomains : [...DEEP_DIVE_DEFAULTS.topicDomains],
    minSources: Number.isInteger(d.minSources) ? d.minSources : DEEP_DIVE_DEFAULTS.minSources,
  };
}

// True when a git remote URL points at <owner>/<repo> on any common transport
// (https://github.com/o/r.git, git@github.com:o/r.git, ssh://git@github.com/o/r).
export function remoteUrlMatches(url, ownerRepo) {
  if (!url || !ownerRepo) return false;
  const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return !!m && m[1].toLowerCase() === ownerRepo.toLowerCase();
}
