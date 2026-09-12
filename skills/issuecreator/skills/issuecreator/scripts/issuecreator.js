#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
const placeholder = /^(?:tbd|todo|fixme|n\/a|\.{3}|<[^>]+>|\[insert[^\]]*\])\s*[.!]?$/i;
const text = x => typeof x === 'string' && x.trim() && !placeholder.test(x.trim());
const list = x => Array.isArray(x) && x.length > 0 && x.every(text);
const repoPattern = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/;

export function validate(d) {
  const errors = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['draft must be an object'];
  const allowed = new Set(['title', 'kind', 'problem', 'desiredBehavior', 'scope', 'outOfScope', 'context', 'acceptanceCriteria', 'verification', 'dependencies', 'openQuestions', 'reproduction', 'expected', 'actual', 'environment', 'implementationNotes', 'templateBody']);
  for (const key of Object.keys(d)) if (!allowed.has(key)) errors.push(`unknown field: ${key}`);
  for (const key of ['title', 'problem', 'desiredBehavior']) if (!text(d[key])) errors.push(`${key} must be meaningful text`);
  if (typeof d.title === 'string' && (/[\r\n]/.test(d.title) || d.title.length > 256)) errors.push('title must be one line, at most 256 characters');
  if (!['feature', 'bug', 'maintenance'].includes(d.kind)) errors.push('kind must be feature, bug, or maintenance');
  for (const key of ['scope', 'context', 'acceptanceCriteria', 'verification']) if (!list(d[key])) errors.push(`${key} must contain nonempty text items`);
  for (const key of ['outOfScope', 'dependencies', 'openQuestions']) if (!Array.isArray(d[key]) || !d[key].every(text)) errors.push(`${key} must be an array of text items (empty allowed)`);
  if (Array.isArray(d.openQuestions) && d.openQuestions.length) errors.push('resolve blocking openQuestions before rendering or publishing');
  if (d.kind !== 'bug') for (const key of ['reproduction', 'expected', 'actual', 'environment']) if (key in d) errors.push(`${key} is only supported for bug drafts; move relevant evidence to context`);
  if (d.kind === 'bug') for (const key of ['reproduction', 'expected', 'actual', 'environment']) if (!text(d[key])) errors.push(`bug requires ${key}`);
  for (const key of ['reproduction', 'expected', 'actual', 'environment', 'implementationNotes', 'templateBody']) if (key in d && !text(d[key])) errors.push(`${key} must be meaningful text when provided`);
  return errors;
}

export function render(d) {
  const errors = validate(d);
  if (errors.length) throw new Error(errors.join('\n'));
  const section = (heading, body) => `## ${heading}\n\n${body}`;
  const items = (xs, check = false) => xs.map(x => `${check ? '- [ ] ' : '- '}${x.replace(/\n/g, '\n  ')}`).join('\n');
  const parts = [section('Problem', d.problem), section('Desired behavior', d.desiredBehavior), section('Scope', items(d.scope))];
  if (d.outOfScope.length) parts.push(section('Out of scope', items(d.outOfScope)));
  if (d.kind === 'bug') parts.push(section('Reproduction', d.reproduction), section('Expected behavior', d.expected), section('Actual behavior', d.actual), section('Environment', d.environment));
  parts.push(section('Repository context', items(d.context)), section('Acceptance criteria', items(d.acceptanceCriteria, true)), section('Verification', items(d.verification)));
  if (d.dependencies.length) parts.push(section('Dependencies', items(d.dependencies)));
  if (d.implementationNotes) parts.push(section('Implementation notes (suggestions)', d.implementationNotes));
  // Keep a repository-specific form intact while retaining the validated implementation brief.
  if (d.templateBody) parts.unshift(d.templateBody);
  return parts.join('\n\n') + '\n';
}

function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, shell: false });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr?.trim() || `gh exited ${result.status}`);
  return result.stdout.trim();
}

function atomicWrite(path, contents) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}

