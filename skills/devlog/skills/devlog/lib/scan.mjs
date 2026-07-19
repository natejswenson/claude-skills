// Release discovery: turns config + local git state into a JSON plan of the
// entries /devlog should write. Replaces the hand-rolled bash steps the skill
// used to run — tag names never pass through a shell here (spawnSync argv only),
// and the semver/range logic is unit-testable.
import { existsSync } from 'node:fs';
import {
  SHELL_QUOTE_BREAK,
  RE_FINAL_RELEASE,
  execArgs,
  spawnArgs,
  remoteUrlMatches,
  resolveDeepDive,
} from './core.mjs';

const DIFFSTAT_MAX_CHARS = 5000;

// The version label is the substring of the tag starting at the first `v`
// that is followed by a digit: `devlog-v0.2.0` → `v0.2.0`, `v1.4.0` → `v1.4.0`.
// Returns null when the tag has no such sequence (e.g. `version-bump`).
export function deriveVersionLabel(tag) {
  const m = /v(?=\d)/.exec(tag);
  return m ? tag.slice(m.index) : null;
}

// Tag names come from `git tag --list` and are attacker-influenceable (anyone
// who can push a tag controls them). Even though this module never puts them
// through a shell, unsafe names are excluded outright so downstream consumers
// (the skill, filenames, URLs) never see them.
export function isSafeTagName(tag) {
  return typeof tag === 'string' && tag.length > 0 && tag.length <= 200
    && !SHELL_QUOTE_BREAK.test(tag) && !tag.startsWith('-');
}

export function isFinalRelease(label) {
  return typeof label === 'string' && RE_FINAL_RELEASE.test(label);
}

// Partition a descending (`--sort=-v:refname`) tag list into final releases
// and skipped tags with reasons. Order is preserved, so releases[i + 1] is the
// range base (prevTag) of releases[i].
export function selectReleases(tags) {
  const releases = [];
  const skipped = [];
  for (const tag of tags) {
    if (!isSafeTagName(tag)) {
      skipped.push({ tag, reason: 'unsafe-name' });
      continue;
    }
    const version = deriveVersionLabel(tag);
    if (!version) {
      skipped.push({ tag, reason: 'non-release' });
      continue;
    }
    if (!isFinalRelease(version)) {
      const reason = version.includes('-') ? 'prerelease'
        : version.includes('+') ? 'build-metadata' : 'non-final';
      skipped.push({ tag, reason });
      continue;
    }
    releases.push({ tag, version });
  }
  return { releases, skipped };
}

function git(projectPath, args) {
  return execArgs('git', ['-C', projectPath, ...args]);
}

// Scan one project's local clone. Pure git — the caller supplies the set of
// entry filenames that already exist in the target repo (existingFiles), so
// this function stays testable against throwaway fixture repos.
export function scanProject(project, { branch = 'main', fetch = true, existingFiles = new Set() } = {}) {
  const out = {
    key: project.key,
    label: project.label || project.key,
    remote: project.remote,
    private: !!project.private,
    path: project.path,
    pathFilter: project.pathFilter || null,
    tagPrefix: project.tagPrefix || 'v',
    tagFetch: 'skipped',
    newReleases: [],
    skippedTags: [],
    error: null,
  };

  if (!existsSync(project.path)) {
    out.error = 'path-missing';
    return out;
  }

  if (fetch) {
    // Best-effort: releases are commonly cut by CI on the remote, so the tag is
    // born there. Offline / no-remote / auth failures degrade to local tags.
    const r = spawnArgs('git', ['-C', project.path, 'fetch', '--tags', '--quiet']);
    out.tagFetch = r.status === 0 ? 'ok' : 'failed';
  }

  const listed = git(project.path, ['tag', '--list', `${out.tagPrefix}*`, '--sort=-v:refname']);
  const tags = listed ? listed.split('\n').filter(Boolean) : [];
  const { releases, skipped } = selectReleases(tags);
  out.skippedTags.push(...skipped);

  // Publicness scaffolding, computed once per project.
  const originUrl = git(project.path, ['remote', 'get-url', 'origin']);
  const remoteMatches = remoteUrlMatches(originUrl, project.remote);
  const publishedRef = `refs/remotes/origin/${branch}`;
  const hasPublishedRef = git(project.path, ['rev-parse', '--verify', '--quiet', publishedRef]) !== null;

  const isPublic = (rev) => {
    // A private project has no safe commit surface, full stop — this bypasses
    // remoteMatches/hasPublishedRef entirely rather than relying on them to
    // happen to be false, since a private repo can still have origin configured
    // correctly (remoteMatches true) and a normally-pushed branch.
    if (project.private) return false;
    if (!remoteMatches || !hasPublishedRef) return false;
    return spawnArgs('git', ['-C', project.path, 'merge-base', '--is-ancestor', rev, publishedRef]).status === 0;
  };

  for (let i = 0; i < releases.length; i++) {
    const { tag, version } = releases[i];
    if (existingFiles.has(`${version}.md`)) {
      out.skippedTags.push({ tag, reason: 'entry-exists' });
      continue;
    }

    // prevTag comes from the FILTERED final-release list only — never a raw
    // prerelease or non-release tag — so ranges are always release-to-release.
    const prevTag = releases[i + 1]?.tag ?? null;
    const range = prevTag ? `${prevTag}..${tag}` : tag;
    const logArgs = ['log', range, '--format=%H|%s|%cs'];
    if (project.pathFilter) logArgs.push('--', project.pathFilter);
    const logOut = git(project.path, logArgs);
    if (logOut === null) {
      out.skippedTags.push({ tag, reason: 'log-failed' });
      continue;
    }

    const lines = logOut.split('\n').filter(Boolean);
    if (lines.length === 0) {
      // Nothing shipped for this project in that version (common under
      // pathFilter in a monorepo when the tag belongs to another subdir).
      out.skippedTags.push({ tag, reason: 'empty-range' });
      continue;
    }

    // Fast path: if the tag's commit is on the published branch, every commit
    // in the range (all reachable from the tag) is public — one git call
    // instead of one per commit.
    const tagPublic = isPublic(`${tag}^{commit}`);
    const commits = lines.map((line) => {
      const [hash, subject, date] = splitLogLine(line);
      return { hash, subject, date, public: tagPublic || isPublic(hash) };
    });

    const release = {
      tag,
      version,
      date: git(project.path, ['log', '-1', '--format=%cs', `${tag}^{commit}`]) || null,
      prevTag,
      commits,
    };

    if (prevTag) {
      const diffArgs = ['diff', '--stat', '--stat-count=40', range];
      if (project.pathFilter) diffArgs.push('--', project.pathFilter);
      const stat = git(project.path, diffArgs);
      if (stat) release.diffstat = stat.slice(0, DIFFSTAT_MAX_CHARS);
    }

    out.newReleases.push(release);
  }

  return out;
}

