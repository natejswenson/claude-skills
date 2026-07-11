#!/usr/bin/env node
import { spawn, spawnSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, renameSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import prompts from 'prompts';
import kleur from 'kleur';

// ─── shared validators (single source of truth, also used by SKILL.md guidance) ───
//
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

const require = createRequire(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_SRC = join(PACKAGE_ROOT, 'SKILL.md');
const CONFIG_DIR = join(homedir(), '.claude', 'skills', 'devlog');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const SKILL_DEST = join(CONFIG_DIR, 'SKILL.md');
const PREVIEW_DIR = join(PACKAGE_ROOT, 'preview');
const VOICE_SRC_DIR = join(PACKAGE_ROOT, 'voice');
const VOICE_DEST_DIR = join(CONFIG_DIR, 'voice');
const GHOSTWRITER_VOICE_DIR = join(homedir(), '.claude', 'ghostwriter', 'voice');

const log = {
  info: (msg) => console.log(msg),
  ok: (msg) => console.log(kleur.green('✓ ') + msg),
  warn: (msg) => console.log(kleur.yellow('! ') + msg),
  err: (msg) => console.error(kleur.red('✗ ') + msg),
  step: (msg) => console.log(kleur.cyan('→ ') + msg),
  hint: (msg) => console.log(kleur.dim('  ' + msg)),
};

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

// Hardcoded shell command, no user input. Use tryExecArgs for anything user-supplied.
function tryExec(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// argv-style invocation; no shell, so user-supplied args cannot inject.
function tryExecArgs(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    if (r.status !== 0) return null;
    return (r.stdout || '').trim();
  } catch {
    return null;
  }
}

export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

// Atomic write: write to sibling tmp file then rename.
// Prevents readers from seeing a half-written config if process is killed mid-write.
// Uses `wx` (exclusive create) flag to prevent symlink-attack on shared filesystems
// — if an attacker pre-creates the tmp file, our write fails rather than following
// the symlink to a sensitive target.
function atomicWriteJSON(path, data) {
  const tmp = path + '.tmp.' + process.pid + '.' + Date.now();
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  try {
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch {}
    throw e;
  }
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

function readConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  const raw = readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

async function preflight() {
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 18) {
    log.err(`Node 18+ required (you have ${process.versions.node}).`);
    log.hint('Update Node: https://nodejs.org/');
    process.exit(1);
  }
  if (!tryExec('gh --version')) {
    log.err('GitHub CLI (`gh`) is not installed.');
    log.hint('Install: https://cli.github.com/   then run `gh auth login`');
    process.exit(1);
  }
  if (!tryExec('gh auth status')) {
    log.err('GitHub CLI is not authenticated.');
    log.hint('Run: gh auth login');
    process.exit(1);
  }
}

function detectGhUser() {
  return tryExec('gh api user --jq .login') || null;
}

function detectGitName() {
  return tryExec('git config --global user.name');
}

function detectProjectRemote(path) {
  const url = tryExecArgs('git', ['-C', path, 'remote', 'get-url', 'origin']);
  if (!url) return null;
  const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return m ? m[1] : null;
}

async function confirmOverwrite(label, path) {
  if (!existsSync(path)) return true;
  const { ok } = await prompts({
    type: 'confirm',
    name: 'ok',
    message: `${label} already exists at ${path}. Overwrite?`,
    initial: false,
  }, { onCancel: () => process.exit(1) });
  return ok === true;
}

// ─── prompt validators (reused across init and add-project) ──────────────────
export const VALIDATORS = {
  gitAuthor: (v) => {
    if (v.trim().length === 0) return 'Required';
    if (SHELL_QUOTE_BREAK.test(v)) return 'Invalid characters (no quotes, backticks, dollar signs, semicolons, parens, or shell metacharacters)';
    return true;
  },
  githubUser: (v) => RE_GH_USER.test(v.trim()) || 'Invalid username (must start with letter/digit, alphanumeric + hyphens only)',
  targetRepoName: (v) => RE_REPO_NAME.test(v.trim()) || 'Invalid repo name (must start with letter/digit, no leading dash)',
  path: (v) => {
    if (SHELL_QUOTE_BREAK.test(v)) return 'Invalid characters (no quotes, backticks, dollar signs, semicolons, parens, or shell metacharacters)';
    if (v.trim().startsWith('-')) return 'Path cannot start with a dash';
    return existsSync(expandHome(v)) || 'Path does not exist';
  },
  projectKey: (v) => {
    const t = v.trim();
    if (!RE_PROJECT_KEY.test(t)) return 'Invalid key (must start with letter/digit, alphanumeric + ._- only)';
    if (t.includes('..')) return 'Invalid key (no `..`)';
    return true;
  },
  ownerRepo: (v) => RE_OWNER_REPO.test(v.trim()) || 'Expected <owner>/<repo>, no leading dash, alphanumeric + ._- only',
  voicePath: (v) => {
    // Optional. Blank means "use ghostwriter's voice dir if present, else the bundled default".
    if (!v || v.trim() === '') return true;
    if (SHELL_QUOTE_BREAK.test(v)) return 'Invalid characters (no quotes, backticks, dollar signs, semicolons, parens, or shell metacharacters)';
    if (v.trim().startsWith('-')) return 'Path cannot start with a dash';
    return existsSync(expandHome(v.trim())) || 'Path does not exist';
  },
  tagPrefix: (v) => {
    // Optional. Blank/`v` is the default. Used in `git tag --list '<prefix>*'`.
    const t = (v || '').trim();
    if (t === '') return true;
    if (!RE_TAG_PREFIX.test(t) || FORBIDDEN_BRANCH_PARTS.test(t)) return 'Invalid prefix (no leading dash/slash, no "..", no shell metacharacters)';
    return true;
  },
  label: (v) => {
    // Label is React text content only — apostrophes and most punctuation are fine.
    // Reject only control chars and overlong values.
    if (typeof v !== 'string') return true; // optional field
    if (v.length > 200) return 'Label too long (max 200 chars)';
    if (/[\x00-\x1f]/.test(v)) return 'Label contains control characters';
    return true;
  },
};

// Prompt for a single project's fields. Returns { key, path, remote, label } or null on cancel.
async function promptForProject(defaults = {}) {
  const initialPath = defaults.path || process.cwd();
  const initialKey = defaults.key || basename(expandHome(initialPath));
  const initialRemote = defaults.remote || detectProjectRemote(expandHome(initialPath)) || '';

  const answers = await prompts([
    {
      type: 'text',
      name: 'path',
      message: 'Project absolute path:',
      initial: initialPath,
      validate: VALIDATORS.path,
    },
    {
      type: 'text',
      name: 'key',
      message: 'Project key (used as dev-log subdir name):',
      initial: (_p, values) => basename(expandHome(values.path || initialKey)),
      validate: VALIDATORS.projectKey,
    },
    {
      type: 'text',
      name: 'label',
      message: 'Project display label (optional, defaults to key):',
      initial: '',
      validate: VALIDATORS.label,
    },
    {
      type: 'text',
      name: 'remote',
      message: 'Project GitHub remote (<owner>/<repo>):',
      initial: (_p, values) => detectProjectRemote(expandHome(values.path)) || initialRemote,
      validate: VALIDATORS.ownerRepo,
    },
    {
      type: 'text',
      name: 'tagPrefix',
      message: 'Release tag prefix (optional, e.g. "v" or "myproject-v"):',
      initial: defaults.tagPrefix || 'v',
      validate: VALIDATORS.tagPrefix,
    },
  ], { onCancel: () => process.exit(1) });

  const out = {
    key: answers.key.trim(),
    path: expandHome(answers.path),
    remote: answers.remote.trim(),
  };
  if (answers.label && answers.label.trim()) out.label = answers.label.trim();
  // Only persist tagPrefix when it differs from the default `v` (keeps configs clean).
  const tagPrefix = (answers.tagPrefix || '').trim();
  if (tagPrefix && tagPrefix !== 'v') out.tagPrefix = tagPrefix;
  return out;
}

// ─── init ────────────────────────────────────────────────────────────────────
async function cmdInit() {
  log.info(kleur.bold('\ndevlog setup\n'));
  await preflight();

  const defaults = {
    gitAuthor: detectGitName() || '',
    githubUser: detectGhUser() || '',
    targetRepoName: 'daily-dev-log',
    // Pre-fill the voice path with ghostwriter's voice dir if it's installed — that's
    // the most likely place a user already keeps their voice profile.
    voicePath: existsSync(GHOSTWRITER_VOICE_DIR) ? GHOSTWRITER_VOICE_DIR : '',
  };

  const answers = await prompts([
    { type: 'text', name: 'gitAuthor', message: 'Your name (retained for backward compatibility; not currently rendered on entries):', initial: defaults.gitAuthor, validate: VALIDATORS.gitAuthor },
    { type: 'text', name: 'githubUser', message: 'Your GitHub username:', initial: defaults.githubUser, validate: VALIDATORS.githubUser },
    { type: 'text', name: 'targetRepoName', message: 'Name of the repo where dev logs will be published:', initial: defaults.targetRepoName, validate: VALIDATORS.targetRepoName },
    { type: 'text', name: 'voicePath', message: 'Voice profile directory (optional — blank uses ghostwriter\'s if present, else the bundled default):', initial: defaults.voicePath, validate: VALIDATORS.voicePath },
  ], { onCancel: () => process.exit(1) });

  // Optionally register projects in a loop. First time defaults to "yes".
  const projects = [];
  let registerAnother = true;
  let firstPrompt = true;
  while (registerAnother) {
    const { add } = await prompts({
      type: 'confirm',
      name: 'add',
      message: firstPrompt ? 'Register a project now?' : 'Register another project?',
      initial: firstPrompt,
    }, { onCancel: () => process.exit(1) });
    firstPrompt = false;
    if (!add) break;
    const p = await promptForProject();
    if (projects.find((x) => x.key === p.key)) {
      log.warn(`Skipped (duplicate key): ${p.key}`);
      continue;
    }
    projects.push(p);
    log.ok(`Registered: ${p.key}`);
  }

  const targetRepo = `${answers.githubUser}/${answers.targetRepoName}`;
  // Store the expanded absolute path (consistent with project.path) so the persisted
  // config never carries a `~` that would later trip the shell-quote-break check.
  const rawVoicePath = (answers.voicePath || '').trim();
  const voicePath = rawVoicePath ? expandHome(rawVoicePath) : '';
  const config = validateConfig({
    targetRepo,
    branch: 'main',
    gitAuthor: answers.gitAuthor,
    githubUser: answers.githubUser,
    ...(voicePath ? { voicePath } : {}),
    projects,
  });

  // Sanity check: warn if the gh-authenticated user differs from githubUser.
  // Common mistake on machines with multiple gh logins.
  const ghUser = detectGhUser();
  if (ghUser && ghUser !== config.githubUser) {
    log.warn(`gh is authenticated as "${ghUser}" but config.githubUser is "${config.githubUser}".`);
    log.hint('Run `gh auth login` to switch accounts, or update config.githubUser.');
  }

  log.info('\n' + kleur.bold('Summary:'));
  log.info(`  Target repo:    ${kleur.cyan(`github.com/${targetRepo}`)}`);
  log.info(`  Git author:     ${config.gitAuthor}`);
  log.info(`  GitHub user:    ${config.githubUser}`);
  log.info(`  Branch:         ${config.branch}`);
  log.info(`  Voice profile:  ${config.voicePath || '(ghostwriter if present, else bundled default)'}`);
  log.info(`  Projects:       ${config.projects.length === 0 ? '(none — add later with `devlog add-project`)' : config.projects.map((p) => p.key).join(', ')}`);
  log.info(`  Skill location: ${CONFIG_DIR}`);

  const { proceed } = await prompts({ type: 'confirm', name: 'proceed', message: 'Continue?', initial: true }, { onCancel: () => process.exit(1) });
  if (!proceed) process.exit(0);
  log.info('');

  // Repo create — argv form, no shell.
  const repoExists = tryExecArgs('gh', ['repo', 'view', targetRepo, '--json', 'name']) !== null;
  if (repoExists) {
    log.warn(`Repo github.com/${targetRepo} already exists. Will use it as-is.`);
  } else {
    log.step(`Creating github.com/${targetRepo}...`);
    const r = spawnSync('gh', ['repo', 'create', targetRepo, '--public', '--description', 'Release dev log', '--add-readme'], { stdio: 'inherit' });
    if (r.status !== 0) {
      log.err('Failed to create repo. Check `gh` permissions.');
      process.exit(1);
    }
    log.ok('Repo created');
  }

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    log.ok(`Created ${CONFIG_DIR}`);
  }

  if (await confirmOverwrite('SKILL.md', SKILL_DEST)) {
    copyFileSync(SKILL_SRC, SKILL_DEST);
    log.ok(`Installed SKILL.md → ${SKILL_DEST}`);
  } else {
    log.warn('Skipped SKILL.md');
  }

  if (await confirmOverwrite('config.json', CONFIG_PATH)) {
    atomicWriteJSON(CONFIG_PATH, config);
    log.ok(`Wrote config → ${CONFIG_PATH}`);
  } else {
    log.warn('Skipped config.json');
  }

  // Install the bundled voice template as the fallback voice profile. The skill
  // resolves voice in this order: config.voicePath → ghostwriter's voice dir →
  // this bundled copy. Installing it guarantees the last fallback always exists.
  if (!existsSync(VOICE_DEST_DIR)) {
    mkdirSync(VOICE_DEST_DIR, { recursive: true, mode: 0o700 });
  }
  for (const [src, dest] of [['voice-profile.example.md', 'voice-profile.md'], ['voice-notes.example.md', 'voice-notes.md']]) {
    const s = join(VOICE_SRC_DIR, src);
    const d = join(VOICE_DEST_DIR, dest);
    if (existsSync(s) && (await confirmOverwrite(`voice/${dest}`, d))) {
      copyFileSync(s, d);
      log.ok(`Installed voice/${dest} → ${d}`);
    }
  }

  log.info('\n' + kleur.bold().green('Setup complete.') + '\n');
  log.info('Next steps:');
  if (config.projects.length === 0) {
    log.info(`  1. Add a project: ${kleur.cyan('npx @natjswenson/devlog add-project')}`);
    log.info('  2. Tag a release in the project (e.g. `git tag v0.1.0`)');
    log.info(`  3. In Claude Code, run: ${kleur.cyan('/devlog')}`);
    log.info(`  4. Preview locally: ${kleur.cyan('npx @natjswenson/devlog preview')}`);
  } else {
    log.info('  1. Tag a release in a registered project (e.g. `git tag v0.1.0`)');
    log.info(`  2. In Claude Code, run: ${kleur.cyan('/devlog')}`);
    log.info(`  3. Preview locally: ${kleur.cyan('npx @natjswenson/devlog preview')}`);
  }
  log.info('');
}

// ─── add-project ─────────────────────────────────────────────────────────────
async function cmdAddProject() {
  log.info(kleur.bold('\ndevlog add-project\n'));
  if (!existsSync(CONFIG_PATH)) {
    log.err(`No config found at ${CONFIG_PATH}`);
    log.hint('Run `npx @natjswenson/devlog init` first.');
    process.exit(1);
  }

  let config;
  try {
    config = readConfig();
    validateConfig(config);
  } catch (e) {
    log.err(`Existing config is invalid: ${e.message}`);
    log.hint(`Edit ${CONFIG_PATH} or run \`devlog init\` to recreate.`);
    process.exit(1);
  }

  if (config.projects.length > 0) {
    log.info(kleur.dim('Currently registered projects:'));
    for (const p of config.projects) log.info(kleur.dim(`  - ${p.key}  (${p.path})`));
    log.info('');
  }

  const newProject = await promptForProject();
  if (config.projects.find((p) => p.key === newProject.key)) {
    log.err(`Project key "${newProject.key}" is already registered.`);
    log.hint('Pick a different key, or remove the existing entry first.');
    process.exit(1);
  }

  const newConfig = validateConfig({ ...config, projects: [...config.projects, newProject] });
  atomicWriteJSON(CONFIG_PATH, newConfig);
  log.ok(`Added "${newProject.key}" to config.`);
  log.info('');
  log.info(`Run ${kleur.cyan('/devlog ' + newProject.key)} in Claude Code to publish an entry for this project.`);
  log.info('');
}

// ─── config (view) ───────────────────────────────────────────────────────────
async function cmdConfig() {
  if (!existsSync(CONFIG_PATH)) {
    log.err(`No config found at ${CONFIG_PATH}`);
    log.hint('Run `npx @natjswenson/devlog init` first.');
    process.exit(1);
  }

  let config;
  try {
    config = readConfig();
  } catch (e) {
    log.err(`Failed to read config: ${e.message}`);
    process.exit(1);
  }

  let validationStatus;
  try {
    validateConfig(config);
    validationStatus = kleur.green('valid');
  } catch (e) {
    validationStatus = kleur.red('INVALID — ' + e.message);
  }

  log.info('');
  log.info(kleur.bold(`Config: ${CONFIG_PATH}`));
  log.info(`Status:        ${validationStatus}`);
  log.info(`Target repo:   ${kleur.cyan(`github.com/${config.targetRepo || '?'}`)}`);
  log.info(`Branch:        ${config.branch || 'main'}`);
  log.info(`Git author:    ${config.gitAuthor || '?'}`);
  log.info(`GitHub user:   ${config.githubUser || '?'}`);
  log.info(`Voice path:    ${config.voicePath || kleur.dim('(ghostwriter if present, else bundled default)')}`);
  log.info(`Projects (${(config.projects || []).length}):`);
  for (const p of config.projects || []) {
    log.info(`  ${kleur.cyan(p.key)}${p.label ? `  (${p.label})` : ''}`);
    log.info(kleur.dim(`    path:   ${p.path}`));
    log.info(kleur.dim(`    remote: github.com/${p.remote}`));
    if (p.pathFilter) log.info(kleur.dim(`    scope:  ${p.pathFilter}/`));
    log.info(kleur.dim(`    tags:   ${p.tagPrefix || 'v'}*`));
  }
  log.info('');
}

// ─── preview ─────────────────────────────────────────────────────────────────
async function cmdPreview() {
  if (!existsSync(CONFIG_PATH)) {
    log.err(`No config found at ${CONFIG_PATH}`);
    log.hint('Run `npx @natjswenson/devlog init` first.');
    process.exit(1);
  }

  let config;
  try {
    config = readConfig();
    validateConfig(config);
  } catch (e) {
    log.err(`Config validation failed: ${e.message}`);
    log.hint(`Edit ${CONFIG_PATH} or run \`devlog config\` to inspect.`);
    process.exit(1);
  }

  const [owner, repo] = config.targetRepo.split('/');
  const branch = config.branch || 'main';
  const projects = config.projects.map((p) => ({ key: p.key, label: p.label || p.key }));

  if (projects.length === 0) {
    log.warn('No projects registered. The preview will show an empty state.');
    log.hint(`Run \`npx @natjswenson/devlog add-project\` to register one.`);
  }

  log.step(`Launching preview against github.com/${config.targetRepo}...`);

  const vitePkgPath = require.resolve('vite/package.json');
  const vitePkg = JSON.parse(readFileSync(vitePkgPath, 'utf8'));
  const viteBin = resolve(dirname(vitePkgPath), vitePkg.bin?.vite || 'bin/vite.js');

  // Filter env to only PATH/HOME/etc plus VITE_DEVLOG_* we set explicitly.
  // This prevents adopters' arbitrary VITE_* vars (e.g. VITE_API_KEY for an
  // unrelated project in their shell) from being inlined into preview source.
  const SAFE_ENV_KEYS = ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'NODE_PATH', 'NODE_OPTIONS'];
  const safeEnv = {};
  for (const k of SAFE_ENV_KEYS) {
    if (process.env[k] !== undefined) safeEnv[k] = process.env[k];
  }

  const proc = spawn(process.execPath, [viteBin], {
    cwd: PREVIEW_DIR,
    stdio: 'inherit',
    env: {
      ...safeEnv,
      VITE_DEVLOG_OWNER: owner,
      VITE_DEVLOG_REPO: repo,
      VITE_DEVLOG_BRANCH: branch,
      VITE_DEVLOG_PROJECTS: JSON.stringify(projects),
    },
  });
  proc.on('exit', (code) => process.exit(code ?? 0));
}

