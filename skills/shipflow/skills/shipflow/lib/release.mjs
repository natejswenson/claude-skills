// Component-scoped release engine: resolve a named component, read what is
// actually on main, propose a bump, write it, drive it to main, and prove the
// tag exists.
//
// Everything here is deterministic and mechanical on purpose. The two things
// this module deliberately does NOT decide are which bump to take and what the
// CHANGELOG says — those are judgment, and they belong to the caller (the
// `release` skill), not to a script.
//
// Three commands sit on top of this, in strictly increasing danger:
//   readStatus()  — read-only, no network writes, no local writes
//   prepare()     — local writes only, in a THROWAWAY WORKTREE (see below)
//   cut()         — the only irreversible one, gated on a status hash
//
// Why a throwaway worktree: `prepare` has to branch off dev and commit, and a
// real repo's working tree routinely has unrelated in-flight work in it (this
// monorepo's own tree did while this was written). Checking out a branch under
// that, or staging from it, is how another session's uncommitted work gets
// swept into a release commit. A `git worktree` is a clean, isolated checkout
// of dev that cannot see the user's dirt at all, so there is nothing to sweep.

import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileCapped, spawnArgs, git, ghApiJson, sha256 } from './gh.mjs';

// ─── component names are a substitution token, so they are validated ─────────
// `{name}` is substituted into filesystem paths, a git tag pattern and a
// workflow filename. It comes from .github/shipflow.json, which anyone with
// repo WRITE access can edit — the same strictly-lower-trust input class that
// made renderTemplate's branch-name tokens a Critical finding in the
// 2026-07-15 Siege audit. An unvalidated name is a path traversal
// (`../../../../etc/passwd`) or a tag/ref injection, so it is validated once,
// here, before any substitution happens anywhere.
//
// Dots are allowed because real repos are named `natejswenson.io` and `1.00s`
// and a single-component repo infers its component name from the repo
// directory. `..` in any position is rejected separately — the charset alone
// would happily admit `a..b`.
const COMPONENT_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_COMPONENT_NAME_LENGTH = 64;

export function validateComponentName(name) {
  if (typeof name !== 'string' || name.length === 0) return { ok: false, error: 'component name must be a non-empty string' };
  if (name.length > MAX_COMPONENT_NAME_LENGTH) {
    return { ok: false, error: `component name exceeds ${MAX_COMPONENT_NAME_LENGTH} characters` };
  }
  if (!COMPONENT_NAME_RE.test(name)) {
    return { ok: false, error: `component name "${name}" must match ${COMPONENT_NAME_RE} (lowercase letters, digits, dot, dash, underscore; leading alphanumeric)` };
  }
  if (name.includes('..')) {
    return { ok: false, error: `component name "${name}" contains ".." — rejected as a path-traversal attempt` };
  }
  return { ok: true };
}

// Belt-and-suspenders on top of the name validator: every path this module
// resolves must land INSIDE the target repo. The name regex already makes
// traversal unreachable, but a hand-written componentLayout entry
// (`"changelog": "../../../etc/passwd"`) is a second, independent way in, and
// that field is not a token — it is copied verbatim from config.
function assertInsideRepo(repoPath, absolutePath, what) {
  const root = resolve(repoPath);
  const target = resolve(absolutePath);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`refusing to resolve ${what} to ${target}: outside the repo at ${root}`);
  }
  return target;
}

// ─── layout ──────────────────────────────────────────────────────────────────
// A repo with no `release.componentLayout` gets this: one component, the repo
// root, versioned by package.json and tagged `v<version>`. That is what makes
// `release-status` work in budget / natejswenson.io with zero config.
const DEFAULT_ROOT_LAYOUT = Object.freeze({
  versionFiles: ['package.json'],
  changelog: 'CHANGELOG.md',
  tagPattern: 'v{version}',
  paths: ['.'],
  workflowFile: 'release.yml',
});

function expandName(template, name) {
  return String(template).replaceAll('{name}', name);
}

export function resolveLayout(config) {
  const declared = config?.release?.componentLayout;
  if (!declared) return { ...DEFAULT_ROOT_LAYOUT, inferred: true };
  return {
    versionFiles: declared.versionFiles ?? DEFAULT_ROOT_LAYOUT.versionFiles,
    changelog: declared.changelog ?? DEFAULT_ROOT_LAYOUT.changelog,
    tagPattern: declared.tagPattern ?? DEFAULT_ROOT_LAYOUT.tagPattern,
    paths: declared.paths ?? DEFAULT_ROOT_LAYOUT.paths,
    workflowFile: declared.workflowFile ?? DEFAULT_ROOT_LAYOUT.workflowFile,
    inferred: false,
  };
}

// Accepts `["devlog", {"name":"press"}]` — a bare string is the common case and
// a bare list of 12 strings reads far better in a config file than 12 objects.
export function listComponentNames(config, repoPath) {
  const declared = config?.release?.components;
  if (Array.isArray(declared) && declared.length > 0) {
    return declared.map((entry) => (typeof entry === 'string' ? entry : entry?.name)).filter(Boolean);
  }
  // Inferred single component: named after the repo directory, so
  // `release-status --component budget` works in ~/localrepo/budget.
  return [resolve(repoPath).split(sep).pop()];
}

