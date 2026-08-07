/**
 * Action reference resolution — the one check nothing else performs.
 *
 * Measured against a deliberately-broken workflow: actionlint 1.7.12 caught six
 * defect classes and missed exactly two — `actions/checkout@v99` (tag does not
 * exist) and `actions/setup-nodejs@v4` (action does not exist at all). Those two
 * are the signature failure of model-written YAML, and they are the reason this
 * module exists.
 *
 * The second reason is subtler. actionlint validates a `with:` block against
 * action inputs from a database **baked in at build time**: of thirteen popular
 * actions probed, eleven were known and two — `astral-sh/setup-uv` and
 * `pnpm/action-setup` — had their `with:` blocks completely unchecked, silently.
 * A generator cannot tell which case it is in, so it reads `action.yml` itself.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export class ResolveError extends Error {}

/** `uses:` values that are not registry actions and cannot be resolved. */
const LOCAL = /^(\.|\.\/|docker:\/\/)/;

/**
 * Parse a `uses:` value into its parts.
 *
 * Subdirectory actions (`owner/repo/path@ref`) resolve against the repo, not
 * the path — `github/codeql-action/init@v4` lives in the `codeql-action` repo.
 */
export function parseUses(uses) {
  if (typeof uses !== 'string' || uses.length === 0) {
    throw new ResolveError('empty uses');
  }
  if (LOCAL.test(uses)) return { kind: uses.startsWith('docker://') ? 'docker' : 'local', uses };
  const at = uses.lastIndexOf('@');
  if (at === -1) return { kind: 'unpinned', uses, ref: null };
  const path = uses.slice(0, at);
  const ref = uses.slice(at + 1);
  const [owner, repo, ...sub] = path.split('/');
  if (!owner || !repo) throw new ResolveError(`malformed uses: ${uses}`);
  return { kind: 'action', uses, owner, repo, subdir: sub.join('/'), ref };
}

const SHA40 = /^[0-9a-f]{40}$/;

async function gh(path) {
  const { stdout } = await exec('gh', ['api', path], { encoding: 'utf8', maxBuffer: 1 << 22 });
  return JSON.parse(stdout);
}

/**
 * Resolve a ref to a full commit SHA.
 *
 * Order is tags → heads → commits, because a ref is overwhelmingly a tag and
 * each miss costs a round trip. An **annotated** tag resolves to the tag object
 * rather than the commit, which then needs a second deref — `actions/checkout@v5`
 * happens to be lightweight and needs none, which is exactly how this gets
 * missed and a wrong SHA gets pinned.
 */
export async function resolveRef(owner, repo, ref) {
  if (SHA40.test(ref)) return { sha: ref, via: 'sha', already: true };

  for (const [kind, path] of [['tag', 'tags'], ['branch', 'heads']]) {
    try {
      const r = await gh(`repos/${owner}/${repo}/git/ref/${path}/${ref}`);
      if (r.object?.type === 'tag') {
        const deref = await gh(`repos/${owner}/${repo}/git/tags/${r.object.sha}`);
        return { sha: deref.object.sha, via: `annotated ${kind}`, already: false };
      }
      return { sha: r.object.sha, via: kind, already: false };
    } catch {
      /* try the next kind */
    }
  }
  try {
    const c = await gh(`repos/${owner}/${repo}/commits/${ref}`);
    return { sha: c.sha, via: 'commit', already: false };
  } catch {
    throw new ResolveError(`ref "${ref}" does not exist in ${owner}/${repo}`);
  }
}

/**
 * The action's latest published release tag.
 *
 * Staleness is invisible to every other check, and that is not a small gap: a
 * hand-written workflow pinning `actions/checkout@v5` passed actionlint and
 * zizmor completely clean during development while being two majors behind
 * (v7.0.1 was current). Published research puts the typical workflow 7+ months
 * behind the actions it uses. Existence is not currency.
 */
export async function latestRelease(owner, repo) {
  try {
    const r = await gh(`repos/${owner}/${repo}/releases/latest`);
    return r.tag_name ?? null;
  } catch {
    return null; // plenty of real actions publish tags but cut no releases
  }
}

/** Major version of a tag like `v7.0.1`, or null when it isn't that shape. */
function major(tag) {
  const m = /^v?(\d+)\./.exec(tag ?? '') ?? /^v?(\d+)$/.exec(tag ?? '');
  return m ? Number(m[1]) : null;
}