// ─── help ────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
${kleur.bold('@natjswenson/devlog')} v${readPackageVersion()} — release dev log generator

Usage:
  ${kleur.cyan('npx @natjswenson/devlog init')}           One-time setup: create your dev-log repo, install the skill, write config
  ${kleur.cyan('npx @natjswenson/devlog add-project')}    Register an additional project in your config
  ${kleur.cyan('npx @natjswenson/devlog config')}         Show your current config (with validation)
  ${kleur.cyan('npx @natjswenson/devlog preview')}        Run a local preview of your published dev log
  ${kleur.cyan('npx @natjswenson/devlog --help')}
  ${kleur.cyan('npx @natjswenson/devlog --version')}

Docs:    https://github.com/natejswenson/devlog
Issues:  https://github.com/natejswenson/devlog/issues
`);
}

// ─── dispatch ────────────────────────────────────────────────────────────────
// Only run the CLI dispatch when this file is executed directly, not when it is
// imported (e.g. by the test suite). Importing the module must have no side effects.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = process.argv[2];
  switch (arg) {
    case 'init':
      cmdInit();
      break;
    case 'add-project':
      cmdAddProject();
      break;
    case 'config':
      cmdConfig();
      break;
    case 'preview':
      cmdPreview();
      break;
    case '-v':
    case '--version':
      console.log(readPackageVersion());
      break;
    case undefined:
    case '-h':
    case '--help':
      printHelp();
      break;
    default:
      log.err(`Unknown command: ${arg}`);
      printHelp();
      process.exit(1);
  }
}