export function resolveComponent(repoPath, config, name) {
  const valid = validateComponentName(name);
  if (!valid.ok) throw new Error(valid.error);
  const layout = resolveLayout(config);
  const rel = (p) => expandName(p, name);
  const versionFiles = layout.versionFiles.map(rel);
  const changelog = rel(layout.changelog);
  for (const f of [...versionFiles, changelog]) {
    assertInsideRepo(repoPath, join(repoPath, f), `component file "${f}"`);
  }
  return {
    name,
    versionFiles,
    changelog,
    // {version} is deliberately left unexpanded here — it is filled per-version
    // by tagFor()/tagGlob() below, since one component has many tags.
    tagPattern: rel(layout.tagPattern),
    paths: layout.paths.map(rel),
    workflowFile: rel(layout.workflowFile),
    inferredLayout: layout.inferred,
  };
}

export const tagFor = (component, version) => component.tagPattern.replaceAll('{version}', version);
const tagGlob = (component) => component.tagPattern.replaceAll('{version}', '*');

// ─── semver ──────────────────────────────────────────────────────────────────
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(v) {
  const m = SEMVER_RE.exec(String(v ?? '').trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], prerelease: m[4] ?? null };
}

export function cmpSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (const k of ['major', 'minor', 'patch']) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
  }
  // A prerelease sorts BELOW its own release (1.0.0-rc.1 < 1.0.0). Finer
  // prerelease ordering is deliberately not implemented — no skill in this
  // house uses prerelease tags, and a half-right ordering is worse than an
  // explicitly coarse one.
  if (pa.prerelease && !pb.prerelease) return -1;
  if (!pa.prerelease && pb.prerelease) return 1;
  if (pa.prerelease !== pb.prerelease) return pa.prerelease < pb.prerelease ? -1 : 1;
  return 0;
}

export function bumpSemver(version, kind) {
  const p = parseSemver(version);
  if (!p) return null;
  if (kind === 'major') return `${p.major + 1}.0.0`;
  if (kind === 'minor') return `${p.major}.${p.minor + 1}.0`;
  return `${p.major}.${p.minor}.${p.patch + 1}`;
}

// ─── reading a version out of the files that carry it ────────────────────────
// Frontmatter-only, mirroring _release.yml's awk exactly: read `version:` ONLY
// from the YAML block between the first two `---` lines. A whole-file grep
// would happily match a `version:` inside a body code block, and SKILL.md
// bodies are full of YAML samples.
export function readFrontmatterVersion(text) {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return null;
    const m = /^version:\s*(.+?)\s*$/.exec(lines[i]);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  return null;
}

// TOML (`version = "1.2.3"`) and YAML (`version: 1.2.3`) are matched only at
// column zero. Both formats nest — a pyproject.toml has `version` keys under
// `[tool.*]` tables and a project.yml has them under target definitions — and an
// indented match is some dependency's pin, not the project's own version.
// Deliberately not a real parser: shipflow has no dependencies, and the one
// line it needs is unambiguous when anchored.
const TOML_VERSION_RE = /^version\s*=\s*["']([^"'\n]+)["']/m;
const YAML_VERSION_RE = /^version:\s*["']?([^"'\n#]+?)["']?\s*(?:#.*)?$/m;

function versionFromSource(relPath, text) {
  if (relPath.endsWith('.json')) {
    try {
      return JSON.parse(text)?.version ?? null;
    } catch {
      return null;
    }
  }
  if (relPath.endsWith('.md')) return readFrontmatterVersion(text);
  if (relPath.endsWith('.toml')) return TOML_VERSION_RE.exec(text)?.[1] ?? null;
  if (relPath.endsWith('.yml') || relPath.endsWith('.yaml')) return YAML_VERSION_RE.exec(text)?.[1] ?? null;
  return null;
}

// `ref === null` means "as it is in the working tree"; anything else is read
// with `git show <ref>:<path>` so main's version can be read without checking
// main out (the whole point — the user's tree stays untouched).
export function readVersionAt(repoPath, component, ref) {
  const sources = [];
  for (const relPath of component.versionFiles) {
    let text = null;
    if (ref === null) {
      const abs = assertInsideRepo(repoPath, join(repoPath, relPath), `version file "${relPath}"`);
      if (!existsSync(abs)) continue;
      text = readFileCapped(abs);
    } else {
      const r = git(['show', `${ref}:${relPath}`], { cwd: repoPath });
      if (r.status !== 0) continue; // absent at this ref — not an error
      text = r.stdout;
    }
    const version = versionFromSource(relPath, text);
    if (version) sources.push({ file: relPath, version });
  }
  if (sources.length === 0) {
    return { ok: false, version: null, sources, error: `no version found in any of: ${component.versionFiles.join(', ')}` };
  }
  const distinct = [...new Set(sources.map((s) => s.version))];
  if (distinct.length > 1) {
    // This is the same invariant tools/lint_plugin.py enforces at PR time.
    // Releasing from a disagreeing set would tag one version while shipping
    // another, so it is a hard refusal rather than a "pick the highest".
    return { ok: false, version: null, sources, error: `version files disagree: ${sources.map((s) => `${s.file}=${s.version}`).join(', ')}` };
  }
  return { ok: true, version: distinct[0], sources };
}

// ─── tags ────────────────────────────────────────────────────────────────────
export function listComponentVersions(repoPath, component) {
  const r = git(['tag', '--list', tagGlob(component)], { cwd: repoPath });
  if (r.status !== 0 || !r.stdout) return [];
  const prefix = component.tagPattern.split('{version}')[0];
  const suffix = component.tagPattern.split('{version}')[1] ?? '';
  return r.stdout
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.slice(prefix.length, suffix ? t.length - suffix.length : undefined))
    .filter((v) => parseSemver(v))
    .sort(cmpSemver);
}

