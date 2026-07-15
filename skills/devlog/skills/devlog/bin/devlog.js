#!/usr/bin/env node
import { spawn, spawnSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, copyFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import prompts from 'prompts';
import kleur from 'kleur';

import {
  SHELL_QUOTE_BREAK,
  RE_GH_USER,
  RE_REPO_NAME,
  RE_OWNER_REPO,
  RE_PROJECT_KEY,
  RE_BRANCH,
  RE_PATH_FILTER,
  RE_TAG_PREFIX,
  FORBIDDEN_BRANCH_PARTS,
  CONFIG_DIR,
  CONFIG_PATH,
  expandHome,
  execArgs,
  atomicWriteJSON,
  readConfig,
  validateConfig,
  resolveDeepDive,
} from '../lib/core.mjs';
import { scanAll } from '../lib/scan.mjs';
import { lintPost } from '../lib/lint_post.mjs';
import { publishEntry } from '../lib/publish_entry.mjs';
import { addProject, removeProject, setField, SETTABLE_FIELDS } from '../lib/config_ops.mjs';

// Re-export the shared validators so existing importers (tests, docs) keep a
// single canonical entry point; the definitions live in lib/core.mjs.
export {
  SHELL_QUOTE_BREAK,
  RE_GH_USER,
  RE_REPO_NAME,
  RE_OWNER_REPO,
  RE_PROJECT_KEY,
  RE_BRANCH,
  RE_PATH_FILTER,
  RE_TAG_PREFIX,
  FORBIDDEN_BRANCH_PARTS,
  expandHome,
  validateConfig,
};

const require = createRequire(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_SRC = join(PACKAGE_ROOT, 'SKILL.md');
const SKILL_DEST = join(CONFIG_DIR, 'SKILL.md');
const PREVIEW_DIR = join(PACKAGE_ROOT, 'preview');
const VOICE_SRC_DIR = join(PACKAGE_ROOT, 'voice');
const VOICE_DEST_DIR = join(CONFIG_DIR, 'voice');
const GHOSTWRITER_VOICE_DIR = join(expandHome('~'), '.claude', 'ghostwriter', 'voice');

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

// Hardcoded shell command, no user input. Use execArgs for anything user-supplied.
function tryExec(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// Machine-readable output for agent-driven commands: JSON on stdout, explicit
// exit code, no color.
function emitJSON(obj, exitCode = 0) {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(exitCode);
}

function readValidConfigOrExit({ json = false } = {}) {
  if (!existsSync(CONFIG_PATH)) {
    if (json) emitJSON({ error: 'config-missing', path: CONFIG_PATH, hint: 'Run `npx @natjswenson/devlog init` first.' }, 1);
    log.err(`No config found at ${CONFIG_PATH}`);
    log.hint('Run `npx @natjswenson/devlog init` first.');
    process.exit(1);
  }
  let config;
  try {
    config = readConfig();
    validateConfig(config);
  } catch (e) {
    if (json) emitJSON({ error: 'config-invalid', message: e.message, path: CONFIG_PATH }, 1);
    log.err(`Config is invalid: ${e.message}`);
    log.hint(`Edit ${CONFIG_PATH} or run \`devlog init\` to recreate.`);
    process.exit(1);
  }
  return config;
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
  const url = execArgs('git', ['-C', path, 'remote', 'get-url', 'origin']);
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
      type: 'confirm',
      name: 'private',
      message: 'Is this repo private? (no GitHub commit links will ever be generated)',
      initial: defaults.private || false,
    },
    {
      type: (_p, values) => (values.private ? null : 'text'),
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
  };
  if (answers.remote && answers.remote.trim()) out.remote = answers.remote.trim();
  if (answers.private) out.private = true;
  if (answers.label && answers.label.trim()) out.label = answers.label.trim();
  const tagPrefix = (answers.tagPrefix || '').trim();
  if (tagPrefix) out.tagPrefix = tagPrefix;
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
  let firstPrompt = true;
  for (;;) {
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
    if (p.tagPrefix === 'v') delete p.tagPrefix;
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
  const repoExists = execArgs('gh', ['repo', 'view', targetRepo, '--json', 'name']) !== null;
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
async function cmdAddProject(rest) {
  const { values } = parseArgs({
    args: rest,
    options: {
      path: { type: 'string' },
      key: { type: 'string' },
      remote: { type: 'string' },
      label: { type: 'string' },
      'tag-prefix': { type: 'string' },
      'path-filter': { type: 'string' },
      private: { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  // Non-interactive (agent) path: --yes with at least --path. Everything else
  // is auto-detected the same way the interactive prompts pre-fill.
  if (values.yes) {
    const config = readValidConfigOrExit({ json: true });
    if (!values.path) emitJSON({ error: 'missing-flag', message: 'add-project --yes requires --path' }, 1);
    const path = expandHome(values.path);
    if (!existsSync(path)) emitJSON({ error: 'path-missing', message: `Path does not exist: ${path}` }, 1);
    const key = values.key || basename(path);
    const remote = values.remote || detectProjectRemote(path);
    // A private project never links commits publicly, so an undetectable
    // remote isn't fatal for it — only for a project that intends to be public.
    if (!remote && !values.private) emitJSON({ error: 'remote-undetectable', message: 'No origin remote found; pass --remote <owner>/<repo>.' }, 1);
    try {
      const next = addProject(config, {
        key,
        path,
        remote,
        label: values.label,
        tagPrefix: values['tag-prefix'],
        pathFilter: values['path-filter'],
        private: values.private,
      });
      atomicWriteJSON(CONFIG_PATH, next);
      emitJSON({ ok: true, added: next.projects.at(-1), projects: next.projects.map((p) => p.key) });
    } catch (e) {
      emitJSON({ error: 'invalid-project', message: e.message }, 1);
    }
    return;
  }

  log.info(kleur.bold('\ndevlog add-project\n'));
  const config = readValidConfigOrExit();

  if (config.projects.length > 0) {
    log.info(kleur.dim('Currently registered projects:'));
    for (const p of config.projects) log.info(kleur.dim(`  - ${p.key}  (${p.path})`));
    log.info('');
  }

  const newProject = await promptForProject(values);
  try {
    const next = addProject(config, {
      key: newProject.key,
      path: newProject.path,
      remote: newProject.remote,
      label: newProject.label,
      tagPrefix: newProject.tagPrefix,
      private: newProject.private,
    });
    atomicWriteJSON(CONFIG_PATH, next);
    log.ok(`Added "${newProject.key}" to config.`);
  } catch (e) {
    log.err(e.message);
    log.hint('Pick a different key, or remove the existing entry first.');
    process.exit(1);
  }
  log.info('');
  log.info(`Run ${kleur.cyan('/devlog ' + newProject.key)} in Claude Code to publish an entry for this project.`);
  log.info('');
}

// ─── remove-project ──────────────────────────────────────────────────────────
async function cmdRemoveProject(rest) {
  const { values, positionals } = parseArgs({
    args: rest,
    options: { yes: { type: 'boolean', default: false } },
    allowPositionals: true,
  });
  const key = positionals[0];
  const config = readValidConfigOrExit({ json: values.yes });
  if (!key) emitJSON({ error: 'missing-arg', message: 'Usage: devlog remove-project <key> --yes' }, 1);

  if (!values.yes) {
    const { ok } = await prompts({
      type: 'confirm',
      name: 'ok',
      message: `Remove project "${key}" from config? (published entries are NOT deleted)`,
      initial: false,
    }, { onCancel: () => process.exit(1) });
    if (!ok) process.exit(0);
  }

  try {
    const next = removeProject(config, key);
    atomicWriteJSON(CONFIG_PATH, next);
    emitJSON({ ok: true, removed: key, projects: next.projects.map((p) => p.key) });
  } catch (e) {
    emitJSON({ error: 'remove-failed', message: e.message }, 1);
  }
}

// ─── set ─────────────────────────────────────────────────────────────────────
function cmdSet(rest) {
  const { positionals } = parseArgs({ args: rest, options: {}, allowPositionals: true });
  const [field, value] = positionals;
  const config = readValidConfigOrExit({ json: true });
  if (!field || value === undefined) {
    emitJSON({ error: 'missing-arg', message: `Usage: devlog set <field> <value>. Settable: ${SETTABLE_FIELDS.join(', ')}` }, 1);
  }
  try {
    const next = setField(config, field, value);
    atomicWriteJSON(CONFIG_PATH, next);
    emitJSON({ ok: true, field, config: next });
  } catch (e) {
    emitJSON({ error: 'set-failed', message: e.message }, 1);
  }
}

// ─── scan ────────────────────────────────────────────────────────────────────
function cmdScan(rest) {
  const { values } = parseArgs({
    args: rest,
    options: {
      project: { type: 'string' },
      'no-fetch': { type: 'boolean', default: false },
      // scan always emits JSON; the flag is accepted so `scan --json` (as
      // SKILL.md spells it) is never a crash.
      json: { type: 'boolean', default: true },
    },
    allowPositionals: false,
  });
  const config = readValidConfigOrExit({ json: true });
  const result = scanAll(config, { projectKey: values.project || null, fetch: !values['no-fetch'] });
  emitJSON(result, result.error ? 1 : 0);
}

// ─── lint-post ───────────────────────────────────────────────────────────────
function cmdLintPost(rest) {
  const { values, positionals } = parseArgs({
    args: rest,
    options: { 'min-sources': { type: 'string' } },
    allowPositionals: true,
  });
  const file = positionals[0];
  if (!file) emitJSON({ error: 'missing-arg', message: 'Usage: devlog lint-post <file> [--min-sources N]' }, 2);

  let minSources;
  if (values['min-sources'] !== undefined) {
    minSources = Number(values['min-sources']);
    if (!Number.isInteger(minSources) || minSources < 1) {
      emitJSON({ error: 'bad-flag', message: '--min-sources must be a positive integer' }, 2);
    }
  } else {
    // Default from config when available; falls back to the shipped default.
    let config = null;
    try { config = readConfig(); } catch { /* unreadable config → defaults */ }
    minSources = resolveDeepDive(config || {}).minSources;
  }

  let content;
  try {
    content = readFileSync(expandHome(file), 'utf8');
  } catch (e) {
    emitJSON({ error: 'unreadable', message: e.message }, 2);
  }
  const result = lintPost(content, { minSources, filename: file });
  emitJSON({ ...result, minSources }, result.ok ? 0 : 1);
}

// ─── publish-entry ───────────────────────────────────────────────────────────
function cmdPublishEntry(rest) {
  const { values } = parseArgs({
    args: rest,
    options: {
      clone: { type: 'string' },
      project: { type: 'string' },
      version: { type: 'string' },
      entry: { type: 'string' },
    },
    allowPositionals: false,
  });
  for (const flag of ['clone', 'project', 'version', 'entry']) {
    if (!values[flag]) emitJSON({ error: 'missing-flag', message: `publish-entry requires --${flag}` }, 1);
  }
  try {
    const result = publishEntry({
      cloneDir: expandHome(values.clone),
      project: values.project,
      version: values.version,
      entryPath: expandHome(values.entry),
    });
    emitJSON({ ok: true, ...result });
  } catch (e) {
    emitJSON({ error: 'publish-failed', message: e.message }, 1);
  }
}

// ─── config (view) ───────────────────────────────────────────────────────────
async function cmdConfig(rest) {
  const { values } = parseArgs({
    args: rest,
    options: { json: { type: 'boolean', default: false } },
    allowPositionals: false,
  });

  if (!existsSync(CONFIG_PATH)) {
    if (values.json) emitJSON({ error: 'config-missing', path: CONFIG_PATH }, 1);
    log.err(`No config found at ${CONFIG_PATH}`);
    log.hint('Run `npx @natjswenson/devlog init` first.');
    process.exit(1);
  }

  let config;
  try {
    config = readConfig();
  } catch (e) {
    if (values.json) emitJSON({ error: 'config-unreadable', message: e.message, path: CONFIG_PATH }, 1);
    log.err(`Failed to read config: ${e.message}`);
    process.exit(1);
  }

  let validationError = null;
  try {
    validateConfig(config);
  } catch (e) {
    validationError = e.message;
  }

  if (values.json) {
    emitJSON({
      path: CONFIG_PATH,
      valid: !validationError,
      ...(validationError ? { validationError } : {}),
      deepDive: resolveDeepDive(config),
      config,
    }, validationError ? 1 : 0);
  }

  log.info('');
  log.info(kleur.bold(`Config: ${CONFIG_PATH}`));
  log.info(`Status:        ${validationError ? kleur.red('INVALID — ' + validationError) : kleur.green('valid')}`);
  log.info(`Target repo:   ${kleur.cyan(`github.com/${config.targetRepo || '?'}`)}`);
  log.info(`Branch:        ${config.branch || 'main'}`);
  log.info(`Git author:    ${config.gitAuthor || '?'}`);
  log.info(`GitHub user:   ${config.githubUser || '?'}`);
  log.info(`Voice path:    ${config.voicePath || kleur.dim('(ghostwriter if present, else bundled default)')}`);
  const dd = resolveDeepDive(config);
  log.info(`Deep dive:     ${dd.minSources}+ sources; domains: ${dd.topicDomains.join(', ')}`);
  log.info(`Projects (${(config.projects || []).length}):`);
  for (const p of config.projects || []) {
    log.info(`  ${kleur.cyan(p.key)}${p.label ? `  (${p.label})` : ''}`);
    log.info(kleur.dim(`    path:   ${p.path}`));
    if (p.private) {
      log.info(kleur.dim(`    remote: (private — no commit links)${p.remote ? ` [${p.remote}]` : ''}`));
    } else {
      log.info(kleur.dim(`    remote: github.com/${p.remote}`));
    }
    if (p.pathFilter) log.info(kleur.dim(`    scope:  ${p.pathFilter}/`));
    log.info(kleur.dim(`    tags:   ${p.tagPrefix || 'v'}*`));
  }
  log.info('');
}

// ─── preview ─────────────────────────────────────────────────────────────────
async function cmdPreview() {
  const config = readValidConfigOrExit();

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

Setup & config:
  ${kleur.cyan('npx @natjswenson/devlog init')}                     One-time setup: create your dev-log repo, install the skill, write config
  ${kleur.cyan('npx @natjswenson/devlog add-project')}              Register a project (interactive; add --yes --path <p> for non-interactive)
  ${kleur.cyan('npx @natjswenson/devlog remove-project <key> --yes')}  Unregister a project (entries stay published)
  ${kleur.cyan('npx @natjswenson/devlog set <field> <value>')}      Update one config field (${SETTABLE_FIELDS.join(', ')})
  ${kleur.cyan('npx @natjswenson/devlog config [--json]')}          Show current config (with validation)

Used by the /devlog skill:
  ${kleur.cyan('npx @natjswenson/devlog scan [--project <key>]')}   JSON plan of new releases needing entries
  ${kleur.cyan('npx @natjswenson/devlog lint-post <file>')}         Deterministic post-contract check
  ${kleur.cyan('npx @natjswenson/devlog publish-entry ...')}        Copy a drafted entry into the clone + update manifest (never overwrites)

Preview:
  ${kleur.cyan('npx @natjswenson/devlog preview')}                  Run a local preview of your published dev log

  ${kleur.cyan('npx @natjswenson/devlog --help')} | ${kleur.cyan('--version')}

Docs:    https://github.com/natejswenson/devlog
Issues:  https://github.com/natejswenson/devlog/issues
`);
}

// ─── dispatch ────────────────────────────────────────────────────────────────
// Only run the CLI dispatch when this file is executed directly, not when it is
// imported (e.g. by the test suite). Importing the module must have no side effects.
// Both sides are realpath'd: under npm/npx, argv[1] is the node_modules/.bin/devlog
// SYMLINK while import.meta.url is the resolved file — a naive === never matches
// and every npx invocation becomes a silent no-op.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) {
  const arg = process.argv[2];
  const rest = process.argv.slice(3);
  switch (arg) {
    case 'init':
      cmdInit();
      break;
    case 'add-project':
      cmdAddProject(rest);
      break;
    case 'remove-project':
      cmdRemoveProject(rest);
      break;
    case 'set':
      cmdSet(rest);
      break;
    case 'scan':
      cmdScan(rest);
      break;
    case 'lint-post':
      cmdLintPost(rest);
      break;
    case 'publish-entry':
      cmdPublishEntry(rest);
      break;
    case 'config':
      cmdConfig(rest);
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
