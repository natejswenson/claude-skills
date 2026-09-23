#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_OUTPUT = 8 * 1024 * 1024;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const fail = message => { throw new Error(message); };

function command(program, args, cwd, optional = false) {
  const result = spawnSync(program, args, {
    cwd, encoding: 'utf8', maxBuffer: MAX_OUTPUT, timeout: 30_000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GH_PROMPT_DISABLED: '1' },
  });
  if (result.error) fail(`${program} unavailable or timed out: ${result.error.code ?? 'execution failed'}`);
  if (result.status !== 0) {
    if (optional && result.status !== null) return null;
    // Avoid echoing remote URLs or arbitrary tool output containing credentials.
    fail(`${program} ${args[0]} failed (exit ${result.status ?? 'signal'}). Check the repository, access and command locally.`);
  }
  return result.stdout;
}

export function parseStatus(raw) {
  const parts = raw.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    if (parts[i].length < 4 || parts[i][2] !== ' ') fail('Invalid Git status record');
    const status = parts[i].slice(0, 2);
    const item = { status, path: parts[i].slice(3) };
    if (/[RC]/.test(status)) {
      if (!parts[i + 1]) fail('Missing Git rename source');
      item.originalPath = parts[++i];
    }
    files.push(item);
  }
  return files;
}

export function inspect(repo, base) {
  const cwd = resolve(repo);
  const git = (args, optional) => command('git', args, cwd, optional);
  const root = git(['rev-parse', '--show-toplevel']).trim();
  const head = git(['rev-parse', '--verify', 'HEAD'], true)?.trim() ?? null;
  const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], true)?.trim() ?? null;
  const remoteHead = git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], true)?.trim();
  let baseHint = null;
  const candidates = base ? [base] : [remoteHead, 'main', 'origin/main', 'master', 'origin/master'].filter(Boolean);
  for (const ref of candidates) {
    if (git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], true)) { baseHint = ref; break; }
  }
  if (base && !baseHint) fail('Requested base does not resolve to a local commit; inspect local refs or fetch explicitly.');
  // Always run path-relative commands at the root, even when invoked in a subdirectory.
  const files = parseStatus(command('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], root));
  const plans = command('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'docs/plans'], root)
    .split('\0').filter(p => p.endsWith('.md'));
  return {
    schemaVersion: 1, root, branch, head, baseHint, baseFreshness: 'local refs only; remote not checked',
    dirty: files.length > 0, files,
    remotes: git(['remote']).trim().split('\n').filter(Boolean),
    instructionFiles: ['AGENTS.md', 'CLAUDE.md'].filter(p => existsSync(join(root, p))),
    planFiles: [...new Set(plans)].sort(),
  };
}

function parseJSON(text, label) {
  try { return JSON.parse(text); } catch { fail(`Invalid JSON in ${label}`); }
}

function validateRepo(value) {
  if (value !== undefined && !/^(?:[a-zA-Z0-9.-]+\/)?[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value)) {
    fail('--github-repo must be OWNER/REPO or HOST/OWNER/REPO');
  }
  if (value?.split('/').some(part => part.startsWith('-') || part === '.' || part === '..')) fail('Invalid GitHub repository');
}

function validateIssue(item, body = false) {
  if (!item || !Number.isSafeInteger(item.number) || item.number < 1 || !nonempty(item.title) ||
      !nonempty(item.url) || !/^https:\/\/[^/]+\/[^/]+\/[^/]+\/issues\/[1-9]\d*$/.test(item.url) ||
      (body && (typeof item.body !== 'string' || !['OPEN', 'CLOSED'].includes(item.state)))) fail('Incomplete GitHub issue response');
  return item;
}

export function readIssues(repo, { githubRepo, id, limit = '30' } = {}) {
  validateRepo(githubRepo);
  let number;
  if (id !== undefined) {
    const url = /^https:\/\/github\.com\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\/issues\/([1-9]\d*)\/?$/.exec(id);
    if (!url && !/^[1-9]\d*$/.test(id)) fail('--id must be a positive issue number or GitHub.com issue URL');
    number = Number(url ? url[2] : id);
    if (!Number.isSafeInteger(number)) fail('Invalid issue number');
    if (url) {
      if (githubRepo && githubRepo.toLowerCase() !== url[1].toLowerCase()) fail('Issue URL and --github-repo disagree');
      githubRepo = url[1];
    }
  } else if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100) fail('--limit must be between 1 and 100');
  const args = id === undefined
    ? ['issue', 'list', '--state', 'open', '--limit', String(Number(limit)), '--json', 'number,title,url']
    : ['issue', 'view', String(number), '--json', 'number,title,body,url,state'];
  if (githubRepo) args.push('--repo', githubRepo);
  const data = parseJSON(command('gh', args, resolve(repo)), 'GitHub response');
  if (id !== undefined) {
    validateIssue(data, true);
    if (data.number !== number) fail('GitHub returned a different issue number');
    return { source: 'github-issue', issue: data };
  }
  if (!Array.isArray(data) || data.length > Number(limit)) fail('Invalid GitHub issue list');
  data.forEach(item => validateIssue(item));
  return {
    choices: [{ kind: 'custom', label: 'Enter your own item to work on' },
      ...data.map(issue => ({ kind: 'issue', label: `#${issue.number} ${issue.title}`, ...issue }))],
    limit: Number(limit), possiblyMore: data.length === Number(limit),
  };
}

export function validateInspection(data) {
  const nullable = v => v === null || nonempty(v);
  if (!data || data.schemaVersion !== 1 || !nonempty(data.root) ||
      !nullable(data.branch) || !nullable(data.head) || !nullable(data.baseHint) ||
      (data.head !== null && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(data.head)) ||
      data.baseFreshness !== 'local refs only; remote not checked' ||
      typeof data.dirty !== 'boolean' || !Array.isArray(data.files) ||
      !['remotes', 'instructionFiles', 'planFiles'].every(key => Array.isArray(data[key]) && data[key].every(nonempty))) fail('Invalid local inspection');
  for (const file of data.files) {
    if (!file || !nonempty(file.path) || typeof file.status !== 'string' ||
        !/^[ MTADRCU?!]{2}$/.test(file.status) || (file.originalPath !== undefined && !nonempty(file.originalPath))) fail('Invalid inspection file');
  }
  if (data.dirty !== (data.files.length > 0)) fail('Inspection dirty flag disagrees with files');
  return data;
}

const cell = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\|/g, '&#124;').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');