// `%H|%s|%cs` — the subject may itself contain `|`, so split off the leading
// hash and trailing date and keep everything between as the subject.
function splitLogLine(line) {
  const first = line.indexOf('|');
  const last = line.lastIndexOf('|');
  const hash = line.slice(0, first);
  const subject = line.slice(first + 1, last);
  const date = line.slice(last + 1);
  return [hash, subject, date];
}

// Which entry files already exist in the target repo for one project — a
// single `gh api` directory listing (vs. the old one-probe-per-tag pattern).
// Returns { files: Set, status: 'ok' | 'empty' | 'failed' }: a 404 means the
// project has no entries yet; any other failure is surfaced so the caller
// knows the entry-exists filter may be incomplete (publish-entry still refuses
// overwrites against the fresh clone, so a stale scan cannot clobber anything).
export function fetchExistingEntries(targetRepo, branch, projectKey, targetDir = '') {
  const contentPath = targetDir ? `${targetDir}/${projectKey}` : projectKey;
  const r = spawnArgs('gh', ['api', `repos/${targetRepo}/contents/${contentPath}?ref=${branch}`, '--jq', '.[].name']);
  if (r.status === 0) {
    return { files: new Set(r.stdout.split('\n').filter(Boolean)), status: 'ok' };
  }
  if (/HTTP 404|Not Found/i.test(r.stderr)) {
    return { files: new Set(), status: 'empty' };
  }
  return { files: new Set(), status: 'failed' };
}

// Full scan across the configured projects. `getExisting` is injectable for
// tests; production uses fetchExistingEntries against the GitHub API.
export function scanAll(config, { projectKey = null, fetch = true, getExisting = fetchExistingEntries } = {}) {
  const branch = config.branch || 'main';
  let projects = config.projects;
  if (projectKey) {
    projects = projects.filter((p) => p.key === projectKey);
    if (projects.length === 0) {
      return {
        error: `unknown-project: ${projectKey}`,
        availableKeys: config.projects.map((p) => p.key),
      };
    }
  }

  const results = projects.map((project) => {
    const existing = getExisting(config.targetRepo, branch, project.key, config.targetDir || '');
    const scanned = scanProject(project, { branch, fetch, existingFiles: existing.files });
    scanned.existenceCheck = existing.status;
    return scanned;
  });

  return {
    targetRepo: config.targetRepo,
    // Subdirectory of targetRepo holding the content tree ('' = repo root) — the
    // skill appends it to the publish clone path (`--clone <clone>/<targetDir>`).
    targetDir: config.targetDir || '',
    branch,
    deepDive: resolveDeepDive(config),
    voicePath: config.voicePath || null,
    projects: results,
    totalNewReleases: results.reduce((n, p) => n + p.newReleases.length, 0),
  };
}