export const latestVersionTagged = (repoPath, component) => listComponentVersions(repoPath, component).pop() ?? null;

export function tagExistsLocally(repoPath, tag) {
  return git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { cwd: repoPath }).status === 0;
}

// The tag on the REMOTE is the only thing that counts as released. A local tag
// can be stale, hand-created, or left over from a deleted release — reading it
// back from origin is the difference between "the workflow was dispatched" and
// "the release exists."
export function tagExistsOnRemote(repoPath, tag) {
  const r = git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], { cwd: repoPath });
  if (r.status !== 0) return { ok: false, exists: false, error: r.stderr };
  return { ok: true, exists: r.stdout.trim().length > 0 };
}

// ─── conventional commits → a suggested bump ─────────────────────────────────
const CONVENTIONAL_RE = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?:\s*(?<subject>.+)$/;
const UNIT = '';
const RECORD = '';

export function parseCommitSubject(subject, body = '') {
  const m = CONVENTIONAL_RE.exec(subject.trim());
  const breaking = /(^|\n)BREAKING[ -]CHANGE:/.test(body) || Boolean(m?.groups.bang);
  if (!m) return { conventional: false, type: null, scope: null, subject: subject.trim(), breaking };
  return {
    conventional: true,
    type: m.groups.type,
    scope: m.groups.scope ?? null,
    subject: m.groups.subject.trim(),
    breaking,
  };
}

export function commitsSince(repoPath, component, sinceTag, ref) {
  const range = sinceTag ? `${sinceTag}..${ref}` : ref;
  const r = git(
    ['log', range, `--format=%H${UNIT}%s${UNIT}%b${RECORD}`, '--', ...component.paths],
    { cwd: repoPath }
  );
  if (r.status !== 0) return { ok: false, error: r.stderr, commits: [] };
  const commits = r.stdout
    .split(RECORD)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const [sha, subject = '', body = ''] = c.split(UNIT);
      return { sha: sha.trim().slice(0, 8), ...parseCommitSubject(subject, body) };
    });
  return { ok: true, commits };
}

// feat → minor, anything else → patch, breaking → major. With one house rule:
// while a component is still 0.x, a breaking change is capped at minor, because
// the alternative is silently promoting an 0.x component to 1.0.0 — a release
// decision no commit message is entitled to make. The cap is reported, never
// applied silently.
export function suggestBump(commits, currentVersion) {
  if (commits.length === 0) return { bump: null, reason: 'no commits touch this component since its last tag', capped: false };
  const breaking = commits.some((c) => c.breaking);
  const feat = commits.some((c) => c.type === 'feat');
  const raw = breaking ? 'major' : feat ? 'minor' : 'patch';
  const zeroMajor = parseSemver(currentVersion)?.major === 0;
  if (raw === 'major' && zeroMajor) {
    return { bump: 'minor', reason: 'a breaking change, capped to minor because this component is still 0.x — going to 1.0.0 is your call, not a commit message’s', capped: true };
  }
  const reason = breaking ? 'a breaking change' : feat ? 'at least one feat' : 'fixes and chores only';
  return { bump: raw, reason, capped: false };
}

// ─── status ──────────────────────────────────────────────────────────────────
function revParse(repoPath, ref) {
  const r = git(['rev-parse', '--verify', '--quiet', ref], { cwd: repoPath });
  return r.status === 0 ? r.stdout.trim() : null;
}

function dirtyPaths(repoPath, relPaths) {
  const r = git(['status', '--porcelain', '--', ...relPaths], { cwd: repoPath });
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout.split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
}

