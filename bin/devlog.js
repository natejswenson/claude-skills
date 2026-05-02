#!/usr/bin/env node
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import prompts from 'prompts';
import kleur from 'kleur';

const require = createRequire(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_SRC = join(PACKAGE_ROOT, 'SKILL.md');
const CONFIG_DIR = join(homedir(), '.claude', 'skills', 'devlog');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const SKILL_DEST = join(CONFIG_DIR, 'SKILL.md');
const PREVIEW_DIR = join(PACKAGE_ROOT, 'preview');

const log = {
  info: (msg) => console.log(msg),
  ok: (msg) => console.log(kleur.green('✓ ') + msg),
  warn: (msg) => console.log(kleur.yellow('! ') + msg),
  err: (msg) => console.error(kleur.red('✗ ') + msg),
  step: (msg) => console.log(kleur.cyan('→ ') + msg),
};

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}

function tryExec(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

async function preflight() {
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 18) {
    log.err(`Node 18+ required (you have ${process.versions.node}).`);
    process.exit(1);
  }

  const ghVersion = tryExec('gh --version');
  if (!ghVersion) {
    log.err('GitHub CLI (`gh`) is not installed.');
    log.info('Install: https://cli.github.com/');
    process.exit(1);
  }

  const ghAuth = tryExec('gh auth status');
  if (!ghAuth) {
    log.err('GitHub CLI is not authenticated.');
    log.info('Run: gh auth login');
    process.exit(1);
  }
}

function detectGhUser() {
  const out = tryExec('gh api user --jq .login');
  return out || null;
}

function detectGitName() {
  return tryExec('git config --global user.name');
}

function detectProjectRemote(path) {
  const url = tryExec(`git -C "${path}" remote get-url origin`);
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
  });
  return ok === true;
}

async function cmdInit() {
  log.info(kleur.bold('\ndevlog setup\n'));
  await preflight();

  const defaults = {
    gitAuthor: detectGitName() || '',
    githubUser: detectGhUser() || '',
    targetRepoName: 'daily-dev-log',
  };

  const answers = await prompts([
    {
      type: 'text',
      name: 'gitAuthor',
      message: 'Your name (used to filter `git log --author`):',
      initial: defaults.gitAuthor,
      validate: (v) => v.trim().length > 0 || 'Required',
    },
    {
      type: 'text',
      name: 'githubUser',
      message: 'Your GitHub username:',
      initial: defaults.githubUser,
      validate: (v) => /^[a-z0-9-]+$/i.test(v.trim()) || 'Invalid username',
    },
    {
      type: 'text',
      name: 'targetRepoName',
      message: 'Name of the repo where dev logs will be published:',
      initial: defaults.targetRepoName,
      validate: (v) => /^[a-z0-9._-]+$/i.test(v.trim()) || 'Invalid repo name',
    },
    {
      type: 'confirm',
      name: 'registerProject',
      message: 'Register a project now? (you can add more later by editing config.json)',
      initial: true,
    },
  ], { onCancel: () => process.exit(1) });

  let projectAnswers = null;
  if (answers.registerProject) {
    const cwd = process.cwd();
    const cwdRemote = detectProjectRemote(cwd);
    projectAnswers = await prompts([
      {
        type: 'text',
        name: 'path',
        message: 'Project absolute path:',
        initial: cwd,
        validate: (v) => existsSync(expandHome(v)) || 'Path does not exist',
      },
      {
        type: 'text',
        name: 'key',
        message: 'Project key (used as dev-log subdir name):',
        initial: (prev) => basename(expandHome(prev || cwd)),
        validate: (v) => /^[a-z0-9._-]+$/i.test(v.trim()) || 'Invalid key',
      },
      {
        type: 'text',
        name: 'remote',
        message: 'Project GitHub remote (<owner>/<repo>):',
        initial: (_prev, values) => detectProjectRemote(expandHome(values.path)) || cwdRemote || `${answers.githubUser}/${basename(expandHome(values.path))}`,
        validate: (v) => /^[\w.-]+\/[\w.-]+$/.test(v.trim()) || 'Expected <owner>/<repo>',
      },
    ], { onCancel: () => process.exit(1) });
  }

  const targetRepo = `${answers.githubUser}/${answers.targetRepoName}`;
  const config = {
    targetRepo,
    gitAuthor: answers.gitAuthor,
    githubUser: answers.githubUser,
    projects: projectAnswers ? [{
      key: projectAnswers.key,
      path: expandHome(projectAnswers.path),
      remote: projectAnswers.remote,
    }] : [],
  };

  log.info('\n' + kleur.bold('Summary:'));
  log.info(`  Target repo:    ${kleur.cyan(`github.com/${targetRepo}`)}`);
  log.info(`  Git author:     ${config.gitAuthor}`);
  log.info(`  GitHub user:    ${config.githubUser}`);
  log.info(`  Projects:       ${config.projects.length === 0 ? '(none — add later)' : config.projects.map(p => p.key).join(', ')}`);
  log.info(`  Skill location: ${CONFIG_DIR}`);

  const { proceed } = await prompts({
    type: 'confirm',
    name: 'proceed',
    message: 'Continue?',
    initial: true,
  }, { onCancel: () => process.exit(1) });
  if (!proceed) process.exit(0);

  log.info('');

  const repoExists = tryExec(`gh repo view ${targetRepo} --json name`) !== null;
  if (repoExists) {
    log.warn(`Repo github.com/${targetRepo} already exists. Will use it as-is.`);
  } else {
    log.step(`Creating github.com/${targetRepo}...`);
    try {
      execSync(`gh repo create ${targetRepo} --public --description "Daily dev log" --add-readme`, {
        stdio: 'inherit',
      });
      log.ok('Repo created');
    } catch {
      log.err('Failed to create repo. Check `gh` permissions.');
      process.exit(1);
    }
  }

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    log.ok(`Created ${CONFIG_DIR}`);
  }

  if (await confirmOverwrite('SKILL.md', SKILL_DEST)) {
    copyFileSync(SKILL_SRC, SKILL_DEST);
    log.ok(`Installed SKILL.md → ${SKILL_DEST}`);
  } else {
    log.warn('Skipped SKILL.md');
  }

  if (await confirmOverwrite('config.json', CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
    log.ok(`Wrote config → ${CONFIG_PATH}`);
  } else {
    log.warn('Skipped config.json');
  }

  log.info('\n' + kleur.bold().green('Done.') + '\n');
  log.info('Next steps:');
  log.info(`  1. ${config.projects.length === 0 ? 'Edit config.json to register projects' : '(Optional) edit config.json to register more projects'}`);
  log.info('  2. Make some commits in a registered project');
  log.info('  3. In Claude Code, run: /devlog');
  log.info('  4. Preview locally: npx @natjswenson/devlog preview');
  log.info('');
}