export function publish({ draft, repo, out }, runGh = gh) {
  if (typeof repo !== 'string' || !repoPattern.test(repo) || repo.endsWith('/.') || repo.endsWith('/..')) throw new Error('--repo must be an explicit OWNER/REPO');
  const body = render(draft);
  mkdirSync(out, { recursive: true });
  const receiptPath = join(out, 'receipt.json');
  const digest = createHash('sha256').update(JSON.stringify({ repo, title: draft.title, body })).digest('hex');
  const receipt = { status: 'attempting', repo, title: draft.title, digest };
  // Exclusive creation is a durable guard across retries, crashes and concurrent invocations.
  try { writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Receipt already exists at ${receiptPath}; inspect it and reconcile on GitHub before any new create attempt.`);
    throw error;
  }
  const save = () => atomicWrite(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  try {
    const bodyPath = join(out, 'issue.md');
    writeFileSync(bodyPath, body, { mode: 0o600 });
    const url = runGh(['issue', 'create', '--repo', repo, '--title', draft.title, '--body-file', bodyPath]);
    receipt.url = url;
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/([^/]+\/[^/]+)\/issues\/([1-9][0-9]*)$/);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || !match || match[1].toLowerCase() !== repo.toLowerCase()) throw new Error('Unexpected issue URL; inspect receipt and GitHub');
    receipt.status = 'created-unverified';
    save();
    const observed = JSON.parse(runGh(['issue', 'view', url, '--repo', repo, '--json', 'number,url,title,body']));
    if (observed.url !== url || observed.number !== Number(match[2]) || observed.title !== draft.title || observed.body.replace(/\r\n/g, '\n').replace(/\n$/, '') !== body.replace(/\n$/, '')) throw new Error('Published issue read-back does not match the draft');
    Object.assign(receipt, { status: 'verified', number: observed.number });
    save();
    return receipt;
  } catch (error) {
    receipt.status = receipt.url ? 'created-unverified' : 'uncertain';
    receipt.error = error.message;
    save();
    throw new Error(`${error.message}\nPublication is unverified. Inspect ${receiptPath} and GitHub; do not retry blindly.`);
  }
}

const usage = `issuecreator v${VERSION}
  validate --input <draft.json>
  render --input <draft.json> --out <directory>
  create --input <draft.json> --repo <OWNER/REPO> --out <unique-directory>

validate checks structure, not factual accuracy. create publishes immediately;
the caller must already have user authorization. Existing receipts prevent retries.
`;
export function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes('--help')) { console.log(usage); return; }
  if (argv.length === 1 && argv[0] === '--version') { console.log(VERSION); return; }
  const [command, ...rest] = argv;
  if (!['validate', 'render', 'create'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const args = {};
  const allowed = command === 'validate' ? ['--input'] : command === 'render' ? ['--input', '--out'] : ['--input', '--out', '--repo'];
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!allowed.includes(key) || key in args || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(`Invalid or duplicate argument: ${key}`);
    args[key] = rest[i + 1];
  }
  for (const key of allowed) if (!args[key]) throw new Error(`Required: ${key}`);
  const draft = JSON.parse(readFileSync(resolve(args['--input']), 'utf8'));
  const errors = validate(draft);
  if (errors.length) throw new Error(errors.join('\n'));
  if (command === 'validate') return console.log('Draft structure valid; factual and semantic review still required.');
  const out = resolve(args['--out']);
  if (command === 'create') return console.log(JSON.stringify(publish({ draft, repo: args['--repo'], out }), null, 2));
  if (existsSync(join(out, 'receipt.json'))) throw new Error('Publication receipt exists; render to a separate draft directory to preserve the submitted body.');
  if (resolve(args['--input']) === join(out, 'issue.md')) throw new Error('Input collides with Markdown output; rename the JSON input first.');
  mkdirSync(out, { recursive: true });
  atomicWrite(join(out, 'issue.md'), render(draft));
  atomicWrite(join(out, 'issue.json'), JSON.stringify(draft, null, 2) + '\n');
  console.log(`Draft rendered: ${join(out, 'issue.md')}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(`issuecreator: ${error.message}`); process.exitCode = 1; }
}