/** Does the repo exist at all? Distinguishes a dead ref from a hallucinated action. */
export async function repoExists(owner, repo) {
  try {
    await gh(`repos/${owner}/${repo}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * The action's declared inputs, read from its own `action.yml` at the resolved
 * SHA — not from any bundled database, and pinned to the same commit that will
 * be written into the workflow, so the inputs checked are the inputs that run.
 */
export async function actionInputs(owner, repo, subdir, sha) {
  const dir = subdir ? `${subdir}/` : '';
  for (const name of ['action.yml', 'action.yaml']) {
    try {
      const r = await gh(`repos/${owner}/${repo}/contents/${dir}${name}?ref=${sha}`);
      const text = Buffer.from(r.content, 'base64').toString('utf8');
      return { inputs: parseInputs(text), required: parseRequired(text), file: name };
    } catch {
      /* try the other spelling */
    }
  }
  return null;
}

/**
 * A deliberately small `action.yml` reader: the `inputs:` mapping keys and which
 * of them are `required: true`. Pulling in a YAML parser to read two facts would
 * add a dependency to a skill whose whole value is being fast and dependency-light.
 * Keys are two-space-indented under `inputs:` in every action.yml in the wild.
 */
function parseInputs(text) {
  const out = [];
  let inBlock = false;
  for (const line of text.split('\n')) {
    if (/^inputs:\s*$/.test(line)) { inBlock = true; continue; }
    if (inBlock && /^\S/.test(line)) break;
    const m = inBlock && /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * Which inputs a caller must actually supply.
 *
 * `required: true` alone is not the answer. An input that also declares a
 * `default:` is never missing — the runner substitutes the default when the
 * caller omits it — and pairing the two is common enough that ignoring the
 * default made rung 0 report phantom failures on `github/codeql-action`, whose
 * `analysis-kinds` and `wait-for-processing` are both required-with-default.
 * That is worse than a missed defect: a rung nobody can get green is a rung
 * people learn to ignore, and rung 0 is the one nothing else does.
 */
export function parseRequired(text) {
  const out = [];
  let current = null;
  let inBlock = false;
  let required = false;
  let hasDefault = false;
  const flush = () => { if (current && required && !hasDefault) out.push(current); };
  for (const line of text.split('\n')) {
    if (/^inputs:\s*$/.test(line)) { inBlock = true; continue; }
    if (inBlock && /^\S/.test(line)) break;
    if (!inBlock) continue;
    const key = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (key) { flush(); current = key[1]; required = false; hasDefault = false; continue; }
    if (!current) continue;
    if (/^ {4}required:\s*true\s*$/.test(line)) required = true;
    else if (/^ {4}default:/.test(line)) hasDefault = true;
  }
  flush();
  return out;
}

/**
 * Full verdict for one `uses:` — does it exist, what does it pin to, and is the
 * `with:` block real. `withKeys` is optional; omit it to skip input checking.
 */
export async function inspectUses(uses, withKeys = null, comment = null) {
  const parsed = parseUses(uses);
  if (parsed.kind !== 'action') {
    return { ...parsed, status: parsed.kind === 'unpinned' ? 'unpinned' : 'skipped' };
  }
  const { owner, repo, subdir, ref } = parsed;

  let resolved;
  try {
    resolved = await resolveRef(owner, repo, ref);
  } catch (err) {
    const exists = await repoExists(owner, repo);
    return {
      ...parsed,
      status: exists ? 'bad-ref' : 'no-such-action',
      detail: exists ? err.message : `${owner}/${repo} does not exist`,
    };
  }

  const [meta, latest] = await Promise.all([
    actionInputs(owner, repo, subdir, resolved.sha),
    latestRelease(owner, repo),
  ]);
  // A SHA pin carries no readable version, so its `# v7` trailing comment is the
  // only thing that can be compared against the latest release. Without this, the
  // recommended pin format would be the one format staleness cannot be seen in.
  const declared = major(ref) ?? major(comment);
  const behind = major(latest) !== null && declared !== null && major(latest) > declared
    ? major(latest) - declared
    : 0;
  const unknown = withKeys && meta
    ? withKeys.filter((k) => !meta.inputs.includes(k))
    : [];
  const missing = withKeys && meta
    ? meta.required.filter((k) => !withKeys.includes(k))
    : [];

  return {
    ...parsed,
    status: unknown.length || missing.length ? 'bad-inputs' : 'ok',
    sha: resolved.sha,
    via: resolved.via,
    pinned: resolved.already,
    inputsKnown: Boolean(meta),
    unknown,
    missing,
    latest,
    behind,
  };
}