async function cmdPreview() {
  if (!existsSync(CONFIG_PATH)) {
    log.err(`No config found at ${CONFIG_PATH}`);
    log.info('Run `npx @natjswenson/devlog init` first.');
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    log.err(`Failed to parse config: ${e.message}`);
    process.exit(1);
  }

  const [owner, repo] = (config.targetRepo || '').split('/');
  if (!owner || !repo) {
    log.err('config.targetRepo is not in <owner>/<repo> format');
    process.exit(1);
  }

  const projects = (config.projects || []).map((p) => ({ key: p.key, label: p.key }));

  log.step(`Launching preview against github.com/${config.targetRepo}...`);

  const vitePkgPath = require.resolve('vite/package.json');
  const vitePkg = JSON.parse(readFileSync(vitePkgPath, 'utf8'));
  const viteBin = resolve(dirname(vitePkgPath), vitePkg.bin?.vite || 'bin/vite.js');

  const proc = spawn(process.execPath, [viteBin], {
    cwd: PREVIEW_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DEVLOG_OWNER: owner,
      VITE_DEVLOG_REPO: repo,
      VITE_DEVLOG_BRANCH: 'main',
      VITE_DEVLOG_PROJECTS: JSON.stringify(projects),
    },
  });
  proc.on('exit', (code) => process.exit(code ?? 0));
}

function printHelp() {
  console.log(`
${kleur.bold('@natjswenson/devlog')} — daily dev log generator

Usage:
  npx @natjswenson/devlog init       Set up the skill, create your dev-log repo, write config
  npx @natjswenson/devlog preview    Run a local preview of your published dev log
  npx @natjswenson/devlog --help
  npx @natjswenson/devlog --version

Docs: https://github.com/natejswenson/devlog
`);
}

const arg = process.argv[2];
switch (arg) {
  case 'init':
    cmdInit();
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