// Every OTHER component whose version at `dev` carries no tag. Those ride along
// on the same dev → main promotion — a promotion is atomic and carries all of
// dev, so "release devlog" physically also releases them. Surfacing this list
// is not advisory: releasing a component the user never named is the worst
// thing this engine can do, and the only defence is saying so first.
export function collateralComponents(repoPath, config, exceptName, devRef) {
  const out = [];
  for (const name of listComponentNames(config, repoPath)) {
    if (name === exceptName) continue;
    let component;
    try {
      component = resolveComponent(repoPath, config, name);
    } catch (e) {
      out.push({ name, unresolvable: String(e.message) });
      continue;
    }
    const atDev = readVersionAt(repoPath, component, devRef);
    if (!atDev.ok) continue;
    const tag = tagFor(component, atDev.version);
    if (!tagExistsLocally(repoPath, tag)) out.push({ name, version: atDev.version, tag });
  }
  return out;
}

export function readStatus(repoPath, config, name) {
  const component = resolveComponent(repoPath, config, name);
  const mainBranch = config?.branches?.main ?? 'main';
  const devBranch = config?.branches?.dev ?? 'dev';

  // Read from the REMOTE-tracking refs, not the local branches: a local `main`
  // that has not been fetched in a week would compute a bump against a stale
  // baseline and silently propose a version that is already tagged.
  const fetched = git(['fetch', 'origin', '--tags', '--prune'], { cwd: repoPath });
  const mainRef = revParse(repoPath, `origin/${mainBranch}`) ? `origin/${mainBranch}` : mainBranch;
  const devRef = revParse(repoPath, `origin/${devBranch}`) ? `origin/${devBranch}` : devBranch;

  const onMain = readVersionAt(repoPath, component, mainRef);
  const onDev = readVersionAt(repoPath, component, devRef);
  const lastVersion = latestVersionTagged(repoPath, component);
  const lastTag = lastVersion ? tagFor(component, lastVersion) : null;

  const blockers = [];
  const notes = [];
  // A shallow clone cannot answer "what is unreleased?" — and it does not fail
  // when asked, which is the dangerous part. `git log <tag>..<ref>` excludes
  // everything reachable from <tag>, and that exclusion needs full ancestry;
  // in a grafted history it silently under-applies and the range returns
  // commits that were released long ago. Observed on this repo: a depth-1
  // checkout of main reported 1 unreleased commit for a component that a full
  // clone correctly reported as 0 — which would have proposed a patch release
  // for nothing. A wrong commit list also means a wrong suggestedBump, so this
  // is a blocker rather than a note: every number below it is untrustworthy.
  if (git(['rev-parse', '--is-shallow-repository'], { cwd: repoPath }).stdout.trim() === 'true') {
    blockers.push({
      id: 'shallow-clone',
      detail: 'this is a shallow clone, so commit ranges and the bump derived from them cannot be trusted — run `git fetch --unshallow` first',
    });
  }
  if (!fetched || fetched.status !== 0) {
    notes.push(`could not fetch origin (${fetched?.stderr || 'unknown error'}) — versions and tags below may be stale`);
  }
  if (!onMain.ok) blockers.push({ id: 'version-unreadable-on-main', detail: onMain.error });
  if (!onDev.ok) blockers.push({ id: 'version-unreadable-on-dev', detail: onDev.error });

  const changelogAbs = join(repoPath, component.changelog);
  if (!existsSync(changelogAbs)) {
    blockers.push({ id: 'changelog-missing', detail: `${component.changelog} does not exist — releases here carry notes from it` });
  }
  const workflowAbs = join(repoPath, '.github', 'workflows', component.workflowFile);
  if (!existsSync(workflowAbs)) {
    blockers.push({ id: 'release-workflow-missing', detail: `.github/workflows/${component.workflowFile} does not exist — nothing would cut the tag` });
  }
  // Only THIS component's own files count as blocking dirt. Unrelated
  // uncommitted work is normal and routine (this monorepo's tree had four
  // unrelated modified files and an untracked skill while this was written);
  // blocking on it would make the command unusable, and prepare() works in an
  // isolated worktree precisely so it cannot sweep that work up.
  const ownDirt = dirtyPaths(repoPath, [...component.versionFiles, component.changelog]);
  if (ownDirt.length > 0) {
    blockers.push({ id: 'component-files-dirty', detail: `uncommitted changes in ${ownDirt.join(', ')} — commit or stash them first` });
  }
  const otherDirt = git(['status', '--porcelain'], { cwd: repoPath }).stdout.split('\n').filter(Boolean).length - ownDirt.length;
  if (otherDirt > 0) notes.push(`${otherDirt} unrelated file(s) are dirty in the working tree — left alone; prepare() works in an isolated worktree`);

  let state = 'unknown';
  if (onMain.ok && lastVersion) {
    const c = cmpSemver(onMain.version, lastVersion);
    if (c > 0) state = 'untagged-bump-on-main';
    else if (c < 0) {
      state = 'version-behind-tag';
      blockers.push({ id: 'version-behind-tag', detail: `${mainBranch} carries ${onMain.version} but ${lastTag} is already tagged` });
    } else if (onDev.ok && cmpSemver(onDev.version, onMain.version) > 0) state = 'bump-on-dev-unpromoted';
    else state = 'clean';
  } else if (onMain.ok && !lastVersion) {
    state = 'untagged-bump-on-main'; // never released; whatever is on main is the first release
  }

  const since = commitsSince(repoPath, component, lastTag, mainRef);
  const suggestion = suggestBump(since.commits, onMain.version ?? '0.0.0');
  const nextVersion = suggestion.bump && onMain.ok ? bumpSemver(onMain.version, suggestion.bump) : null;

  const collateral = collateralComponents(repoPath, config, name, devRef);

  // The TOCTOU guard for cut(). Everything that could change the meaning of a
  // release decision between the moment it is shown to a human and the moment
  // it is acted on: both branch heads, the versions, the last tag, and who
  // else is riding along.
  const statusHash = sha256(
    JSON.stringify({
      component: name,
      mainSha: revParse(repoPath, mainRef),
      devSha: revParse(repoPath, devRef),
      versionOnMain: onMain.version,
      versionOnDev: onDev.version,
      lastTag,
      collateral: collateral.map((c) => `${c.name}@${c.version ?? '?'}`).sort(),
    })
  );

  return {
    component: {
      name,
      versionFiles: component.versionFiles,
      changelog: component.changelog,
      workflowFile: component.workflowFile,
      paths: component.paths,
      inferredLayout: component.inferredLayout,
    },
    state,
    versionOnMain: onMain.version,
    versionOnDev: onDev.version,
    versionSources: onMain.sources,
    lastTag,
    commits: since.commits,
    suggestedBump: suggestion.bump,
    suggestedBumpReason: suggestion.reason,
    suggestedBumpCapped: suggestion.capped,
    nextVersion,
    collateral,
    blockers,
    notes,
    statusHash,
  };
}

