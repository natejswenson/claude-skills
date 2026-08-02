/**
 * Repo detection — the question budget.
 *
 * Every fact derived here is a question not asked. The house rule is one
 * question at a time with an opinionated default, so the way to keep a run to
 * two questions is not to ask tersely but to already know the answer. GitHub's
 * own starter-workflows concluded the same thing from the other direction: its
 * only template placeholders are `$default-branch`, `$protected-branches` and
 * `$cron-daily`, because those are the three things a template genuinely cannot
 * guess.
 *
 * Detection tells you the repo's *shape*. It never tells you its *intent* —
 * deploy targets, which secrets a release needs, whether a workflow may write.
 * Those are always asked.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const exec = promisify(execFile);

const read = (repo, p) => {
  try {
    return readFileSync(join(repo, p), 'utf8');
  } catch {
    return null;
  }
};

const json = (repo, p) => {
  const text = read(repo, p);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * Ecosystem, package manager and runtime version.
 *
 * The lockfile decides the package manager, never the presence of a `scripts`
 * block — a repo with `package-lock.json` and a stray `yarn.lock` in a fixture
 * directory should still be npm at the root.
 */
export function detectStack(repo) {
  const pkg = json(repo, 'package.json');
  if (pkg) {
    const pm = existsSync(join(repo, 'pnpm-lock.yaml')) ? 'pnpm'
      : existsSync(join(repo, 'yarn.lock')) ? 'yarn'
        : existsSync(join(repo, 'bun.lockb')) ? 'bun'
          : 'npm';
    const declared = pkg.packageManager?.split('@')[0];
    return {
      ecosystem: 'node',
      packageManager: declared ?? pm,
      lockfile: { npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock', bun: 'bun.lockb' }[declared ?? pm],
      runtime: (read(repo, '.nvmrc') ?? read(repo, '.node-version') ?? pkg.engines?.node ?? '')
        .trim().replace(/^[^\d]*/, '') || null,
      test: pkg.scripts?.test ?? null,
      lint: pkg.scripts?.lint ?? null,
      build: pkg.scripts?.build ?? null,
      workspaces: Boolean(pkg.workspaces || existsSync(join(repo, 'pnpm-workspace.yaml'))),
    };
  }

  if (existsSync(join(repo, 'pyproject.toml')) || existsSync(join(repo, 'setup.py'))
      || readdirSync(repo).some((f) => /^requirements.*\.txt$/.test(f))) {
    const toml = read(repo, 'pyproject.toml') ?? '';
    const pm = existsSync(join(repo, 'uv.lock')) ? 'uv'
      : existsSync(join(repo, 'poetry.lock')) ? 'poetry'
        : existsSync(join(repo, 'Pipfile.lock')) ? 'pipenv'
          : 'pip';
    const requires = /requires-python\s*=\s*["']([^"']+)/.exec(toml);
    return {
      ecosystem: 'python',
      packageManager: pm,
      lockfile: { uv: 'uv.lock', poetry: 'poetry.lock', pipenv: 'Pipfile.lock', pip: null }[pm],
      runtime: (read(repo, '.python-version') ?? '').trim() || requires?.[1] || null,
      test: /\[tool\.pytest/.test(toml) || existsSync(join(repo, 'pytest.ini')) ? 'pytest' : null,
      lint: /\[tool\.ruff/.test(toml) || existsSync(join(repo, 'ruff.toml')) ? 'ruff check .' : null,
      build: null,
      workspaces: false,
    };
  }

  for (const [file, eco, test] of [
    ['go.mod', 'go', 'go test ./...'],
    ['Cargo.toml', 'rust', 'cargo test'],
    ['build.gradle', 'java', './gradlew test'],
    ['build.gradle.kts', 'java', './gradlew test'],
    ['pom.xml', 'java', 'mvn -B test'],
    ['Gemfile', 'ruby', 'bundle exec rake'],
  ]) {
    if (existsSync(join(repo, file))) {
      return { ecosystem: eco, packageManager: null, lockfile: null, runtime: null, test, lint: null, build: null, workspaces: false };
    }
  }

  return { ecosystem: 'unknown', packageManager: null, lockfile: null, runtime: null, test: null, lint: null, build: null, workspaces: false };
}

/** Workflows already present, and the `ci / <job>` contexts they publish. */
export function detectWorkflows(repo) {
  const dir = join(repo, '.github/workflows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((file) => {
      const text = read(repo, join('.github/workflows', file)) ?? '';
      const name = /^name:\s*(.+)$/m.exec(text)?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? file;
      // Scoped to the `jobs:` block. A bare two-space-key scan also matches the
      // keys under `on:`, which reported `push` and `workflow_dispatch` as jobs.
      const jobs = jobKeys(text);
      const jobNames = [...text.matchAll(/^\s{4}name:\s*(.+)$/gm)].map((m) => m[1].trim());
      return { file, name, jobs, jobNames, hasHeader: text.includes('>>> press:gha-header') };
    });
}

/** The job ids inside the `jobs:` mapping, and nothing outside it. */
function jobKeys(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i])) break;
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Anything that needs the network or `gh`. Degrades to nulls rather than throwing. */
export async function detectRemote(repo) {
  const out = { defaultBranch: null, visibility: null, requiredChecks: [], secrets: [], autoMerge: null };
  try {
    // `autoMergeAllowed` is NOT a `gh repo view` field — asking for it fails the
    // whole call, and the git fallback still produced a plausible default branch,
    // so the failure looked like success with two fields quietly empty.
    const { stdout } = await exec('gh', [
      'repo', 'view', '--json', 'defaultBranchRef,visibility',
    ], { cwd: repo });
    const r = JSON.parse(stdout);
    out.defaultBranch = r.defaultBranchRef?.name ?? null;
    out.visibility = r.visibility ?? null;
    try {
      const { stdout: am } = await exec('gh', ['api', 'repos/{owner}/{repo}', '--jq', '.allow_auto_merge'], { cwd: repo });
      out.autoMerge = am.trim() === 'true';
    } catch { /* needs admin */ }
  } catch {
    try {
      const { stdout } = await exec('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: repo });
      out.defaultBranch = stdout.trim().replace(/^origin\//, '');
    } catch { /* no remote */ }
  }
  if (out.defaultBranch) {
    try {
      const { stdout } = await exec('gh', [
        'api', `repos/{owner}/{repo}/branches/${out.defaultBranch}/protection`,
        '--jq', '.required_status_checks.contexts[]?',
      ], { cwd: repo });
      out.requiredChecks = stdout.split('\n').filter(Boolean);
    } catch { /* no admin, or unprotected */ }
  }
  try {
    // Names only. A secret's value must never enter this process.
    const { stdout } = await exec('gh', ['secret', 'list', '--json', 'name', '--jq', '.[].name'], { cwd: repo });
    out.secrets = stdout.split('\n').filter(Boolean);
  } catch { /* not authed, or no permission */ }
  return out;
}

export async function detect(repo) {
  const stack = detectStack(repo);
  const workflows = detectWorkflows(repo);
  const remote = await detectRemote(repo);
  return { repo, ...stack, workflows, ...remote };
}