export function renderReport(input) {
  const d = validateInspection(input);
  const rows = [
    ['Checkout', d.root], ['Branch', d.branch ?? '(detached)'], ['HEAD', d.head ?? '(no commits)'],
    ['Base hint', d.baseHint ?? '(not established)'], ['Base freshness', d.baseFreshness],
    ['Worktree', d.dirty ? `${d.files.length} changed/untracked paths` : 'clean'],
    ['Remotes', d.remotes.join(', ') || '(none)'], ['Instructions', d.instructionFiles.join(', ') || '(none at root)'],
    ['Plans', d.planFiles.join(', ') || '(none in docs/plans)'],
  ];
  const lines = ['# Local development inspection', '', '| Item | Value |', '|---|---|',
    ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`)];
  if (d.files.length) lines.push('', '| Status | Path |', '|---|---|', ...d.files.map(f =>
    `| ${cell(f.status)} | ${cell(f.path)}${f.originalPath ? ` (from ${cell(f.originalPath)})` : ''} |`));
  return lines.join('\n') + '\n';
}

const HELP = `local-dev — local development intake (Git and Node 18+)
  inspect --repo PATH [--base REF]       offline, read-only Git snapshot (JSON)
  issues --repo PATH [--github-repo OWNER/REPO] [--limit 1..100]
  issue --repo PATH --id NUMBER_OR_URL [--github-repo OWNER/REPO]
  report --input FILE [--out DIR]    offline report; never overwrite a report
Only issues/issue invoke gh. No command edits Git, fetches, pushes or opens a PR.
Use /local-dev in Claude Code or $local-dev in Codex for the complete workflow.
`;

export function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || (argv.length === 1 && ['--help', '-h'].includes(argv[0]))) { process.stdout.write(HELP); return; }
  const [mode, ...rest] = argv;
  const allowed = { inspect: ['repo', 'base'], issues: ['repo', 'github-repo', 'limit'], issue: ['repo', 'github-repo', 'id'], report: ['input', 'out'] }[mode];
  if (!allowed) fail(`Unknown command: ${mode}`);
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i].startsWith('--') ? rest[i].slice(2) : '';
    if (!allowed.includes(key) || key in opts || !nonempty(rest[i + 1]) || rest[i + 1].startsWith('--')) fail(`Invalid or missing option: ${rest[i]}`);
    opts[key] = rest[i + 1];
  }
  if (mode === 'report') {
    if (!opts.input) fail('--input is required');
    const report = renderReport(parseJSON(readFileSync(resolve(opts.input), 'utf8'), 'inspection file'));
    if (opts.out) {
      // Exclusive creation refuses existing report files, including symlinks.
      mkdirSync(resolve(opts.out), { recursive: true });
      writeFileSync(join(resolve(opts.out), 'inspection.md'), report, { flag: 'wx' });
    } else process.stdout.write(report);
    return;
  }
  if (!opts.repo) fail('--repo is required');
  if (mode === 'issue' && !opts.id) fail('--id is required');
  const data = mode === 'inspect' ? inspect(opts.repo, opts.base) : readIssues(opts.repo, { githubRepo: opts['github-repo'], id: opts.id, limit: opts.limit });
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) {
    process.stderr.write(`local-dev: ${error.message}\n`);
    process.exitCode = 1;
  }
}