// ─── prepare ─────────────────────────────────────────────────────────────────
function writeVersionInto(relPath, text, version) {
  if (relPath.endsWith('.json')) {
    // Line-targeted rather than JSON.parse → JSON.stringify: reserializing
    // would reformat the whole file (key order, indentation, trailing
    // newline), turning a one-line version bump into an unreviewable diff and
    // breaking press's byte-exact region checks in files that carry them.
    const re = /^(\s*"version"\s*:\s*")([^"]*)(")/m;
    if (!re.test(text)) return null;
    return text.replace(re, `$1${version}$3`);
  }
  if (relPath.endsWith('.md')) {
    const lines = text.split('\n');
    if (lines[0]?.trim() !== '---') return null;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') return null;
      if (/^version:\s*/.test(lines[i])) {
        lines[i] = `version: ${version}`;
        return lines.join('\n');
      }
    }
    return null;
  }
  if (relPath.endsWith('.toml')) {
    return TOML_VERSION_RE.test(text) ? text.replace(TOML_VERSION_RE, (m, v) => m.replace(v, version)) : null;
  }
  if (relPath.endsWith('.yml') || relPath.endsWith('.yaml')) {
    return YAML_VERSION_RE.test(text) ? text.replace(YAML_VERSION_RE, (m, v) => m.replace(v, version)) : null;
  }
  return null;
}

