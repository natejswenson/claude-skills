#!/usr/bin/env node
import { spawn, spawnSync, execSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, realpathSync,
  readdirSync, statSync, rmSync, mkdtempSync,
} from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import prompts from 'prompts';
import kleur from 'kleur';
import { chromium } from 'playwright';

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
import { scanAll, summarizeScan } from '../lib/scan.mjs';
import { lintPost, parseFrontmatter, splitSections } from '../lib/lint_post.mjs';
import { publishEntry, addCoverToExistingEntry, tombstoneEntry, syncEntryFromFrontmatter } from '../lib/publish_entry.mjs';
import { writeAssembledBlocks } from '../lib/assemble_post.mjs';
import { addProject, removeProject, setField, SETTABLE_FIELDS } from '../lib/config_ops.mjs';
import { loadStyleGuide, getRecentCovers, mergeManifestEntries } from '../lib/cover_gen.mjs';
import { renderCoverImage } from '../lib/render_cover.mjs';

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
const IMAGE_STYLE_SRC_DIR = join(PACKAGE_ROOT, 'image-style');
const IMAGE_STYLE_DEST_DIR = join(CONFIG_DIR, 'image-style');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function isValidPngFile(path) {
  try {
    const buf = readFileSync(path);
    return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC);
  } catch {
    return false;
  }
}

function slugFromFile(file) {
  return String(file || '').replace(/\.md$/, '');
}

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