// Keep-a-Changelog shape, matching what _release.yml's awk already extracts:
// the notes for a release are the lines under the first `## ` heading
// containing the version, up to the next `## `.
export function spliceChangelog(existing, version, notes, date) {
  const heading = `## [${version}] - ${date}`;
  // Plain string matching, deliberately not a constructed regex. Two reasons,
  // and the second is why this is not merely a style preference:
  //
  //   1. It is exactly what _release.yml's awk does — `/^## / && index($0, ver)`
  //      — so "would this heading be found at release time?" is answered by the
  //      same test that will actually answer it.
  //   2. Building `new RegExp` from `version` escaped only dots, leaving every
  //      other metacharacter (`\`, `*`, `+`, `(`, `[`) live. `prepare` rejects a
  //      non-semver version before reaching here, but this function is exported
  //      and independently callable, so it must not depend on a caller's guard.
  //      Found by CodeQL (js/incomplete-sanitization, high) on PR #158.
  const alreadyPresent = existing
    .split('\n')
    .some((line) => line.startsWith('## ') && line.includes(version));
  if (alreadyPresent) {
    return { ok: false, error: `CHANGELOG already has a heading for ${version}` };
  }
  const lines = existing.split('\n');
  // Insert above the first existing release heading, so the newest release is
  // at the top and any preamble (title, Keep-a-Changelog blurb) is preserved.
  const firstHeading = lines.findIndex((l) => /^## /.test(l));
  const block = [heading, '', notes.trim(), ''];
  if (firstHeading === -1) {
    return { ok: true, content: `${existing.trimEnd()}\n\n${block.join('\n')}\n` };
  }
  lines.splice(firstHeading, 0, ...block);
  return { ok: true, content: lines.join('\n') };
}

export const releaseBranchName = (name, version) => `feature/release-${name}-v${version}`;
const worktreeDir = (name, version) => join(tmpdir(), `shipflow-release-${name}-${version}`);

export function prepare(repoPath, config, name, version, notes, { date, featureBranchPrefix } = {}) {
  const component = resolveComponent(repoPath, config, name);
  const devBranch = config?.branches?.dev ?? 'dev';
  const tag = tagFor(component, version);
  const stamp = date ?? new Date().toISOString().slice(0, 10);

  if (!parseSemver(version)) return { ok: false, error: `"${version}" is not a valid semver version` };
  if (tagExistsLocally(repoPath, tag)) return { ok: false, error: `${tag} already exists — pick a higher version` };

  const onMain = readVersionAt(repoPath, component, revParse(repoPath, `origin/${config?.branches?.main ?? 'main'}`) ? `origin/${config?.branches?.main ?? 'main'}` : (config?.branches?.main ?? 'main'));
  const onDev = readVersionAt(repoPath, component, revParse(repoPath, `origin/${devBranch}`) ? `origin/${devBranch}` : devBranch);
  for (const [where, read] of [['main', onMain], ['dev', onDev]]) {
    if (read.ok && cmpSemver(version, read.version) <= 0) {
      return { ok: false, error: `${version} is not higher than the ${read.version} already on ${where}` };
    }
  }

  const branch = releaseBranchName(name, version);
  if (featureBranchPrefix && !branch.startsWith(featureBranchPrefix)) {
    return { ok: false, error: `release branch ${branch} does not start with the configured featureBranchPrefix ${featureBranchPrefix}` };
  }
  const dir = worktreeDir(name, version);

  // A leftover worktree from an aborted run must not silently become the base
  // for this one — remove it, then re-create from the CURRENT dev.
  rmSync(dir, { recursive: true, force: true });
  git(['worktree', 'prune'], { cwd: repoPath });
  git(['branch', '-D', branch], { cwd: repoPath });
  const base = revParse(repoPath, `origin/${devBranch}`) ? `origin/${devBranch}` : devBranch;
  const added = git(['worktree', 'add', '-b', branch, dir, base], { cwd: repoPath });
  if (added.status !== 0) return { ok: false, error: `git worktree add failed: ${added.stderr}` };

  const changed = [];
  try {
    for (const relPath of component.versionFiles) {
      const abs = join(dir, relPath);
      if (!existsSync(abs)) continue;
      const before = readFileCapped(abs);
      const after = writeVersionInto(relPath, before, version);
      if (after === null) {
        return { ok: false, error: `could not find a version field to rewrite in ${relPath}` };
      }
      if (after !== before) {
        writeFileSync(abs, after);
        changed.push(relPath);
      }
    }
    if (changed.length === 0) {
      return { ok: false, error: `no version file was changed — is ${version} already the version on ${devBranch}?` };
    }

    const clAbs = join(dir, component.changelog);
    if (!existsSync(clAbs)) return { ok: false, error: `${component.changelog} does not exist` };
    const spliced = spliceChangelog(readFileCapped(clAbs), version, notes, stamp);
    if (!spliced.ok) return { ok: false, error: spliced.error };
    writeFileSync(clAbs, spliced.content);
    changed.push(component.changelog);

    // Explicit pathspecs, never `git add -A`. The worktree should contain
    // nothing else, but "should" is not a guarantee worth a release commit.
    const staged = git(['add', '--', ...changed], { cwd: dir });
    if (staged.status !== 0) return { ok: false, error: `git add failed: ${staged.stderr}` };
    const committed = git(['commit', '-m', `chore(${name}): release v${version}`], { cwd: dir });
    if (committed.status !== 0) return { ok: false, error: `git commit failed: ${committed.stderr}` };

    const diff = git(['show', '--stat', '--format=', 'HEAD'], { cwd: dir });
    return { ok: true, branch, worktree: dir, tag, version, changed, diffstat: diff.stdout };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

// ─── cut ─────────────────────────────────────────────────────────────────────
// Resumable and bounded on purpose. The full path (feature PR → checks → merge
// → promotion → auto-merge → release run → tag) routinely takes longer than a
// single tool call is allowed to block for, so cut() advances as far as it can
// within `waitSeconds`, then returns the stage it is parked at. Calling it
// again picks up from wherever the remote actually is — it derives every stage
// from live state, never from a local record of what a previous call did, so an
// interrupted run and a fresh one are the same code path.
const STAGES = ['push', 'feature-pr', 'feature-merged', 'promotion-open', 'promotion-merged', 'tag'];

function prNumberFor(ownerRepo, head, base) {
  const r = ghApiJson(`repos/${ownerRepo}/pulls?head=${encodeURIComponent(head)}&base=${encodeURIComponent(base)}&state=open`);
  if (!r.ok) return null;
  return r.data?.[0]?.number ?? null;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function cut(repoPath, config, name, { waitSeconds = 240, expectStatusHash = null, skipHashCheck = false, ownerRepo, pollSeconds = 15 } = {}) {
  const component = resolveComponent(repoPath, config, name);
  const mainBranch = config?.branches?.main ?? 'main';
  const devBranch = config?.branches?.dev ?? 'dev';
  const owner = ownerRepo.split('/')[0];

  const status = readStatus(repoPath, config, name);
  if (!skipHashCheck) {
    if (!expectStatusHash) {
      return { ok: false, error: '--expect-status-hash is required (or the explicit --skip-hash-check escape hatch). Re-run release-status and pass its statusHash.' };
    }
    if (expectStatusHash !== status.statusHash) {
      return { ok: false, error: 'toctou: repo state changed since the status you confirmed — re-run release-status, re-confirm, and pass the new hash', currentStatusHash: status.statusHash };
    }
  }

  const targetVersion = status.versionOnDev ?? status.versionOnMain;
  const tag = tagFor(component, targetVersion);
  const branch = releaseBranchName(name, targetVersion);
  const deadline = Date.now() + waitSeconds * 1000;
  const log = [];
  const note = (stage, msg) => log.push({ stage, msg });

  // Fast path: the bump is already on main and simply was never tagged (a
  // failed or cancelled push run). No PR is needed at all — dispatch and prove.
  if (status.state === 'untagged-bump-on-main') {
    const already = tagExistsOnRemote(repoPath, tagFor(component, status.versionOnMain));
    if (already.ok && already.exists) {
      return { ok: true, done: true, stage: 'tag', tag: tagFor(component, status.versionOnMain), note: 'already released' };
    }
    const d = spawnArgs('gh', ['workflow', 'run', component.workflowFile, '--ref', mainBranch, '--repo', ownerRepo]);
    if (d.status !== 0) return { ok: false, error: `workflow dispatch failed: ${d.stderr}` };
    note('dispatch', `dispatched ${component.workflowFile} on ${mainBranch}`);
    return waitForTag(repoPath, tagFor(component, status.versionOnMain), deadline, pollSeconds, log, ownerRepo, null);
  }

  // 1. push the prepared branch
  if (!revParse(repoPath, branch)) {
    return { ok: false, error: `branch ${branch} does not exist — run release-prepare first` };
  }
  const dir = worktreeDir(name, targetVersion);
  const pushCwd = existsSync(dir) ? dir : repoPath;
  if (!revParse(repoPath, `origin/${branch}`)) {
    const pushed = git(['push', '-u', 'origin', branch], { cwd: pushCwd });
    if (pushed.status !== 0) return { ok: false, error: `git push failed: ${pushed.stderr}` };
    note('push', `pushed ${branch}`);
  }

  // 2. open the feature → dev PR
  let featurePr = prNumberFor(ownerRepo, `${owner}:${branch}`, devBranch);
  if (!featurePr) {
    const devHasIt = readVersionAt(repoPath, component, `origin/${devBranch}`);
    if (devHasIt.ok && cmpSemver(devHasIt.version, targetVersion) >= 0) {
      note('feature-merged', `${targetVersion} is already on ${devBranch}`);
    } else {
      const created = spawnArgs('gh', [
        'pr', 'create', '--repo', ownerRepo, '--base', devBranch, '--head', branch,
        '--title', `chore(${name}): release v${targetVersion}`,
        '--body', `Release ${tag}.\n\nVersion bump and CHANGELOG entry land together, in this one change — releases here are publish-on-merge, so a follow-up promotion to fix notes is too late.`,
      ]);
      if (created.status !== 0) return { ok: false, error: `gh pr create failed: ${created.stderr}` };
      featurePr = prNumberFor(ownerRepo, `${owner}:${branch}`, devBranch);
      note('feature-pr', `opened #${featurePr}`);
    }
  }

  // 3. wait for its checks, then squash it into dev
  if (featurePr) {
    const gate = waitForChecks(ownerRepo, featurePr, deadline, pollSeconds, log);
    if (!gate.ok) return gate;
    if (!gate.done) return { ok: true, done: false, stage: 'feature-pr', featurePr, tag, log, next: 'call release-cut again — waiting on the feature PR’s checks' };
    const method = config?.mergeMethod?.featureToDevMethod ?? 'squash';
    const merged = spawnArgs('gh', ['pr', 'merge', String(featurePr), '--repo', ownerRepo, `--${method}`, '--delete-branch']);
    if (merged.status !== 0) return { ok: false, error: `gh pr merge failed on the feature PR: ${merged.stderr}` };
    note('feature-merged', `merged #${featurePr} into ${devBranch} (${method})`);
    rmSync(dir, { recursive: true, force: true });
    git(['worktree', 'prune'], { cwd: repoPath });
  }

  // 4. open (or find) the dev → main promotion. shipflow's rendered auto-merge
  //    workflow turns on native auto-merge from here; nothing polls for it.
  git(['fetch', 'origin', '--prune'], { cwd: repoPath });
  let promotion = prNumberFor(ownerRepo, `${owner}:${devBranch}`, mainBranch);
  if (!promotion) {
    const created = spawnArgs('gh', [
      'pr', 'create', '--repo', ownerRepo, '--base', mainBranch, '--head', devBranch,
      '--title', `release: ${name} v${targetVersion}`,
      '--body', releaseBody(name, targetVersion, status.collateral),
    ]);
    if (created.status !== 0) return { ok: false, error: `gh pr create failed on the promotion: ${created.stderr}` };
    promotion = prNumberFor(ownerRepo, `${owner}:${devBranch}`, mainBranch);
    note('promotion-open', `opened promotion #${promotion}`);
  } else {
    note('promotion-open', `promotion #${promotion} already open`);
  }

  // 5. wait for the promotion to auto-merge, then for the tag to appear
  const landed = waitForMerge(ownerRepo, promotion, deadline, pollSeconds, log);
  if (!landed.ok) return landed;
  if (!landed.done) {
    return { ok: true, done: false, stage: 'promotion-open', promotion, tag, log, next: 'call release-cut again — waiting on the promotion to auto-merge' };
  }
  return waitForTag(repoPath, tag, deadline, pollSeconds, log, ownerRepo, promotion);
}

function releaseBody(name, version, collateral) {
  const extra = collateral.length
    ? `\n\n**This promotion also releases:** ${collateral.map((c) => `\`${c.tag}\``).join(', ')} — a promotion is atomic and carries all of dev.`
    : '';
  return `Promotes \`${name}\` v${version} to main.${extra}`;
}

function waitForChecks(ownerRepo, prNumber, deadline, pollSeconds, log) {
  for (;;) {
    const r = ghApiJson(`repos/${ownerRepo}/pulls/${prNumber}`);
    if (!r.ok) return { ok: false, error: `could not read PR #${prNumber}: ${r.stderr}` };
    const sha = r.data?.head?.sha;
    const cr = ghApiJson(`repos/${ownerRepo}/commits/${sha}/check-runs?per_page=100`);
    if (!cr.ok) return { ok: false, error: `could not read check runs: ${cr.stderr}` };
    const runs = cr.data?.check_runs ?? [];
    const pending = runs.filter((c) => c.status !== 'completed');
    const failed = runs.filter((c) => c.status === 'completed' && !['success', 'neutral', 'skipped'].includes(c.conclusion));
    if (failed.length > 0) {
      return { ok: false, error: `checks failed on PR #${prNumber}: ${failed.map((c) => c.name).join(', ')} — fix them, then call release-cut again` };
    }
    if (runs.length > 0 && pending.length === 0) {
      log.push({ stage: 'feature-pr', msg: `${runs.length} checks green` });
      return { ok: true, done: true };
    }
    if (Date.now() + pollSeconds * 1000 > deadline) {
      log.push({ stage: 'feature-pr', msg: `${pending.length}/${runs.length} checks still running` });
      return { ok: true, done: false };
    }
    sleepSync(pollSeconds * 1000);
  }
}

function waitForMerge(ownerRepo, prNumber, deadline, pollSeconds, log) {
  for (;;) {
    const r = ghApiJson(`repos/${ownerRepo}/pulls/${prNumber}`);
    if (!r.ok) return { ok: false, error: `could not read PR #${prNumber}: ${r.stderr}` };
    if (r.data?.merged === true) {
      log.push({ stage: 'promotion-merged', msg: `#${prNumber} merged` });
      return { ok: true, done: true };
    }
    if (r.data?.state === 'closed') {
      return { ok: false, error: `promotion #${prNumber} was closed without merging` };
    }
    if (Date.now() + pollSeconds * 1000 > deadline) return { ok: true, done: false };
    sleepSync(pollSeconds * 1000);
  }
}

// The one thing that counts. Not the dispatch, not the merge, not a green
// check — the tag, fetched back from origin.
function waitForTag(repoPath, tag, deadline, pollSeconds, log, ownerRepo, promotionPr) {
  for (;;) {
    const t = tagExistsOnRemote(repoPath, tag);
    if (t.ok && t.exists) {
      log.push({ stage: 'tag', msg: `${tag} exists on origin` });
      const rel = ghApiJson(`repos/${ownerRepo}/releases/tags/${tag}`);
      // Clearing the label is what stops `shipflow releases` resurfacing a
      // promotion this command already released, forever.
      let labelCleared = null;
      if (promotionPr) {
        const c = ghApiJson(`repos/${ownerRepo}/issues/${promotionPr}/labels/release-pending`, ['-X', 'DELETE']);
        labelCleared = c.ok;
      }
      return {
        ok: true, done: true, stage: 'tag', tag,
        releaseUrl: rel.ok ? rel.data?.html_url ?? null : null,
        releaseNotes: rel.ok ? rel.data?.body ?? null : null,
        labelCleared, log,
      };
    }
    if (Date.now() + pollSeconds * 1000 > deadline) {
      return { ok: true, done: false, stage: 'promotion-merged', tag, log, next: `call release-cut again — ${tag} is not on origin yet` };
    }
    sleepSync(pollSeconds * 1000);
  }
}

export { STAGES };