// parseArgs is strict by default, so an unknown flag (`render-cover --force`)
// used to die with a raw ERR_PARSE_ARGS_UNKNOWN_OPTION stack trace instead of
// the JSON error shape every agent-facing command promises. Same contract as
// commit-covers' hand-rolled parser: unknown/malformed flags → bad-flag JSON.
function safeParseArgs(spec) {
  try {
    return parseArgs(spec);
  } catch (e) {
    emitJSON({ error: 'bad-flag', message: e.message }, 2);
  }
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

  // Install the bundled cover style guide + font — same install pattern as the voice
  // profile above. Both are needed before any cover image can be composed/rendered.
  if (!existsSync(IMAGE_STYLE_DEST_DIR)) {
    mkdirSync(IMAGE_STYLE_DEST_DIR, { recursive: true, mode: 0o700 });
  }
  const styleGuideSrc = join(IMAGE_STYLE_SRC_DIR, 'style-guide.example.md');
  const styleGuideDest = join(IMAGE_STYLE_DEST_DIR, 'style-guide.md');
  if (existsSync(styleGuideSrc) && (await confirmOverwrite('image-style/style-guide.md', styleGuideDest))) {
    copyFileSync(styleGuideSrc, styleGuideDest);
    log.ok(`Installed image-style/style-guide.md → ${styleGuideDest}`);
  }
  const fontSrc = join(IMAGE_STYLE_SRC_DIR, 'font.ttf');
  const fontDest = join(IMAGE_STYLE_DEST_DIR, 'font.ttf');
  if (existsSync(fontSrc) && (await confirmOverwrite('image-style/font.ttf', fontDest))) {
    copyFileSync(fontSrc, fontDest);
    log.ok(`Installed image-style/font.ttf → ${fontDest}`);
  }
  const iconsSrc = join(IMAGE_STYLE_SRC_DIR, 'icons.md');
  const iconsDest = join(IMAGE_STYLE_DEST_DIR, 'icons.md');
  if (existsSync(iconsSrc) && (await confirmOverwrite('image-style/icons.md', iconsDest))) {
    copyFileSync(iconsSrc, iconsDest);
    log.ok(`Installed image-style/icons.md → ${iconsDest}`);
  }

  // Cover-generation reachability checks. Informational only — neither failure blocks
  // setup, since a missing Chromium/font only affects cover generation, not the rest of
  // /devlog.
  try {
    const browser = await chromium.launch();
    await browser.close();
  } catch {
    log.warn('Chromium is not installed — cover images will fail to render.');
    log.hint('npx playwright install chromium');
  }
  if (!existsSync(fontDest) || statSync(fontDest).size === 0) {
    log.warn('Cover font is missing or unreadable (0 bytes) — cover images will fail to render.');
    log.hint('Re-run `devlog init` to reinstall it.');
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
  const { values } = safeParseArgs({
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
  const { values, positionals } = safeParseArgs({
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
  const { positionals } = safeParseArgs({ args: rest, options: {}, allowPositionals: true });
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
  const { values } = safeParseArgs({
    args: rest,
    options: {
      project: { type: 'string' },
      'no-fetch': { type: 'boolean', default: false },
      // Plan-table view: per release, commitCount instead of the commit list
      // and diffstat; skippedTags collapsed to per-reason counts.
      summary: { type: 'boolean', default: false },
      // scan always emits JSON; the flag is accepted so `scan --json` (as
      // SKILL.md spells it) is never a crash.
      json: { type: 'boolean', default: true },
    },
    allowPositionals: false,
  });
  const config = readValidConfigOrExit({ json: true });
  let result = scanAll(config, { projectKey: values.project || null, fetch: !values['no-fetch'] });
  if (values.summary) result = summarizeScan(result);
  // Which CLI actually ran: npx caches aggressively, and a stale install has
  // silently missed shipped fixes before — the skill compares this against the
  // version its own instructions shipped with.
  if (!result.error) result.cliVersion = readPackageVersion();
  emitJSON(result, result.error ? 1 : 0);
}

// ─── lint-post ───────────────────────────────────────────────────────────────
function cmdLintPost(rest) {
  const { values, positionals } = safeParseArgs({
    args: rest,
    options: {
      'min-sources': { type: 'string' },
      // Deterministic voice-contract rules (em dashes, banned phrases) —
      // opt-in so non-voice callers and the eval harness keep their behavior.
      voice: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  const file = positionals[0];
  if (!file) emitJSON({ error: 'missing-arg', message: 'Usage: devlog lint-post <file> [--min-sources N] [--voice]' }, 2);

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
  const result = lintPost(content, { minSources, filename: file, voice: values.voice });
  emitJSON({ ...result, minSources }, result.ok ? 0 : 1);
}

// ─── publish-entry ───────────────────────────────────────────────────────────
function cmdPublishEntry(rest) {
  const { values } = safeParseArgs({
    args: rest,
    options: {
      clone: { type: 'string' },
      project: { type: 'string' },
      version: { type: 'string' },
      entry: { type: 'string' },
      cover: { type: 'string' },
    },
    allowPositionals: false,
  });
  for (const flag of ['clone', 'project', 'version', 'entry']) {
    if (!values[flag]) emitJSON({ error: 'missing-flag', message: `publish-entry requires --${flag}` }, 1);
  }

  let coverImageBuffer;
  if (values.cover) {
    try {
      coverImageBuffer = readFileSync(expandHome(values.cover));
    } catch (e) {
      emitJSON({ error: 'cover-unreadable', message: e.message }, 1);
    }
  }

  try {
    const result = publishEntry({
      cloneDir: expandHome(values.clone),
      project: values.project,
      version: values.version,
      entryPath: expandHome(values.entry),
      ...(coverImageBuffer ? { coverImageBuffer } : {}),
    });
    emitJSON({ ok: true, ...result });
  } catch (e) {
    emitJSON({ error: 'publish-failed', message: e.message }, 1);
  }
}

// ─── tombstone ───────────────────────────────────────────────────────────────
// Editorially retire a (project, version) identity after its entry was moved,
// consolidated, or deleted by hand — scan then reports `entry-tombstoned` and
// publish-entry refuses it forever.
function cmdTombstone(rest) {
  const { values } = safeParseArgs({
    args: rest,
    options: {
      clone: { type: 'string' },
      project: { type: 'string' },
      version: { type: 'string' },
      reason: { type: 'string' },
    },
    allowPositionals: false,
  });
  for (const flag of ['clone', 'project', 'version', 'reason']) {
    if (!values[flag]) emitJSON({ error: 'missing-flag', message: `tombstone requires --${flag}` }, 1);
  }
  try {
    const result = tombstoneEntry({
      cloneDir: expandHome(values.clone),
      project: values.project,
      version: values.version,
      reason: values.reason,
    });
    emitJSON({ ok: true, ...result });
  } catch (e) {
    emitJSON({ error: 'tombstone-failed', message: e.message }, 1);
  }
}

// ─── sync-entry ──────────────────────────────────────────────────────────────
// Resync a published entry's manifest row (title/summary/date/tags) from its
// .md frontmatter after a deliberate post-publish edit.
function cmdSyncEntry(rest) {
  const { values } = safeParseArgs({
    args: rest,
    options: {
      clone: { type: 'string' },
      project: { type: 'string' },
      slug: { type: 'string' },
    },
    allowPositionals: false,
  });
  for (const flag of ['clone', 'project', 'slug']) {
    if (!values[flag]) emitJSON({ error: 'missing-flag', message: `sync-entry requires --${flag}` }, 1);
  }
  try {
    const result = syncEntryFromFrontmatter({
      cloneDir: expandHome(values.clone),
      project: values.project,
      slug: values.slug,
    });
    emitJSON({ ok: true, ...result });
  } catch (e) {
    emitJSON({ error: 'sync-failed', message: e.message }, 1);
  }
}

// ─── assemble-post ───────────────────────────────────────────────────────────
// Extract a draft's fenced code blocks, in order, into numbered files so the
// Step 4 assemble-and-run check is mechanical instead of hand-copied.
function cmdAssemblePost(rest) {
  const { values, positionals } = safeParseArgs({
    args: rest,
    options: { out: { type: 'string' } },
    allowPositionals: true,
  });
  const file = positionals[0];
  if (!file) emitJSON({ error: 'missing-arg', message: 'Usage: devlog assemble-post <draft> --out <dir>' }, 2);
  if (!values.out) emitJSON({ error: 'missing-flag', message: 'assemble-post requires --out' }, 1);

  let content;
  try {
    content = readFileSync(expandHome(file), 'utf8');
  } catch (e) {
    emitJSON({ error: 'unreadable', message: e.message }, 2);
  }
  try {
    const result = writeAssembledBlocks(content, expandHome(values.out));
    emitJSON({ ok: true, ...result });
  } catch (e) {
    emitJSON({ error: 'assemble-failed', message: e.message }, 1);
  }
}

// ─── backfill-covers list ─────────────────────────────────────────────────────
function cmdBackfillCovers(rest) {
  const sub = rest[0];
  if (sub !== 'list') {
    emitJSON({ error: 'unknown-subcommand', message: 'Usage: devlog backfill-covers list --clone <cloneDir> [--project <key>] [--out <staging-dir>] [--all]' }, 2);
    return;
  }
  const { values } = safeParseArgs({
    args: rest.slice(1),
    options: {
      clone: { type: 'string' },
      project: { type: 'string' },
      out: { type: 'string' },
      all: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  if (!values.clone) emitJSON({ error: 'missing-flag', message: 'backfill-covers list requires --clone' }, 1);
  const config = readValidConfigOrExit({ json: true });
  const cloneDir = expandHome(values.clone);

  let merged;
  try {
    merged = mergeManifestEntries(cloneDir, config);
  } catch (e) {
    emitJSON({ error: 'manifest-error', message: e.message }, 1);
    return;
  }

  // Default (no --all): missing-cover-only, this command's original purpose. With --all,
  // every manifest entry qualifies regardless of cover status — what a cover-quality
  // backfill needs, since every real entry already has cover: true from a prior batch.
  let candidates = merged
    .filter((e) => e && (values.all || !e.cover))
    .map((e) => ({ ...e, _slug: slugFromFile(e.file) }));

  if (values.project) {
    candidates = candidates.filter((e) => e.project === values.project);
  }

  // Resume support: skip candidates already validly staged this session.
  if (values.out) {
    const stagingDir = expandHome(values.out);
    candidates = candidates.filter((e) => {
      const p = join(stagingDir, e.project, `${e._slug}.png`);
      return !(existsSync(p) && isValidPngFile(p));
    });
  }

  // (date, project, slug) is the complete candidate-processing sort key — oldest first,
  // ties broken by project then slug alphabetically, since manifest `date` is
  // day-granularity and a same-day, cross-project collision is a real case at this scale.
  candidates.sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
    || a.project.localeCompare(b.project)
    || a._slug.localeCompare(b._slug)
  );

  const out = candidates.map((e) => {
    // Deterministically extract only the `## Shipped` section — never any other section
    // (e.g. `## Changelog`) — so the agent never needs to open the candidate's raw .md.
    let shipped = '';
    try {
      const raw = readFileSync(join(cloneDir, e.project, e.file), 'utf8');
      const { body } = parseFrontmatter(raw);
      const section = splitSections(body).find((s) => s.heading === 'Shipped');
      shipped = section ? section.content.trim() : '';
    } catch { /* best-effort; leave shipped empty if the .md can't be read */ }
    return {
      project: e.project,
      slug: e._slug,
      title: e.title || e._slug,
      date: e.date,
      tags: Array.isArray(e.tags) ? e.tags : [],
      summary: e.summary || '',
      shipped,
    };
  });

  emitJSON(out);
}

// ─── cover-context ─────────────────────────────────────────────────────────────
function cmdCoverContext(rest) {
  const { positionals, values } = safeParseArgs({
    args: rest,
    options: {
      clone: { type: 'string' },
      staging: { type: 'string' },
    },
    allowPositionals: true,
  });
  const [project, slug] = positionals;
  if (!project || !slug) {
    emitJSON({ error: 'missing-arg', message: 'Usage: devlog cover-context <project> <slug> --clone <cloneDir> [--staging <staging-dir>]' }, 2);
  }
  if (!values.clone) emitJSON({ error: 'missing-flag', message: 'cover-context requires --clone' }, 1);

  const config = readValidConfigOrExit({ json: true });

  // `let`, declared outside both try blocks below — NOT `const` inside the first one.
  // Both blocks' emitJSON calls need text/iconCatalog, and a `const` destructure scoped to
  // the first try alone would leave them unreachable (a ReferenceError) inside the second.
  let text, iconCatalog;
  try {
    ({ text, iconCatalog } = loadStyleGuide());
  } catch (e) {
    emitJSON({ error: 'style-guide-missing', message: e.message }, 1);
    return;
  }

  try {
    const references = getRecentCovers({
      cloneDir: expandHome(values.clone),
      config,
      stagingDir: values.staging ? expandHome(values.staging) : null,
      n: 3,
    });
    emitJSON({ styleGuide: text, references, iconCatalog });
  } catch (e) {
    // A configured project's manifest.json missing/unparseable: distinct, named error
    // field — never collapsed into an empty references: [] array — but still does not
    // block the rest of publish for the caller.
    emitJSON({ styleGuide: text, references: [], error: 'reference-lookup-failed', message: e.message, iconCatalog });
  }
}

// ─── render-cover ──────────────────────────────────────────────────────────────
function regenerateContactSheet(outDir) {
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const projects = readdirSync(outDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();

  let body = '';
  for (const project of projects) {
    const files = readdirSync(join(outDir, project)).filter((f) => f.endsWith('.png')).sort();
    if (files.length === 0) continue;
    body += `<h2>${escapeHtml(project)}</h2><div style="display:flex;flex-wrap:wrap;gap:12px;">`;
    for (const f of files) {
      const slug = f.replace(/\.png$/, '');
      body += `<figure style="margin:0;width:320px;"><img src="${escapeHtml(`${project}/${f}`)}" style="width:100%;height:auto;border:1px solid #444;" loading="lazy"><figcaption>${escapeHtml(slug)}</figcaption></figure>`;
    }
    body += '</div>';
  }
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>devlog cover contact sheet</title></head>` +
    `<body style="font-family:sans-serif;background:#111;color:#eee;padding:24px;">${body || '<p>No covers staged yet.</p>'}</body></html>`;
  writeFileSync(join(outDir, 'index.html'), html);
}

async function cmdRenderCover(rest) {
  const { positionals, values } = safeParseArgs({
    args: rest,
    options: {
      project: { type: 'string' },
      slug: { type: 'string' },
      out: { type: 'string' },
    },
    allowPositionals: true,
  });
  const htmlFile = positionals[0];
  if (!htmlFile) emitJSON({ error: 'missing-arg', message: 'Usage: devlog render-cover <html-file> --project <key> --slug <slug> --out <dir>' }, 2);
  for (const flag of ['project', 'slug', 'out']) {
    if (!values[flag]) emitJSON({ error: 'missing-flag', message: `render-cover requires --${flag}` }, 1);
  }
  if (!RE_PROJECT_KEY.test(values.project) || values.project.includes('..')) {
    emitJSON({ error: 'bad-flag', message: `Invalid --project: ${values.project}` }, 1);
  }
  if (values.slug.includes('/') || values.slug.includes('..') || values.slug === '') {
    emitJSON({ error: 'bad-flag', message: `Invalid --slug: ${values.slug}` }, 1);
  }

  const outDir = expandHome(values.out);
  const projectDir = join(outDir, values.project);
  mkdirSync(projectDir, { recursive: true });
  const pngPath = join(projectDir, `${values.slug}.png`);

  // The HTML file is the source of truth: whenever it's present, render it —
  // overwriting any stale PNG from a previous attempt. (The old
  // PNG-exists short-circuit silently ignored freshly edited HTML, which cost
  // every real retry loop an ls/mtime/md5 debugging dance and a guessed-at
  // `--force` flag that didn't exist.) Only when the HTML is gone does an
  // existing valid PNG mean "already rendered, nothing to do".
  let html;
  try {
    html = readFileSync(expandHome(htmlFile), 'utf8');
  } catch (e) {
    if (existsSync(pngPath) && isValidPngFile(pngPath)) {
      regenerateContactSheet(outDir);
      emitJSON({ ok: true, written: pngPath, rendered: false });
      return;
    }
    emitJSON({ error: 'html-unreadable', message: e.message }, 1);
    return;
  }

  let png;
  try {
    png = await renderCoverImage(html, { width: 1600, height: 900 });
  } catch (e) {
    // Render failure (timeout / Chromium missing / font missing) — the HTML source is
    // left in place for debugging, never deleted on failure.
    emitJSON({ error: 'render-failed', message: e.message }, 1);
    return;
  }
  writeFileSync(pngPath, png);

  // The HTML source deliberately stays on disk (it lives in the run's scratch
  // dir and dies with it): keeping it is what makes "tweak the HTML, re-run
  // render-cover" work at all — deleting it on success broke every
  // post-render Edit attempt in real runs.
  regenerateContactSheet(outDir);
  emitJSON({ ok: true, written: pngPath, rendered: true });
}

// ─── commit-covers ──────────────────────────────────────────────────────────────
async function cmdCommitCovers(rest) {
  // --force takes an OPTIONAL value (bare --force = bulk; --force <slug-or-project/slug>
  // = scoped), which node:util's parseArgs cannot express directly — parsed by hand.
  let forcePresent = false;
  let forceArg = null;
  const positionals = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--force') {
      forcePresent = true;
      if (i + 1 < rest.length && !rest[i + 1].startsWith('--')) forceArg = rest[++i];
    } else if (a.startsWith('--')) {
      emitJSON({ error: 'bad-flag', message: `Unknown flag: ${a}` }, 2);
      return;
    } else {
      positionals.push(a);
    }
  }

  const stagingDirArg = positionals[0];
  if (!stagingDirArg) emitJSON({ error: 'missing-arg', message: 'Usage: devlog commit-covers <staging-dir> [--force [slug]]' }, 2);
  const stagingDir = expandHome(stagingDirArg);
  if (!existsSync(stagingDir)) emitJSON({ error: 'staging-dir-missing', message: `Staging dir not found: ${stagingDir}` }, 1);

  const config = readValidConfigOrExit({ json: true });

  const staged = [];
  for (const d of readdirSync(stagingDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of readdirSync(join(stagingDir, d.name))) {
      if (!f.endsWith('.png')) continue;
      staged.push({ project: d.name, slug: f.replace(/\.png$/, ''), path: join(stagingDir, d.name, f) });
    }
  }

  // commit-covers takes NO --clone flag of any kind — deliberately, not an oversight (see
  // design doc). It always establishes its own fresh clone at commit time, since it
  // routinely runs well after the backfill/review session that produced the staging dir,
  // and reusing an hours-or-days-old clone would risk mutating a manifest that's since
  // moved on.
  const cloneDir = mkdtempSync(join(tmpdir(), 'devlog-commit-covers-'));
  const branch = config.branch || 'main';
  const cloneUrl = `https://github.com/${config.targetRepo}.git`;
  const cloneResult = spawnSync('git', ['clone', '--depth=1', '--branch', branch, cloneUrl, cloneDir], { encoding: 'utf8' });
  if (cloneResult.status !== 0) {
    rmSync(cloneDir, { recursive: true, force: true });
    emitJSON({ error: 'clone-failed', message: cloneResult.stderr || 'git clone failed' }, 1);
    return;
  }

  const summary = { written: [], skipped: [], failed: [], missingManifest: [] };
  let bulkForceOverwriteCount = 0;

  for (const s of staged) {
    let merged;
    try {
      merged = mergeManifestEntries(cloneDir, config);
    } catch (e) {
      summary.failed.push({ project: s.project, slug: s.slug, message: e.message });
      continue;
    }
    const row = merged.find((e) => e.project === s.project && slugFromFile(e.file) === s.slug);

    // Missing/shifted manifest row at commit time: `list` and `commit-covers` read against
    // two separately-established clones taken hours or days apart. Distinct from "found a
    // row, and it already has cover" below — this is "no row at all for this slug under
    // this project." Logged and skipped, never aborting the rest of the run.
    if (!row) {
      summary.missingManifest.push(`${s.project}/${s.slug}`);
      continue;
    }

    // Scoped force: --force <project>/<slug>, or bare --force <slug> when that slug is
    // staged under only one project (ambiguous otherwise — require the qualified form).
    let forceThis = false;
    if (forcePresent) {
      if (forceArg === null) {
        forceThis = true; // bulk
        if (row.cover) bulkForceOverwriteCount++;
      } else if (forceArg === `${s.project}/${s.slug}`) {
        forceThis = true;
      } else if (forceArg === s.slug) {
        const ambiguous = staged.some((x) => x.slug === forceArg && x.project !== s.project);
        if (ambiguous) {
          summary.failed.push({ project: s.project, slug: s.slug, message: `--force ${forceArg} is ambiguous (staged under multiple projects) — use --force ${s.project}/${s.slug}` });
          continue;
        }
        forceThis = true;
      }
    }

    // Pre-filter: skip an already-covered entry without calling addCoverToExistingEntry()
    // at all, UNLESS this exact entry is in scope for --force.
    if (row.cover && !forceThis) {
      summary.skipped.push(`${s.project}/${s.slug}`);
      continue;
    }

    try {
      const coverImageBuffer = readFileSync(s.path);
      addCoverToExistingEntry({ cloneDir, project: s.project, slug: s.slug, coverImageBuffer, force: forceThis });
      summary.written.push(`${s.project}/${s.slug}`);
    } catch (e) {
      summary.failed.push({ project: s.project, slug: s.slug, message: e.message });
    }
  }

  if (summary.written.length > 0) {
    const steps = [
      ['add', '.'],
      ['commit', '-m', `chore(devlog): add ${summary.written.length} cover image(s)`],
    ];
    for (const args of steps) {
      const r = spawnSync('git', ['-C', cloneDir, ...args], { encoding: 'utf8' });
      if (r.status !== 0) {
        emitJSON({ ok: false, ...summary, bulkForceOverwriteCount, error: 'git-commit-failed', message: r.stderr }, 1);
        return;
      }
    }
    const push = spawnSync('git', ['-C', cloneDir, 'push', '--no-tags', 'origin', branch], { encoding: 'utf8' });
    if (push.status !== 0) {
      emitJSON({ ok: false, ...summary, bulkForceOverwriteCount, error: 'git-push-failed', message: push.stderr }, 1);
      return;
    }
  }

  rmSync(cloneDir, { recursive: true, force: true });
  emitJSON({ ok: summary.failed.length === 0, ...summary, bulkForceOverwriteCount });
}

// ─── config (view) ───────────────────────────────────────────────────────────
async function cmdConfig(rest) {
  const { values } = safeParseArgs({
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
  ${kleur.cyan('npx @natjswenson/devlog scan [--project <key>] [--summary]')}   JSON plan of new releases needing entries
  ${kleur.cyan('npx @natjswenson/devlog lint-post <file> [--voice]')}  Deterministic post-contract check (+ voice rules)
  ${kleur.cyan('npx @natjswenson/devlog assemble-post <draft> --out <dir>')}  Extract the draft's code blocks for the run-it check
  ${kleur.cyan('npx @natjswenson/devlog publish-entry ...')}        Copy a drafted entry into the clone + update manifest (never overwrites)
  ${kleur.cyan('npx @natjswenson/devlog cover-context <project> <slug> --clone <dir>')}  Style guide + reference-image paths for cover composition
  ${kleur.cyan('npx @natjswenson/devlog render-cover <html> --project <key> --slug <s> --out <dir>')}  Rasterize a composed cover to PNG

Editorial maintenance:
  ${kleur.cyan('npx @natjswenson/devlog tombstone --clone <dir> --project <key> --version <v> --reason <why>')}  Retire a moved/consolidated entry's identity
  ${kleur.cyan('npx @natjswenson/devlog sync-entry --clone <dir> --project <key> --slug <v>')}  Resync a manifest row from an edited entry's frontmatter

Backfilling covers onto existing posts:
  ${kleur.cyan('npx @natjswenson/devlog backfill-covers list --clone <dir> [--out <staging-dir>]')}  List posts missing a cover
  ${kleur.cyan('npx @natjswenson/devlog commit-covers <staging-dir> [--force [slug]]')}  Publish staged covers to already-published entries

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
    case 'tombstone':
      cmdTombstone(rest);
      break;
    case 'sync-entry':
      cmdSyncEntry(rest);
      break;
    case 'assemble-post':
      cmdAssemblePost(rest);
      break;
    case 'backfill-covers':
      cmdBackfillCovers(rest);
      break;
    case 'cover-context':
      cmdCoverContext(rest);
      break;
    case 'render-cover':
      cmdRenderCover(rest);
      break;
    case 'commit-covers':
      cmdCommitCovers(rest);
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
